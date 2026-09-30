#[cfg(windows)]
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(windows)]
#[derive(Clone, Serialize, Deserialize)]
pub struct StoredSession {
    pub api_base: String,
    pub token: String,
    pub refresh_token: String,
    pub installation_id: String,
    pub operator: Value,
    pub expires_at: u64,
}
#[cfg(windows)]
impl StoredSession {
    pub fn public(&self) -> Value {
        json!({"api_base":self.api_base,"token":self.token,"installation_id":self.installation_id,"operator":self.operator,"expires_at":self.expires_at})
    }
}

#[cfg(windows)]
pub mod desktop {
    use super::*;
    use std::sync::Mutex;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    static SESSION_LOCK: Mutex<()> = Mutex::new(());
    fn entry() -> Result<keyring::Entry, String> {
        let service = if cfg!(debug_assertions) { "ru.zhivaya-skazka.operator.v8.debug" } else { "ru.zhivaya-skazka.operator.v8" };
        keyring::Entry::new(service, "session").map_err(|_| "credential_store_unavailable".into())
    }
    pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
    pub fn valid_base(base: &str) -> bool {
        let Ok(url) = reqwest::Url::parse(base) else { return false };
        if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path() != "/" { return false; }
        (url.scheme() == "https" && url.host_str() == Some("zhivaya-skazka.ru") && url.port_or_known_default() == Some(443))
            || (cfg!(debug_assertions) && url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost")))
    }
    fn read() -> Result<Option<StoredSession>, String> {
        match entry()?.get_password() {
            Ok(value) => serde_json::from_str(&value).map(Some).map_err(|_| "invalid_stored_session".into()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("credential_store_unavailable".into()),
        }
    }
    fn persist(session: &StoredSession) -> Result<(), String> {
        if !valid_base(&session.api_base) || session.refresh_token.len() < 32 || session.refresh_token.len() > 512 || session.installation_id.len() != 36 { return Err("invalid_session".into()); }
        let value = serde_json::to_string(session).map_err(|_| "invalid_session")?;
        if value.len() > 2400 { return Err("session_too_large".into()); }
        entry()?.set_password(&value).map_err(|_| "credential_store_unavailable".into())
    }
    pub fn save(session: StoredSession) -> Result<Value, String> {
        let _lock = SESSION_LOCK.lock().map_err(|_| "session_busy")?;
        persist(&session)?;
        Ok(session.public())
    }
    fn client() -> Result<reqwest::blocking::Client, String> {
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(12)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "network_unavailable".into())
    }
    pub fn get(force: bool) -> Result<Option<StoredSession>, String> {
        let _lock = SESSION_LOCK.lock().map_err(|_| "session_busy")?;
        let Some(mut session) = read()? else { return Ok(None) };
        if !valid_base(&session.api_base) { return Err("invalid_session_origin".into()); }
        if !force && session.expires_at > now() + 60000 { return Ok(Some(session)); }
        let response = client()?.post(format!("{}/api/chat-v8/auth/refresh", session.api_base.trim_end_matches('/')))
            .json(&json!({"refresh_token":session.refresh_token,"installation_id":session.installation_id})).send();
        let response = match response {
            Ok(response) => response,
            Err(_) if !force => return Ok(Some(session)),
            Err(_) => return Err("network_unavailable".into()),
        };
        if response.status().as_u16() == 401 { let _ = entry()?.delete_credential(); return Ok(None); }
        if !response.status().is_success() { return Err("network_unavailable".into()); }
        let pair: Value = response.json().map_err(|_| "invalid_server_response")?;
        session.token = pair["token"].as_str().ok_or("invalid_server_response")?.to_owned();
        session.refresh_token = pair["refresh_token"].as_str().ok_or("invalid_server_response")?.to_owned();
        session.operator = pair["operator"].clone();
        session.expires_at = now() + pair["expires_in"].as_u64().unwrap_or(1200).min(3600) * 1000;
        persist(&session)?;
        Ok(Some(session))
    }
    pub fn clear() -> Result<(), String> {
        let previous = {
            let _lock = SESSION_LOCK.lock().map_err(|_| "session_busy")?;
            let previous = read()?;
            match entry()?.delete_credential() { Ok(_) | Err(keyring::Error::NoEntry) => {}, Err(_) => return Err("credential_store_unavailable".into()) }
            previous
        };
        if let Some(session) = previous {
            if let Some(operator)=session.operator["id"].as_str(){crate::native_notifications::before_logout(operator);}
            if valid_base(&session.api_base) {
                if let Ok(client) = client() {
                    let _ = client.post(format!("{}/api/chat-v8/auth/logout",session.api_base.trim_end_matches('/')))
                        .json(&json!({"refresh_token":session.refresh_token})).send();
                }
            }
        }
        Ok(())
    }
    pub fn request_as(method: &str, endpoint: &str, body: Value, expected_operator: &str) -> Result<Value, String> {
        if !endpoint.starts_with("/api/") || endpoint.contains("..") { return Err("invalid_endpoint".into()); }
        let session = get(false)?.ok_or("session_required")?;
        let send = |session: &StoredSession| -> Result<reqwest::blocking::Response, String> {
            if session.operator["id"].as_str()!=Some(expected_operator){return Err("session_required".into());}
            let request=client()?.request(reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "invalid_method")?, format!("{}{}",session.api_base.trim_end_matches('/'),endpoint)).bearer_auth(&session.token);
            (if method=="GET"{request}else{request.json(&body)}).send().map_err(|_| "network_unavailable".into())
        };
        let mut response = send(&session)?;
        if response.status().as_u16() == 401 { response = send(&get(true)?.ok_or("session_required")?)?; }
        if !response.status().is_success() { return Err(format!("http_{}",response.status().as_u16())); }
        response.json().map_err(|_| "invalid_server_response".into())
    }
}

