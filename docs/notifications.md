# Интеграция нативных Windows-уведомлений (WinRT Toast) и динамического трея в Tauri v2

Этот документ предоставляет исчерпывающие инструкции и готовые шаблоны кода на Rust для реализации передовых нативных функций в операционной системе Windows:
1. **Нативные WinRT Toast уведомления** с поддержкой быстрого текстового ответа (Inline Reply) прямо из всплывающего уведомления Windows.
2. **Динамическая иконка системного трея** с автоматической генерацией счётчика непрочитанных сообщений поверх иконки приложения.

---

## 📯 Часть 1. WinRT Toast уведомления с Inline-ответом

Для того чтобы пользователь мог ответить на сообщение прямо из системного уведомления Windows, стандартного Tauri Notification API недостаточно. Нам понадобится напрямую взаимодействовать с WinRT API через официальный Rust-крейт `windows`.

### 1. Настройка зависимостей (`Cargo.toml`)
Добавьте следующие крейты в `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2.0.0", features = [] }
# Для работы с WinRT Toast и XML разметкой
windows = { version = "0.56.0", features = [
    "Data_Xml_Dom",
    "UI_Notifications",
    "UI_Shell",
] }
```

### 2. Rust-реализация отправки Toast с полем ввода
Создадим функцию на Rust, которая конструирует XML-структуру уведомления с текстовым полем и кнопкой отправки, регистрирует её в Windows ToastNotificationManager и обрабатывает входящие ответы.

Создайте или обновите модуль `src-tauri/src/toast.rs`:

```rust
use tauri::{AppHandle, Emitter};
use windows::Data::Xml::Dom::XmlDocument;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

#[tauri::command]
pub fn show_winrt_toast(
    app: AppHandle,
    session_id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    // 1. Формируем XML для Toast-уведомления с полем быстрого ответа (Inline Reply)
    let toast_xml_str = format!(
        r#"<toast launch="action=view&amp;sessionId={session_id}">
            <visual>
                <binding template="ToastGeneric">
                    <text>{title}</text>
                    <text>{body}</text>
                </binding>
            </visual>
            <actions>
                <input id="replyText" type="text" placeHolderContent="Напишите ответ..." />
                <action content="Отправить" 
                        arguments="action=reply&amp;sessionId={session_id}" 
                        activationType="background" 
                        inputId="replyText" />
                <action content="Открыть чат" 
                        arguments="action=view&amp;sessionId={session_id}" 
                        activationType="foreground" />
            </actions>
        </toast>"#,
        session_id = session_id,
        title = title,
        body = body
    );

    let doc = XmlDocument::new().map_err(|e| e.to_string())?;
    doc.LoadXml(&windows::core::HSTRING::from(toast_xml_str))
        .map_err(|e| e.to_string())?;

    // 2. Создаем уведомление
    let notification = ToastNotification::CreateToastNotification(&doc)
        .map_err(|e| e.to_string())?;

    // Устанавливаем тег и группу для легкого управления/удаления уведомления
    notification.SetTag(&windows::core::HSTRING::from(&session_id))
        .map_err(|e| e.to_string())?;

    // 3. Отправляем через системный менеджер под AppId вашего Tauri-приложения
    // AppId должен точно совпадать с тем, что прописано в реестре Windows (обычно берется из bundle id)
    let app_id = "com.zhivaya-skazka.operator"; 
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&windows::core::HSTRING::from(app_id))
        .map_err(|e| e.to_string())?;

    notifier.Show(&notification).map_err(|e| e.to_string())?;

    Ok(())
}
```

### 3. Обработка клика и inline-ответа в Rust
При клике на фоновую кнопку "Отправить" Windows запускает COM-активатор приложения. В Tauri v2 мы можем перехватить эти аргументы в методе `on_tray_icon_event` или через фоновую обработку аргументов запуска. 

Пример регистрации и проброса события на фронтенд в `src-tauri/src/lib.rs`:

```rust
use tauri::{AppHandle, Emitter, Manager};

// Функция парсинга аргументов запуска (когда кликнули по кнопке в Toast)
pub fn handle_notification_action(app: &AppHandle, args: &str) {
    // args имеет вид: "action=reply&sessionId=v_12345"
    if let Some(session_id) = extract_param(args, "sessionId") {
        if args.contains("action=reply") {
            // В Windows 10/11 введенный пользователем текст прилетает в аргументах или через ValueSet.
            // Ниже приведен способ отправки события на фронтенд для обработки.
            // Для полноценного извлечения текста в фоновом режиме используется интерфейс ToastNotificationActivatedEventArgs.
            app.emit("toast-reply-received", serde_json::json!({
                "sessionId": session_id,
                "text": "Ответ из уведомления Windows" // Замените на реальный текст из Windows ValueSet
            })).unwrap();
        } else if args.contains("action=view") {
            // Восстанавливаем и фокусируем окно
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                // Перенаправляем на нужный диалог
                app.emit("navigate-to-session", session_id).unwrap();
            }
        }
    }
}

fn extract_param(query: &str, param: &str) -> Option<String> {
    for part in query.split('&') {
        let mut kv = part.split('=');
        if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
            if k == param {
                return Some(v.to_string());
            }
        }
    }
    None
}
```

---

## 📥 Часть 2. Динамическая иконка трея со счётчиком сообщений

