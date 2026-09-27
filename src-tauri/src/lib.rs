#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

#[cfg(desktop)]
mod tray_icon;
mod session_vault;
#[cfg(windows)]
mod native_notifications;


// ═══ IPC Commands ═══

#[tauri::command]
fn set_badge_count(app: tauri::AppHandle, count: u32) {
    #[cfg(windows)]
    native_notifications::set_badge(&app,count);
    #[cfg(desktop)]
    {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let tooltip = if count > 0 {
                format!("Живая Сказка — {} непрочитанных", count)
            } else {
                "Живая Сказка".to_string()
            };
            let _ = tray.set_tooltip(Some(&tooltip));

            if count > 0 {
                let title_str = format!("({})", count);
                let _ = tray.set_title(Some(&title_str));
            } else {
                let _ = tray.set_title(None::<&str>);
            }

            // Перерисовываем иконку — красный индикатор появляется при count > 0.
            if let Some(icon) = tray_icon::icon_for_count(count) {
                let _ = tray.set_icon(Some(icon));
            }
        }

        if let Some(window) = app.get_webview_window("main") {
            if count > 0 {
                let _ = window.set_title(&format!("({}) Живая Сказка", count));
            } else {
                let _ = window.set_title("Живая Сказка");
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

// ═══ App State ═══

#[cfg(desktop)]
struct AppSettings {
    close_to_tray: std::sync::atomic::AtomicBool,
}

// ═══ Run ═══

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
            }
        }));
    let builder = builder
        .plugin(session_vault::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            set_badge_count,
            get_close_to_tray,
            set_close_to_tray,
            session_vault::auth_save_session,
            session_vault::auth_get_session,
            session_vault::auth_clear_session,
            session_vault::set_native_chat_context,
            session_vault::show_chat_notification,
            session_vault::read_native_replies,
            session_vault::ack_native_reply,
            session_vault::take_native_notification,
            session_vault::notification_diagnostics,
            session_vault::open_system_settings,
            session_vault::android_update_check,
            session_vault::android_update_download,
            session_vault::android_update_install,
            session_vault::android_update_cancel,
        ]);

    #[cfg(desktop)]
    let builder=builder.manage(AppSettings {close_to_tray:std::sync::atomic::AtomicBool::new(true)})
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent,Some(vec!["--minimized"])));

    builder
        .setup(|_app| {
            #[cfg(windows)]
            if native_notifications::initialize(_app.handle()).is_err() { eprintln!("[native] Notifications registration unavailable"); }
            #[cfg(desktop)]
            {
                let app = _app;

                // ─── Tray context menu (ПКМ) ───
                let mi_open = MenuItem::with_id(app, "tray-open", "Открыть Живая Сказка", true, None::<&str>)?;
                let mi_hide = MenuItem::with_id(app, "tray-hide", "Свернуть в трей", true, None::<&str>)?;
                let sep = PredefinedMenuItem::separator(app)?;
                let mi_quit = MenuItem::with_id(app, "tray-quit", "Закрыть полностью", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[&mi_open, &mi_hide, &sep, &mi_quit])?;

                let _tray = TrayIconBuilder::with_id("main-tray")
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Живая Сказка — Оператор")
                    .icon_as_template(false)
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "tray-open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "tray-hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "tray-quit" => {
                            // Принудительный выход — обходим close-to-tray.
                            app.state::<AppSettings>()
                                .close_to_tray
                                .store(false, std::sync::atomic::Ordering::Relaxed);
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("app-closing", ());
                            }
                            app.exit(0);
                        }
                        _ => {}
                    })
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

                if std::env::args().any(|arg| arg == "--minimized" || arg == "--toast-activated") {
                    if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
                }

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