#[cfg(target_os = "android")]
pub struct AndroidSession(tauri::plugin::PluginHandle<tauri::Wry>);

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("chat-session").setup(|app, api| {
        #[cfg(target_os = "android")]
        app.manage(AndroidSession(api.register_android_plugin("ru.zhivaya_skazka.operator", "AuthPlugin")?));
        #[cfg(not(target_os = "android"))]
        let _ = (app, api);
        Ok(())
    }).build()
}

#[tauri::command]
pub async fn auth_save_session(app: tauri::AppHandle, data: String) -> Result<Value, String> {
    if data.len() > 16000 { return Err("session_too_large".into()); }
    #[cfg(windows)]
    { let _ = app; let session: StoredSession = serde_json::from_str(&data).map_err(|_| "invalid_session")?; return tauri::async_runtime::spawn_blocking(move || desktop::save(session)).await.map_err(|_| "session_error")?; }
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("saveSession", json!({"data":data})).await.map(|value|value.get("session").cloned().unwrap_or(Value::Null)).map_err(|_| "session_error".into()); }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _ = (app,data); Err("unsupported_platform".into()) }
}
#[tauri::command]
pub async fn auth_get_session(app: tauri::AppHandle, force: bool) -> Result<Value, String> {
    #[cfg(windows)]
    { let _ = app; return tauri::async_runtime::spawn_blocking(move || desktop::get(force).map(|session| session.map(|value|value.public()).unwrap_or(Value::Null))).await.map_err(|_| "session_error")?; }
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("getSession", json!({"force":force})).await.map(|value|value.get("session").cloned().unwrap_or(Value::Null)).map_err(|_| "session_error".into()); }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=(app,force); Ok(Value::Null) }
}
#[tauri::command]
pub async fn auth_clear_session(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    { let _=app; return tauri::async_runtime::spawn_blocking(desktop::clear).await.map_err(|_| "session_error")?; }
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("clearSession", json!({})).await.map(|_|()).map_err(|_| "session_error".into()); }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=app; Ok(()) }
}
#[tauri::command]
pub async fn set_native_chat_context(app: tauri::AppHandle, session_id: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("setChatContext",json!({"sessionId":session_id})).await.map(|_|()).map_err(|_|"session_error".into()); }
    #[cfg(windows)]
    { let _=app; crate::native_notifications::set_context(session_id); Ok(()) }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=(app,session_id); Ok(()) }
}

