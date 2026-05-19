// Динамический tray-icon с red-dot индикатором непрочитанных.
// Базовая иконка взята из ресурсов; поверх рисуется красный круг в правом нижнем углу.

#[cfg(desktop)]
use image::{ImageBuffer, Rgba, RgbaImage};

#[cfg(desktop)]
const BASE_ICON_BYTES: &[u8] = include_bytes!("../icons/128x128.png");

#[cfg(desktop)]
pub fn icon_for_count(count: u32) -> Option<tauri::image::Image<'static>> {
    let img = image::load_from_memory(BASE_ICON_BYTES).ok()?;
    let mut rgba: RgbaImage = img.to_rgba8();
    if count > 0 {
        draw_red_dot(&mut rgba);
    }
    let (w, h) = rgba.dimensions();
    let raw = rgba.into_raw();
    // Tauri Image::new требует 'static — отдадим Boxed.
    let leaked: &'static [u8] = Box::leak(raw.into_boxed_slice());
    Some(tauri::image::Image::new(leaked, w, h))
}

#[cfg(desktop)]
fn draw_red_dot(img: &mut ImageBuffer<Rgba<u8>, Vec<u8>>) {
    let (w, h) = img.dimensions();
    // Радиус ~22% от ширины, центр в нижнем-правом 25/25 от края.
    let radius = (w as f32 * 0.22) as i32;
    let cx = (w as i32) - radius - (w as f32 * 0.06) as i32;
    let cy = (h as i32) - radius - (h as f32 * 0.06) as i32;

    let red = Rgba([239u8, 68, 68, 255]);
    let white = Rgba([255u8, 255, 255, 255]);

    // Белая обводка-кайма, чуть больший радиус.
    fill_circle(img, cx, cy, radius + (w as i32 / 32).max(2), white);
    fill_circle(img, cx, cy, radius, red);
}

#[cfg(desktop)]
fn fill_circle(img: &mut ImageBuffer<Rgba<u8>, Vec<u8>>, cx: i32, cy: i32, r: i32, color: Rgba<u8>) {
    let (w, h) = (img.width() as i32, img.height() as i32);
    let r2 = r * r;
    // Anti-aliased edge: считаем расстояние до центра, плавно смешиваем с фоном.
    let aa_band = 1.5f32;
    for y in (cy - r - 1).max(0)..(cy + r + 1).min(h) {
        for x in (cx - r - 1).max(0)..(cx + r + 1).min(w) {
            let dx = (x - cx) as f32;
            let dy = (y - cy) as f32;
            let dist = (dx * dx + dy * dy).sqrt();
            let edge = r as f32 - dist;
            if edge >= aa_band {
                img.put_pixel(x as u32, y as u32, color);
            } else if edge > 0.0 {
                let a = (edge / aa_band).clamp(0.0, 1.0);
                let base = img.get_pixel(x as u32, y as u32).0;
                let r_c = mix(base[0], color[0], a);
                let g_c = mix(base[1], color[1], a);
                let b_c = mix(base[2], color[2], a);
                let a_c = mix(base[3], color[3], a);
                img.put_pixel(x as u32, y as u32, Rgba([r_c, g_c, b_c, a_c]));
            }
            // если r2 далеко превышен — оставляем как есть
            let _ = r2;
        }
    }
}

#[cfg(desktop)]
fn mix(a: u8, b: u8, t: f32) -> u8 {
    ((a as f32) * (1.0 - t) + (b as f32) * t).round().clamp(0.0, 255.0) as u8
}
