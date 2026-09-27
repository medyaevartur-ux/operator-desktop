//! Native Windows notifications, COM activation and a DPAPI-protected action queue.
//! Only identifiers enter toast activation arguments; replies go to our authenticated API.
use crate::session_vault::desktop;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, ffi::c_void, fs, io::Write, path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock}, time::Duration};
use tauri::{Emitter, Manager};
use uuid::Uuid;
use windows::{
    core::{implement, Interface, IUnknown, PCWSTR, GUID, HSTRING, BOOL},
    Data::Xml::Dom::XmlDocument,
    UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
    Win32::{
        Foundation::{CLASS_E_NOAGGREGATION, E_INVALIDARG, E_POINTER, HLOCAL, LocalFree, HWND},
        Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN},
        System::Com::{CoCreateInstance, CoInitializeEx, CoRegisterClassObject, CoRevokeClassObject, IClassFactory, IClassFactory_Impl, CLSCTX_INPROC_SERVER, CLSCTX_LOCAL_SERVER, COINIT_MULTITHREADED, REGCLS_MULTIPLEUSE},
        UI::{Notifications::{INotificationActivationCallback, INotificationActivationCallback_Impl, NOTIFICATION_USER_INPUT_DATA},
            Shell::{ITaskbarList3, TaskbarList, SetCurrentProcessExplicitAppUserModelID},
            WindowsAndMessaging::{CreateIcon, DestroyIcon, HICON}},
    },
};
const APP_ID: &str = if cfg!(debug_assertions) { "ru.zhivaya-skazka.operator.debug" } else { "ru.zhivaya-skazka.operator" };
const CLSID: GUID = if cfg!(debug_assertions) { GUID::from_u128(0x97cf32c7_2d4e_45b4_a3c9_6f8a531a1cb7) } else { GUID::from_u128(0x7236cb24_13da_41ac_ad5b_76d3e2407eb3) };
const CLSID_TEXT: &str = if cfg!(debug_assertions) { "{97CF32C7-2D4E-45B4-A3C9-6F8A531A1CB7}" } else { "{7236CB24-13DA-41AC-AD5B-76D3E2407EB3}" };
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static QUEUE: OnceLock<PathBuf> = OnceLock::new();
static QUEUE_LOCK: Mutex<()> = Mutex::new(());
static RUNNING: AtomicBool = AtomicBool::new(false);
static ACTIVE_SESSION: Mutex<Option<String>> = Mutex::new(None);
static PENDING_OPEN: Mutex<Option<String>> = Mutex::new(None);
static SEEN: Mutex<Vec<String>> = Mutex::new(Vec::new());
thread_local! { static COM_INITIALIZED: () = { let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }; }; }
fn init_com() { COM_INITIALIZED.with(|_| ()); }
fn valid_id(id: &str) -> bool { Uuid::parse_str(id).is_ok() }
fn xml(value: &str) -> String { value.chars().filter(|c|matches!(*c,'\t'|'\n'|'\r'|'\u{20}'..='\u{d7ff}'|'\u{e000}'..='\u{fffd}'|'\u{10000}'..='\u{10ffff}')).collect::<String>().replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;").replace('\'',"&apos;") }
fn tag(session: &str) -> String { session.replace('-',"").chars().take(16).collect() }
fn owner() -> Option<String> { desktop::get(false).ok().flatten().and_then(|session|session.operator["id"].as_str().map(str::to_owned)) }

#[derive(Clone, Serialize, Deserialize)]
struct Action { client_id: String, operator_id: String, session_id: String, delivery_id: String, kind: String, message: String, created_at: String }
fn crypt(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    if input.len()>100000 { return Err("queue_entry_too_large".into()); }
    let source=CRYPT_INTEGER_BLOB { cbData:input.len() as u32,pbData:input.as_ptr() as *mut u8 };
    let mut output=CRYPT_INTEGER_BLOB::default();
    unsafe {
        if encrypt { CryptProtectData(&source,PCWSTR::null(),None,None,None,CRYPTPROTECT_UI_FORBIDDEN,&mut output) }
        else { CryptUnprotectData(&source,None,None,None,None,CRYPTPROTECT_UI_FORBIDDEN,&mut output) }
        .map_err(|_|"secure_queue_unavailable")?;
        let bytes=std::slice::from_raw_parts(output.pbData,output.cbData as usize).to_vec();
        let _=LocalFree(Some(HLOCAL(output.pbData as *mut c_void)));
        Ok(bytes)
    }
}
fn file(id: &str) -> Result<PathBuf,String> {
    if !valid_id(id) { return Err("invalid_queue_id".into()); }
    Ok(QUEUE.get().ok_or("queue_unavailable")?.join(format!("{id}.action")))
}
fn save_action(action: &Action) -> Result<(),String> {
    let _lock=QUEUE_LOCK.lock().map_err(|_|"queue_busy")?;
    let target=file(&action.client_id)?;
    if target.exists() {
        let existing=load_action(&target)?;
        return if existing.message==action.message&&existing.kind==action.kind{Ok(())}else{Err("reply_already_queued".into())};
    }
    let bytes=crypt(&serde_json::to_vec(action).map_err(|_|"invalid_action")?,true)?;
    let temp=target.with_extension(format!("{}.tmp",Uuid::new_v4()));
    let mut stream=fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_|"queue_unavailable")?;
    stream.write_all(&bytes).and_then(|_|stream.sync_all()).map_err(|_|"queue_unavailable")?;
    drop(stream);
    fs::rename(&temp,&target).map_err(|_|"queue_unavailable".into())
}
fn load_action(path: &PathBuf) -> Result<Action,String> {
    if fs::metadata(path).map_err(|_|"queue_unavailable")?.len()>100000{return Err("queue_entry_too_large".into());}
    let bytes=fs::read(path).map_err(|_|"queue_unavailable")?;
    serde_json::from_slice(&crypt(&bytes,false)?).map_err(|_|"invalid_action".into())
}
fn actions() -> Vec<(PathBuf,Action)> {
    let Some(root)=QUEUE.get() else { return vec![] };
    let Ok(files)=fs::read_dir(root) else { return vec![] };
    files.filter_map(Result::ok).map(|entry|entry.path()).filter(|path|path.extension().and_then(|value|value.to_str())==Some("action"))
        .filter_map(|path|load_action(&path).ok().map(|action|(path,action))).collect()
}
fn remove_action(id:&str) -> Result<(),String> {
    let target=file(id)?;
    if target.exists() { fs::remove_file(&target).map_err(|_|"queue_unavailable")?; }
    let failed=target.with_extension("failed");if failed.exists(){let _=fs::remove_file(failed);}
    Ok(())
}
pub fn read_replies() -> Result<Value,String> {
    let Some(operator)=owner() else {return Ok(json!([]))};
    Ok(Value::Array(actions().into_iter().filter(|(path,action)|path.with_extension("failed").exists()&&action.kind=="reply"&&action.operator_id==operator)
        .map(|(_,action)|json!({"client_id":action.client_id,"operator_id":action.operator_id,"session_id":action.session_id,"message":action.message,"created_at":action.created_at})).collect()))
}
pub fn acknowledge_reply(id:&str) -> Result<(),String> {
    let _lock=QUEUE_LOCK.lock().map_err(|_|"queue_busy")?;
    let action=load_action(&file(id)?)?;
    if owner().as_deref()!=Some(&action.operator_id){return Err("session_required".into());}
    remove_action(id)
}
pub fn before_logout(operator:&str) {
    for(path,action)in actions(){if action.operator_id==operator{let _=fs::write(path.with_extension("failed"),b"signed_out");}}
    if let Ok(history)=ToastNotificationManager::History(){let _=history.ClearWithId(&HSTRING::from(APP_ID));}
    if let Ok(mut active)=ACTIVE_SESSION.lock(){*active=None;}
    if let Ok(mut pending)=PENDING_OPEN.lock(){*pending=None;}
}
fn ack(delivery:&str,outcome:&str,operator:&str){let _=desktop::request_as("POST",&format!("/api/chat-v8/notifications/{delivery}/ack"),json!({"outcome":outcome}),operator);}
fn hide(session:&str){if let Ok(history)=ToastNotificationManager::History(){let _=history.RemoveGroupedTagWithId(&HSTRING::from(tag(session)),&HSTRING::from("chats"),&HSTRING::from(APP_ID));}}
fn status(session:&str,body:&str){let _=show_xml(session,&format!("<toast launch=\"open|{session}\"><visual><binding template=\"ToastGeneric\"><text>Живая Сказка</text><text>{}</text></binding></visual><audio silent=\"true\"/></toast>",xml(body)));}
fn show_xml(session:&str,source:&str)->Result<bool,String>{
    init_com();
    let notifier=ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID)).map_err(|_|"notification_unavailable")?;
    if notifier.Setting().map_err(|_|"notification_unavailable")?!=NotificationSetting::Enabled{return Ok(false);}
    let document=XmlDocument::new().map_err(|_|"notification_unavailable")?;
    document.LoadXml(&HSTRING::from(source)).map_err(|_|"invalid_notification")?;
    let toast=ToastNotification::CreateToastNotification(&document).map_err(|_|"notification_unavailable")?;
    toast.SetTag(&HSTRING::from(tag(session))).map_err(|_|"notification_unavailable")?;
    toast.SetGroup(&HSTRING::from("chats")).map_err(|_|"notification_unavailable")?;
    notifier.Show(&toast).map_err(|_|"notification_unavailable")?;
    Ok(true)
}
pub fn show(delivery:&str)->Result<bool,String>{
    if !valid_id(delivery){return Err("invalid_notification".into());}
    let operator=owner().ok_or("session_required")?;
    let notice=desktop::request_as("GET",&format!("/api/chat-v8/notifications/{delivery}"),Value::Null,&operator)?;
    let session=notice["session_id"].as_str().filter(|id|valid_id(id)).ok_or("invalid_notification")?;
    let foreground=APP.get().and_then(|app|app.get_webview_window("main")).map(|window|window.is_visible().unwrap_or(false)&&window.is_focused().unwrap_or(false)).unwrap_or(false);
    if foreground && ACTIVE_SESSION.lock().ok().and_then(|active|active.clone()).as_deref()==Some(session){
        let _=desktop::request_as("PATCH",&format!("/api/sessions/{session}/read"),json!({}),&operator);ack(delivery,"read",&operator);return Ok(true);
    }
    if SEEN.lock().map_err(|_|"notification_busy")?.iter().any(|id|id==delivery){ack(delivery,"displayed",&operator);return Ok(true);}
    let id=Uuid::new_v4().to_string();
    let context=format!("{session}|{delivery}|{operator}|{id}");
    let source=format!("<toast launch=\"open|{context}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual><actions><input id=\"reply\" type=\"text\" placeHolderContent=\"Ответ клиенту\"/><action content=\"Ответить\" arguments=\"reply|{context}\" activationType=\"background\" hint-inputId=\"reply\"/><action content=\"Прочитано\" arguments=\"read|{context}\" activationType=\"background\"/></actions></toast>",xml(&notice["title"].as_str().unwrap_or("Живая Сказка").chars().take(100).collect::<String>()),xml(&notice["body"].as_str().unwrap_or("Новое сообщение").chars().take(400).collect::<String>()));
    let shown=show_xml(session,&source)?;
    if shown{let mut seen=SEEN.lock().map_err(|_|"notification_busy")?;seen.push(delivery.to_owned());if seen.len()>500{seen.remove(0);}}
    ack(delivery,if shown{"displayed"}else{"blocked"},&operator);
    Ok(shown)
}
fn open_chat(session:&str){
    if !valid_id(session){return;}
    if let Ok(mut pending)=PENDING_OPEN.lock(){*pending=Some(session.to_owned());}
    if let Some(app)=APP.get(){
        if let Some(window)=app.get_webview_window("main"){let _=window.show();let _=window.unminimize();let _=window.set_focus();}
        let _=app.emit("open-chat",json!({"sessionId":session}));
    }
}
pub fn take_pending_open()->Option<String>{PENDING_OPEN.lock().ok().and_then(|mut pending|pending.take())}
pub fn set_context(session:Option<String>){if let Ok(mut active)=ACTIVE_SESSION.lock(){*active=session.filter(|id|valid_id(id));}}

