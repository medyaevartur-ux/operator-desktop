import type { WidgetConfig } from "@/features/settings/settings.api";

export interface StylePreset {
  id: string;
  name: string;
  hint: string;
  /** Как стиль выглядит на мини-превью: цвет шапки/кнопки и фон окна. */
  look: { from: string; to?: string; body: string; ink: string };
  patch: Partial<WidgetConfig>;
}

/** Готовые стили меняют только оформление; тексты, правила и автоматика остаются как были. */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "skazka", name: "Живая Сказка", hint: "Фирменный терракотовый, мягкие формы",
    look: { from: "#c15f3c", body: "#fbf9f4", ink: "#e9e4d9" },
    patch: { color: "#c15f3c", gradient_type: "solid", theme: "light", header_style: "light", font_family: "onest", button_radius: "round", bubble_radius: "round", shadow_intensity: "medium", launcher_type: "icon_only", launcher_pulse: false },
  },
  {
    id: "fairy", name: "Сказочный", hint: "Тёплое золото с мягким переходом",
    look: { from: "#d97706", to: "#fbbf24", body: "#fffaf0", ink: "#f3e5c8" },
    patch: { color: "#d97706", gradient_type: "gradient", gradient_from: "#d97706", gradient_to: "#fbbf24", gradient_angle: 135, theme: "light", header_style: "accent", font_family: "onest", button_radius: "round", bubble_radius: "round", shadow_intensity: "medium", launcher_type: "icon_only", launcher_pulse: true },
  },
  {
    id: "minimal", name: "Минимал", hint: "Графит, строгие углы, лёгкая тень",
    look: { from: "#1f2937", body: "#ffffff", ink: "#e7e7e4" },
    patch: { color: "#1f2937", gradient_type: "solid", theme: "light", header_style: "light", font_family: "inter", button_radius: "square", bubble_radius: "sharp", shadow_intensity: "subtle", launcher_type: "icon_only", launcher_pulse: false },
  },
  {
    id: "night", name: "Ночной", hint: "Тёмное окно и фиолетовый акцент",
    look: { from: "#7c3aed", to: "#c026d3", body: "#1f1d2b", ink: "#35324a" },
    patch: { color: "#7c3aed", gradient_type: "gradient", gradient_from: "#7c3aed", gradient_to: "#c026d3", gradient_angle: 135, theme: "dark", header_style: "accent", font_family: "inter", button_radius: "round", bubble_radius: "soft", shadow_intensity: "strong", launcher_type: "icon_only", launcher_pulse: true },
  },
  {
    id: "bright", name: "Яркий", hint: "Карточка у кнопки и живой перелив",
    look: { from: "#db2777", to: "#7c3aed", body: "#ffffff", ink: "#f1e6f0" },
    patch: { color: "#db2777", gradient_type: "animated", gradient_from: "#db2777", gradient_to: "#7c3aed", theme: "light", header_style: "accent", font_family: "montserrat", button_radius: "round", bubble_radius: "round", shadow_intensity: "strong", launcher_type: "card", launcher_pulse: true },
  },
];

export const COLOR_SWATCHES = ["#c15f3c", "#cc5a01", "#d97706", "#be123c", "#db2777", "#7c3aed", "#4f46e5", "#0369a1", "#0f766e", "#15803d", "#1f2937"];

export const FONTS: Array<{ value: WidgetConfig["font_family"]; label: string; css: string }> = [
  { value: "onest", label: "Onest", css: "Onest, system-ui, sans-serif" },
  { value: "inter", label: "Inter", css: "Inter, system-ui, sans-serif" },
  { value: "roboto", label: "Roboto", css: "Roboto, system-ui, sans-serif" },
  { value: "montserrat", label: "Montserrat", css: "Montserrat, system-ui, sans-serif" },
  { value: "system", label: "Системный", css: "system-ui, sans-serif" },
  { value: "custom", label: "Свой", css: "inherit" },
];

export const DAYS: Array<{ key: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; label: string }> = [
  { key: "mon", label: "Понедельник" }, { key: "tue", label: "Вторник" }, { key: "wed", label: "Среда" },
  { key: "thu", label: "Четверг" }, { key: "fri", label: "Пятница" }, { key: "sat", label: "Суббота" }, { key: "sun", label: "Воскресенье" },
];