#[tauri::command]
pub async fn show_chat_notification(app: tauri::AppHandle, delivery_id: String) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("showNotification",json!({"deliveryId":delivery_id})).await.map(|value|value["shown"].as_bool().unwrap_or(false)).map_err(|_|"notification_unavailable".into()); }
    #[cfg(windows)]
    { let _=app; return tauri::async_runtime::spawn_blocking(move||crate::native_notifications::show(&delivery_id)).await.map_err(|_|"notification_unavailable")?; }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=(app,delivery_id); Err("notification_unavailable".into()) }
}
#[tauri::command]
pub async fn read_native_replies(app: tauri::AppHandle) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("readReplies",json!({})).await.map(|value|value["replies"].clone()).map_err(|_|"reply_queue_unavailable".into()); }
    #[cfg(windows)]
    { let _=app; return tauri::async_runtime::spawn_blocking(crate::native_notifications::read_replies).await.map_err(|_|"reply_queue_unavailable")?; }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=app; Ok(json!([])) }
}
#[tauri::command]
pub async fn ack_native_reply(app: tauri::AppHandle, client_id: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("acknowledgeReply",json!({"clientId":client_id})).await.map(|_|()).map_err(|_|"reply_queue_unavailable".into()); }
    #[cfg(windows)]
    { let _=app; return tauri::async_runtime::spawn_blocking(move||crate::native_notifications::acknowledge_reply(&client_id)).await.map_err(|_|"reply_queue_unavailable")?; }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=(app,client_id); Ok(()) }
}

/// Честное состояние уведомлений на этом устройстве (разрешение ОС, канал, экономия батареи).
#[tauri::command]
pub async fn notification_diagnostics(app: tauri::AppHandle) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("deviceDiagnostics",json!({})).await.map_err(|_|"diagnostics_unavailable".into()); }
    #[cfg(windows)]
    { let _=app; return tauri::async_runtime::spawn_blocking(crate::native_notifications::diagnostics).await.map_err(|_|"diagnostics_unavailable")?; }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=app; Ok(Value::Null) }
}

/// Системные настройки уведомлений («notifications») или экономии батареи («battery», только Android).
#[tauri::command]
pub async fn open_system_settings(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let kind = if kind == "battery" { "battery" } else { "notifications" };
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("openSystemSettings",json!({"kind":kind})).await.map(|_|()).map_err(|_|"settings_unavailable".into()); }
    #[cfg(windows)]
    { let _=(app,kind); return std::process::Command::new("explorer").arg("ms-settings:notifications").spawn().map(|_|()).map_err(|_|"settings_unavailable".into()); }
    #[cfg(not(any(windows,target_os = "android")))]
    { let _=(app,kind); Err("unsupported_platform".into()) }
}

/// Android WebView молча игнорирует `<a download>`: JSON сохраняем через системное «Сохранить как».
/// true — файл записан, false — оператор закрыл диалог.
#[tauri::command]
pub async fn save_json_file(app: tauri::AppHandle, name: String, text: String) -> Result<bool, String> {
    if name.len() > 120 || !name.ends_with(".json") || name.contains('/') || text.len() > 5_000_000 { return Err("invalid_file".into()); }
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("saveFile",json!({"name":name,"text":text})).await.map(|value|value["saved"].as_bool().unwrap_or(false)).map_err(|_|"save_failed".into()); }
    #[cfg(not(target_os = "android"))]
    { let _=(app,name,text); Err("unsupported_platform".into()) }
}

#[tauri::command]
pub fn take_native_notification() -> Option<String> {
    #[cfg(windows)] { return crate::native_notifications::take_pending_open(); }
    #[cfg(not(windows))] { None }
}

#[tauri::command]
pub async fn android_update_check(app: tauri::AppHandle) -> Result<Value,String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("checkUpdate",json!({})).await.map(|value|value["update"].clone()).map_err(|_|"update_check_failed".into()); }
    #[cfg(not(target_os = "android"))] { let _=app; Ok(Value::Null) }
}
#[tauri::command]
pub async fn android_update_download(app: tauri::AppHandle) -> Result<Value,String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("downloadUpdate",json!({})).await.map(|value|value["update"].clone()).map_err(|_|"update_download_or_verification_failed".into()); }
    #[cfg(not(target_os = "android"))] { let _=app; Err("unsupported_platform".into()) }
}
#[tauri::command]
pub async fn android_update_install(app: tauri::AppHandle, version_code:u32) -> Result<Value,String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("installUpdate",json!({"versionCode":version_code})).await.map_err(|_|"update_install_failed".into()); }
    #[cfg(not(target_os = "android"))] { let _=(app,version_code); Err("unsupported_platform".into()) }
}
#[tauri::command]
pub async fn android_update_cancel(app: tauri::AppHandle) -> Result<(),String> {
    #[cfg(target_os = "android")]
    { return app.state::<AndroidSession>().0.run_mobile_plugin_async::<Value>("cancelUpdate",json!({})).await.map(|_|()).map_err(|_|"update_cancel_failed".into()); }
    #[cfg(not(target_os = "android"))] { let _=app; Ok(()) }
}