Для отображения количества непрочитанных сообщений прямо на иконке трея в Windows мы будем динамически генерировать изображение иконки (Bitmap) средствами Windows GDI+ или крейта `image`, рисовать на нем цифру и устанавливать в качестве иконки трея Tauri.

### 1. Дополнительные зависимости (`Cargo.toml`)
```toml
[dependencies]
# Для создания и рисования на изображениях в памяти
image = "0.25.1"
imageproc = "0.23.0"
rusttype = "0.9.3"
```

### 2. Код генерации иконки со счётчиком в Rust
Создайте модуль `src-tauri/src/tray.rs`:

```rust
use image::{ImageFormat, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use rusttype::{Font, Scale};
use std::io::Cursor;
use tauri::{AppHandle, Manager};

// Встраиваем базовую иконку приложения (256x256 или 32x32)
const BASE_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");

pub fn update_tray_badge(app: &AppHandle, count: i32) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("Tray icon not found")?;

    if count <= 0 {
        // Если сообщений нет, сбрасываем на оригинальную иконку
        let img = tauri::image::Image::from_bytes(BASE_ICON_BYTES)
            .map_err(|e| e.to_string())?;
        tray.set_icon(Some(img)).map_err(|e| e.to_string())?;
        return Ok(());
    }

    // 1. Декодируем базовое изображение
    let base_img = image::load_from_memory(BASE_ICON_BYTES)
        .map_err(|e| e.to_string())?
        .to_rgba8();

    let width = base_img.width();
    let height = base_img.height();
    let mut canvas = base_img.clone();

    // 2. Рисуем красный круг-подложку для цифры в правом нижнем углу
    // (для иконки 32x32)
    let circle_color = Rgba([239, 68, 68, 255]); // #ef4444 (Красный)
    let border_color = Rgba([255, 255, 255, 255]); // Белая обводка

    // Параметры круга счетчика
    let radius = 10.0;
    let center_x = (width as f32 - radius - 2.0) as i32;
    let center_y = (height as f32 - radius - 2.0) as i32;

    // Рисуем обводку и сам круг
    draw_circle(&mut canvas, center_x, center_y, radius as i32 + 1, border_color);
    draw_circle(&mut canvas, center_x, center_y, radius as i32, circle_color);

    // 3. Пишем текст счетчика
    let font_data = include_bytes!("../fonts/SourceSansPro-Bold.ttf"); // Добавьте любой TrueType шрифт в проект
    let font = Font::try_from_bytes(font_data).ok_or("Failed to load font")?;

    let text = count.to_string();
    let scale = Scale::uniform(14.0);
    
    // Центрируем текст по оси X в зависимости от ширины цифры
    let text_x = if count < 10 {
        center_x - 4
    } else {
        center_x - 8
    };
    let text_y = center_y - 7;

    draw_text_mut(
        &mut canvas,
        Rgba([255, 255, 255, 255]), // Белый цвет текста
        text_x,
        text_y,
        scale,
        &font,
        &text,
    );

    // 4. Преобразуем Canvas обратно в байты PNG
    let mut png_bytes = Vec::new();
    canvas
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    // 5. Устанавливаем обновленное изображение в трей Tauri
    let tray_img = tauri::image::Image::from_bytes(&png_bytes)
        .map_err(|e| e.to_string())?;
    tray.set_icon(Some(tray_img)).map_err(|e| e.to_string())?;

    Ok(())
}

// Простая функция рисования заполненного круга для GDI-подобного вывода
fn draw_circle(img: &mut RgbaImage, cx: i32, cy: i32, r: i32, color: Rgba<u8>) {
    for y in -r..=r {
        for x in -r..=r {
            if x * x + y * y <= r * r {
                let px = cx + x;
                let py = cy + y;
                if px >= 0 && px < img.width() as i32 && py >= 0 && py < img.height() as i32 {
                    img.put_pixel(px as u32, py as u32, color);
                }
            }
        }
    }
}
```

### 3. Интеграция с командами Tauri
Добавьте команду в `src-tauri/src/lib.rs` для вызова с фронтенда:

```rust
#[tauri::command]
pub fn set_tray_badge(app: tauri::AppHandle, count: i32) -> Result<(), String> {
    crate::tray::update_tray_badge(&app, count)
}
```

---

## ⚡ Интеграция с Фронтендом (React / TypeScript)

На стороне React при получении или изменении счетчика непрочитанных сообщений в `notification.store.ts` мы просто вызываем нативный мост Tauri:

```typescript
import { invoke } from "@tauri-apps/api/core";

// Функция синхронизации счетчика
export async function syncNativeTrayBadge(count: number) {
  try {
    await invoke("set_tray_badge", { count });
    console.log(`[Tauri] Tray badge updated to ${count}`);
  } catch (e) {
    console.warn("[Tauri] Tray badge update not supported or failed:", e);
  }
}

// Вызов нативного WinRT Toast при новом сообщении
export async function showNativeWinRTToast(sessionId: string, title: string, body: string) {
  try {
    await invoke("show_winrt_toast", { sessionId, title, body });
  } catch (e) {
    console.warn("[Tauri] Native toast error:", e);
  }
}
```

Эти тривиальные, но крайне эффективные фрагменты кода на Rust превратят Tauri-приложение в глубоко интегрированное решение корпоративного класса, превосходно работающее в среде Windows!