#[implement(INotificationActivationCallback)]
struct Activator;
impl INotificationActivationCallback_Impl for Activator_Impl {
    fn Activate(&self,app_id:&PCWSTR,arguments:&PCWSTR,data:*const NOTIFICATION_USER_INPUT_DATA,count:u32)->windows::core::Result<()> {
        if app_id.is_null()||arguments.is_null()||count>8{return Err(E_INVALIDARG.into());}
        let name=unsafe{app_id.to_string()}?;if name!=APP_ID{return Err(E_INVALIDARG.into());}
        let args=unsafe{arguments.to_string()}?;
        if args.len()>300{return Err(E_INVALIDARG.into());}
        let fields:Vec<String>=args.split('|').map(str::to_owned).collect();
        if fields.len()<2||!valid_id(&fields[1]){return Err(E_INVALIDARG.into());}
        if fields[0]=="open"{open_chat(&fields[1]);return Ok(());}
        if fields.len()!=5||!["reply","read"].contains(&fields[0].as_str())||fields[2..].iter().any(|id|!valid_id(id)){return Err(E_INVALIDARG.into());}
        let mut message=String::new();
        if count>0&&!data.is_null(){
            for item in unsafe{std::slice::from_raw_parts(data,count as usize)}{
                if !item.Key.is_null()&&!item.Value.is_null()&&unsafe{item.Key.to_string()}?=="reply"{message=unsafe{item.Value.to_string()}?;}
            }
        }
        if fields[0]=="reply"&&(message.trim().is_empty()||message.chars().count()>10000){status(&fields[1],"Ответ не отправлен. Откройте приложение и проверьте текст.");return Ok(());}
        // Keep the COM callback short; persistence and network use a worker.
        std::thread::spawn(move||{
            if owner().as_deref()!=Some(&fields[3]){open_chat(&fields[1]);return;}
            let action=Action{kind:fields[0].clone(),session_id:fields[1].clone(),delivery_id:fields[2].clone(),operator_id:fields[3].clone(),client_id:if fields[0]=="read"{Uuid::new_v4().to_string()}else{fields[4].clone()},message:message.trim().to_owned(),created_at:format_timestamp()};
            if save_action(&action).is_ok(){status(&action.session_id,"Отправляем… Ответ сохранён на этом устройстве.");run_jobs();}
            else{status(&action.session_id,"Не удалось сохранить ответ. Откройте приложение.");}
        });
        Ok(())
    }
}
fn format_timestamp()->String {
    // A numeric timestamp is normalized by the frontend recovery adapter.
    desktop::now().to_string()
}
#[implement(IClassFactory)]
struct Factory;
impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self,outer:windows::core::Ref<'_,IUnknown>,iid:*const GUID,result:*mut *mut c_void)->windows::core::Result<()> {
        if !outer.is_null(){return Err(CLASS_E_NOAGGREGATION.into());}
        if iid.is_null()||result.is_null(){return Err(E_POINTER.into());}
        unsafe{*result=std::ptr::null_mut();let callback:INotificationActivationCallback=Activator.into();callback.query(iid,result).ok()}
    }
    fn LockServer(&self,_lock:BOOL)->windows::core::Result<()>{Ok(())}
}
pub struct Registration(u32);
impl Drop for Registration{fn drop(&mut self){unsafe{let _=CoRevokeClassObject(self.0);}}}
static RETRIES:OnceLock<Mutex<HashMap<String,u8>>>=OnceLock::new();
fn run_jobs(){
    if RUNNING.swap(true,Ordering::SeqCst){return;}
    init_com();
    if let Some(operator)=owner(){
        for(path,action)in actions(){
            if path.with_extension("failed").exists()||action.operator_id!=operator{continue;}
            let response=if action.kind=="reply"{desktop::request_as("POST",&format!("/api/sessions/{}/messages",action.session_id),json!({"message":action.message,"client_message_id":action.client_id}),&operator)}
                else{desktop::request_as("PATCH",&format!("/api/sessions/{}/read",action.session_id),json!({}),&operator)};
            match response{
                Ok(_)=>{let _=remove_action(&action.client_id);hide(&action.session_id);ack(&action.delivery_id,"read",&operator);}
                Err(error)=>{
                    let mut retries=RETRIES.get_or_init(||Mutex::new(HashMap::new())).lock().unwrap_or_else(|e|e.into_inner());
                    let attempt=retries.entry(action.client_id.clone()).or_default();*attempt+=1;
                    if *attempt>=5||error.starts_with("http_4")||error=="session_required"{
                        let _=fs::write(path.with_extension("failed"),b"retry_in_app");
                        status(&action.session_id,"Ответ сохранён, но не отправлен. Откройте приложение и повторите.");
                        if let Some(app)=APP.get(){let _=app.emit("native-replies-ready",());}
                    }
                }
            }
        }
    }
    RUNNING.store(false,Ordering::SeqCst);
}
pub fn initialize(app:&tauri::AppHandle)->Result<(),String>{
    init_com();
    APP.set(app.clone()).ok();
    let root=app.path().app_local_data_dir().map_err(|_|"queue_unavailable")?.join(if cfg!(debug_assertions){"reply-queue-v8-debug"}else{"reply-queue-v8"});
    fs::create_dir_all(&root).map_err(|_|"queue_unavailable")?;QUEUE.set(root).ok();
    let exe=std::env::current_exe().map_err(|_|"app_path_unavailable")?;
    let model=windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{APP_ID}")).map_err(|_|"notification_registration_failed")?;
    model.set_string("DisplayName","Живая Сказка").map_err(|_|"notification_registration_failed")?;
    model.set_string("CustomActivator",CLSID_TEXT).map_err(|_|"notification_registration_failed")?;
    let com=windows_registry::CURRENT_USER.create(format!(r"Software\Classes\CLSID\{CLSID_TEXT}\LocalServer32")).map_err(|_|"notification_registration_failed")?;
    com.set_string("",format!("\"{}\" --toast-activated",exe.display())).map_err(|_|"notification_registration_failed")?;
    unsafe{let id=HSTRING::from(APP_ID);SetCurrentProcessExplicitAppUserModelID(PCWSTR(id.as_ptr())).map_err(|_|"notification_registration_failed")?;}
    let factory:IClassFactory=Factory.into();
    let cookie=unsafe{CoRegisterClassObject(&CLSID,&factory,CLSCTX_LOCAL_SERVER,REGCLS_MULTIPLEUSE)}.map_err(|_|"notification_registration_failed")?;
    app.manage(Registration(cookie));
    ACTIVATION_READY.store(true,Ordering::SeqCst);
    std::thread::spawn(||loop{run_jobs();std::thread::sleep(Duration::from_secs(15));});
    Ok(())
}
static ACTIVATION_READY: AtomicBool = AtomicBool::new(false);
/// Что видит сама Windows: разрешены ли уведомления приложению, готов ли обработчик нажатий
/// и сколько ответов из уведомлений ждут отправки. Без текста переписки.
pub fn diagnostics()->Result<Value,String>{
    init_com();
    let setting=ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID)).and_then(|notifier|notifier.Setting());
    let toast=match setting {
        Ok(value) if value==NotificationSetting::Enabled=>"enabled",
        Ok(value) if value==NotificationSetting::DisabledForApplication=>"disabled_for_application",
        Ok(value) if value==NotificationSetting::DisabledForUser=>"disabled_for_user",
        Ok(value) if value==NotificationSetting::DisabledByGroupPolicy=>"disabled_by_group_policy",
        Ok(value) if value==NotificationSetting::DisabledByManifest=>"disabled_by_manifest",
        Ok(_)=>"unknown",
        Err(_)=>"unavailable",
    };
    let queued=actions().len();
    Ok(json!({
        "permission": if toast=="enabled"{"granted"}else if toast.starts_with("disabled"){"denied"}else{"unknown"},
        "toast_setting": toast,
        "channel_enabled": toast=="enabled",
        "activation_ready": ACTIVATION_READY.load(Ordering::SeqCst),
        "queued_actions": queued,
    }))
}
pub fn set_badge(app:&tauri::AppHandle,count:u32){
    init_com();
    let Some(window)=app.get_webview_window("main")else{return};
    let Ok(hwnd)=window.hwnd()else{return};
    unsafe{
        let Ok(taskbar)=CoCreateInstance::<_,ITaskbarList3>(&TaskbarList,None,CLSCTX_INPROC_SERVER)else{return};
        if taskbar.HrInit().is_err(){return;}
        let mut icon=HICON::default();
        if count>0{
            let mut pixels=[0u8;16*16*4];
            for y in 0..16{for x in 0..16{if (x as i32-8).pow(2)+(y as i32-8).pow(2)<=49{let i=(y*16+x)*4;pixels[i..i+4].copy_from_slice(&[43,78,173,255]);}}}
            if let Ok(created)=CreateIcon(None,16,16,1,32,[0u8;32].as_ptr(),pixels.as_ptr()){icon=created;}
        }
        let description=HSTRING::from(if count>0{format!("Непрочитанных: {count}")}else{String::new()});
        let _=taskbar.SetOverlayIcon(HWND(hwnd.0 as _),icon,PCWSTR(description.as_ptr()));
        if !icon.is_invalid(){let _=DestroyIcon(icon);}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reply_storage_uses_os_encryption() {
        let text="synthetic reply — only for a local unit test".as_bytes();
        let encrypted=crypt(text,true).expect("DPAPI encryption");
        assert_ne!(encrypted,text);
        assert_eq!(crypt(&encrypted,false).expect("DPAPI decryption"),text);
        let mut corrupted=encrypted;corrupted[20]^=1;
        assert!(crypt(&corrupted,false).is_err());
    }
    #[test]
    fn user_content_cannot_escape_toast_xml() {
        assert_eq!(xml("<text a=\"x\">&'</text>"),"&lt;text a=&quot;x&quot;&gt;&amp;&apos;&lt;/text&gt;");
        assert!(file("../../other-app").is_err());
    }
    #[test]
    fn session_origin_is_confined_to_our_api() {
        assert!(desktop::valid_base("https://zhivaya-skazka.ru"));
        assert!(!desktop::valid_base("https://zhivaya-skazka.ru.attacker.invalid"));
        assert!(!desktop::valid_base("https://user:secret@zhivaya-skazka.ru"));
        assert!(!desktop::valid_base("http://5.129.241.152:3010"));
        assert!(!desktop::valid_base("https://zhivaya-skazka.ru/other-project"));
    }
}