export const TIMEZONES = [
  { value: "Europe/Kaliningrad", label: "Калининград · UTC+2" },
  { value: "Europe/Moscow", label: "Москва · UTC+3" },
  { value: "Europe/Minsk", label: "Минск · UTC+3" },
  { value: "Europe/Samara", label: "Самара · UTC+4" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург · UTC+5" },
  { value: "Asia/Tashkent", label: "Ташкент · UTC+5" },
  { value: "Asia/Omsk", label: "Омск · UTC+6" },
  { value: "Asia/Almaty", label: "Алматы · UTC+6" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск · UTC+7" },
  { value: "Asia/Irkutsk", label: "Иркутск · UTC+8" },
  { value: "Asia/Yakutsk", label: "Якутск · UTC+9" },
  { value: "Asia/Vladivostok", label: "Владивосток · UTC+10" },
  { value: "Asia/Kamchatka", label: "Камчатка · UTC+12" },
];

export const AUTO_MESSAGE_TRIGGERS = [
  { value: "first_visit", label: "Первый визит" },
  { value: "return_visit", label: "Повторный визит" },
  { value: "on_page", label: "На странице" },
  { value: "after_idle", label: "Бездействие" },
  { value: "cart_abandon", label: "Брошенная корзина" },
] as const;

/** Человеческие названия полей — для сообщения, если сервер что-то не принял. */
export const FIELD_LABELS: Record<string, string> = {
  color: "основной цвет", gradient_type: "заливка", gradient_from: "начало градиента", gradient_to: "конец градиента", gradient_angle: "угол градиента",
  theme: "тема окна", custom_bg: "фон окна", custom_text: "цвет текста", custom_bubble_bg: "фон сообщений", custom_border: "цвет рамок", header_style: "шапка окна",
  font_family: "шрифт", custom_font_url: "ссылка на шрифт", font_size_base: "размер текста",
  header_title: "заголовок", avatar_url: "аватар", show_operator_name: "имя оператора", show_operator_avatar: "фото оператора",
  team_mode: "команда в шапке", team_label: "название команды", team_online_text: "строка «в сети»", team_avatars_count: "число аватаров",
  response_time_enabled: "время ответа", response_time_label: "текст времени ответа",
  launcher_type: "вид кнопки", launcher_text: "текст кнопки", launcher_subtext: "подпись карточки", launcher_show_avatar: "фото в карточке", launcher_pulse: "пульсация",
  button_icon: "значок", button_text: "текст кнопки", button_size: "размер кнопки", button_radius: "форма кнопки", position: "сторона экрана", edge_margin: "отступ от края",
  window_width: "ширина окна", bubble_radius: "скругление сообщений", shadow_intensity: "тень", open_animation: "появление окна", show_powered_by: "подпись внизу",
  mobile_launcher_type: "кнопка на телефоне", mobile_window_mode: "окно на телефоне", mobile_hide_unread_badge: "счётчик на телефоне",
  mobile_invitation_enabled: "подсказка на телефоне", mobile_invitation_text: "текст подсказки", mobile_invitation_delay: "задержка подсказки",
  display_pages_mode: "где показывать", display_pages: "список страниц", hidden_paths: "служебные разделы", hide_on_mobile: "скрыть на телефонах",
  greeting: "приветствие", greet_once: "приветствие один раз", quick_replies_enabled: "быстрые вопросы", quick_replies: "список быстрых вопросов",
  remember_open_state: "помнить открытое окно", auto_minimize_after: "сворачивание", hide_unread_badge: "счётчик непрочитанных", disable_sound_for_visitor: "звуки",
  page_rules: "правила для страниц", auto_invite_enabled: "автоматические приглашения", auto_invite_delay: "задержка приглашения",
  auto_invite_message: "текст приглашения", auto_invite_cooldown_hours: "пауза после отказа", auto_open_delay: "автооткрытие", triggers: "условия открытия",
  auto_messages: "автосообщения", ab_test_enabled: "A/B-тест", ab_variants: "варианты теста", ab_metric: "метрика теста",
  offline_mode: "режим «никого нет»", offline_redirect_url: "страница контактов", identity_verification: "узнавание покупателей", custom_css: "свой CSS",
};

/** Шапка и кнопка: сплошной цвет, градиент или стекло — как в виджете. */
export function fillOf(config: Pick<WidgetConfig, "gradient_type" | "color" | "gradient_from" | "gradient_to" | "gradient_angle">): string {
  const from = config.gradient_from || config.color, to = config.gradient_to || config.color;
  if (config.gradient_type === "gradient") return `linear-gradient(${config.gradient_angle ?? 135}deg, ${from}, ${to})`;
  if (config.gradient_type === "animated") return `linear-gradient(90deg, ${from}, ${to}, ${from})`;
  if (config.gradient_type === "glass") return `color-mix(in srgb, ${config.color} 55%, transparent)`;
  return config.color;
}
