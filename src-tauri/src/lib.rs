#[cfg(desktop)]
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

#[cfg(not(desktop))]
use tauri::Manager;

// ═══ IPC Commands ═══

#[tauri::command]
fn set_badge_count(app: tauri::AppHandle, count: u32) {
    #[cfg(desktop)]
    {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let tooltip = if count > 0 {
                format!("Alphabet Chat — {} непрочитанных", count)
            } else {
                "Alphabet Chat".to_string()
            };
            let _ = tray.set_tooltip(Some(&tooltip));

            if count > 0 {
                let title_str = format!("({})", count);
                let _ = tray.set_title(Some(&title_str));
            } else {
                let _ = tray.set_title(None::<&str>);
            }
        }

        if let Some(window) = app.get_webview_window("main") {
            if count > 0 {
                let _ = window.set_title(&format!("({}) Alphabet Chat", count));
            } else {
                let _ = window.set_title("Alphabet Chat");
            }
        }
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, count);
    }
}

#[tauri::command]
fn get_close_to_tray(app: tauri::AppHandle) -> bool {
    #[cfg(desktop)]
    {
        app.state::<AppSettings>()
            .close_to_tray
            .load(std::sync::atomic::Ordering::Relaxed)
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, value: bool) {
    #[cfg(desktop)]
    {
        app.state::<AppSettings>()
            .close_to_tray
            .store(value, std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, value);
    }
}

#[tauri::command]
fn notify_offline(api_url: String, operator_id: String) {
    #[cfg(desktop)]
    {
        std::thread::spawn(move || {
            let client = reqwest::blocking::Client::new();
            let _ = client
                .post(&format!("{}/api/operators/{}/online", api_url, operator_id))
                .json(&serde_json::json!({ "is_online": false }))
                .timeout(std::time::Duration::from_secs(3))
                .send();
        });
    }
    #[cfg(not(desktop))]
    {
        let _ = (api_url, operator_id);
    }
}

// ═══ App State ═══

struct AppSettings {
    close_to_tray: std::sync::atomic::AtomicBool,
}

// ═══ Run ═══

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppSettings {
            close_to_tray: std::sync::atomic::AtomicBool::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            set_badge_count,
            get_close_to_tray,
            set_close_to_tray,
            notify_offline,
        ]);

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|_app| {
            #[cfg(desktop)]
            {
                let app = _app;
                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Alphabet Chat")
                    .icon_as_template(false)
                    .on_tray_icon_event(|tray_icon: &tauri::tray::TrayIcon, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray_icon.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                let app_handle = app.handle().clone();
                if let Some(window) = app.get_webview_window("main") {
                    window.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            let close_to_tray = app_handle
                                .state::<AppSettings>()
                                .close_to_tray
                                .load(std::sync::atomic::Ordering::Relaxed);

                            if close_to_tray {
                                api.prevent_close();
                                if let Some(w) = app_handle.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                            } else {
                                if let Some(w) = app_handle.get_webview_window("main") {
                                    let _ = w.emit("app-closing", ());
                                }
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}