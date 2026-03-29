import { api, API_BASE } from "@/lib/api";

/* ── Pre-chat form ── */

export interface PrechatField {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "select" | "textarea";
  required: boolean;
  placeholder?: string;
  options?: string[]; // for select type
}

export interface PrechatFormConfig {
  enabled: boolean;
  fields: PrechatField[];
}

export async function getPrechatFormConfig(): Promise<PrechatFormConfig> {
  return api<PrechatFormConfig>("/api/widget-settings/prechat");
}

export async function savePrechatFormConfig(config: PrechatFormConfig): Promise<{ ok: boolean; prechat: PrechatFormConfig }> {
  return api("/api/widget-settings/prechat", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/* ── Widget config ── */

export interface WidgetConfig {
  position: "bottom-right" | "bottom-left";
  color: string;
  greeting: string;
  header_title: string;
  avatar_url: string | null;
  show_operator_name: boolean;
  show_operator_avatar: boolean;
  button_icon: "chat" | "help" | "custom";
  button_text: string;
  button_size: "small" | "medium" | "large";
  button_radius: "round" | "rounded" | "square";
  auto_open_delay: number;
  hide_on_mobile: boolean;
  custom_css: string;
  // 1.1 Gradient
  gradient_type: "solid" | "gradient" | "glass" | "animated";
  gradient_from: string;
  gradient_to: string;
  gradient_angle: number;
  // 1.2 Theme
  theme: "light" | "dark" | "auto" | "custom";
  custom_bg: string;
  custom_text: string;
  custom_bubble_bg: string;
  custom_border: string;
  // 1.3 Animation
  open_animation: "slide" | "pop" | "fade" | "bounce" | "flip";
  // 1.4 Launcher
  launcher_type: "icon_only" | "icon_text" | "text_only" | "card";
  launcher_text: string;
  launcher_subtext: string;
  launcher_show_avatar: boolean;
  launcher_pulse: boolean;
  // 1.5 Font
  font_family: "system" | "inter" | "roboto" | "montserrat" | "custom";
  custom_font_url: string;
  // 2.1 Triggers
  triggers: {
    exit_intent: boolean;
    scroll_percent: number | null;
    time_on_page: number | null;
    page_url_contains: string;
    inactivity_seconds: number | null;
  };
  // 2.2 Quick replies
  quick_replies_enabled: boolean;
  quick_replies: string[];
  // 2.3 Response time
  response_time_enabled: boolean;
  response_time_label: string;
  // 3.1 Team
  team_mode: boolean;
  team_avatars_count: number;
  team_label: string;
  team_online_text: string;
  // 4.1 Offline
  offline_mode: "message_only" | "email_capture" | "callback_request" | "redirect";
  offline_redirect_url: string;
  // 2.2 Auto messages
  auto_messages: AutoMessage[];
  // 4.2 A/B testing
  ab_test_enabled: boolean;
  ab_variants: {
    a: { greeting: string; weight: number };
    b: { greeting: string; weight: number };
  };
  ab_metric: "open_rate" | "message_rate" | "rating";
  // 6.1 Page rules
  page_rules: PageRule[];
  // 6.3 Identity
  identity_verification: boolean;
  _ab_variant?: string;
}

export interface AutoMessage {
  id: string;
  enabled: boolean;
  trigger: "first_visit" | "return_visit" | "on_page" | "after_idle" | "cart_abandon";
  delay_seconds: number;
  message: string;
  sender_name: string;
  sender_avatar?: string;
  page_filter?: string;
  show_once: boolean;
}

export interface PageRule {
  id: string;
  pattern: string;
  match_type: "exact" | "contains" | "regex";
  override: Partial<WidgetConfig>;
  enabled: boolean;
}

export interface ABStats {
  variant: string;
  event: string;
  count: number;
}

const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  position: "bottom-right",
  color: "#8b5cf6",
  greeting: "Привет! Чем помочь?",
  header_title: "Онлайн-чат",
  avatar_url: null,
  show_operator_name: true,
  show_operator_avatar: true,
  button_icon: "chat",
  button_text: "",
  button_size: "medium",
  button_radius: "round",
  auto_open_delay: 0,
  hide_on_mobile: false,
  custom_css: "",
  gradient_type: "solid",
  gradient_from: "#8b5cf6",
  gradient_to: "#ec4899",
  gradient_angle: 135,
  theme: "light",
  custom_bg: "#ffffff",
  custom_text: "#1f2937",
  custom_bubble_bg: "#f3f4f6",
  custom_border: "#e5e7eb",
  open_animation: "slide",
  launcher_type: "icon_only",
  launcher_text: "Нужна помощь?",
  launcher_subtext: "Обычно отвечаем за 2 мин",
  launcher_show_avatar: true,
  launcher_pulse: true,
  font_family: "system",
  custom_font_url: "",
  triggers: {
    exit_intent: false,
    scroll_percent: null,
    time_on_page: null,
    page_url_contains: "",
    inactivity_seconds: null,
  },
  quick_replies_enabled: false,
  quick_replies: [],
  response_time_enabled: false,
  response_time_label: "Обычно отвечаем за 2 мин",
  team_mode: false,
  team_avatars_count: 3,
  team_label: "Команда поддержки",
  team_online_text: "{n} онлайн",
  offline_mode: "message_only",
  offline_redirect_url: "",
  auto_messages: [],
  ab_test_enabled: false,
  ab_variants: {
    a: { greeting: "Привет! 👋 Чем помочь?", weight: 50 },
    b: { greeting: "Здравствуйте! Задайте вопрос 💬", weight: 50 },
  },
  ab_metric: "message_rate",
  page_rules: [],
  identity_verification: false,
};

export async function getWidgetConfig(): Promise<WidgetConfig> {
  try {
    return await api<WidgetConfig>("/api/widget-settings/config");
  } catch {
    return DEFAULT_WIDGET_CONFIG;
  }
}

export async function saveWidgetConfig(config: Partial<WidgetConfig>): Promise<WidgetConfig> {
  const res = await api<{ ok: boolean; config: WidgetConfig }>("/api/widget-settings/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
  return res.config;
}

/* ── Business hours ── */

export interface DaySchedule {
  enabled: boolean;
  from: string; // "09:00"
  to: string;   // "18:00"
}

export interface BusinessHours {
  enabled: boolean;
  timezone: string;
  offline_message: string;
  schedule: {
    mon: DaySchedule;
    tue: DaySchedule;
    wed: DaySchedule;
    thu: DaySchedule;
    fri: DaySchedule;
    sat: DaySchedule;
    sun: DaySchedule;
  };
}

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  enabled: false,
  timezone: "Europe/Moscow",
  offline_message: "Мы сейчас офлайн. Оставьте сообщение!",
  schedule: {
    mon: { enabled: true, from: "09:00", to: "18:00" },
    tue: { enabled: true, from: "09:00", to: "18:00" },
    wed: { enabled: true, from: "09:00", to: "18:00" },
    thu: { enabled: true, from: "09:00", to: "18:00" },
    fri: { enabled: true, from: "09:00", to: "18:00" },
    sat: { enabled: false, from: "10:00", to: "16:00" },
    sun: { enabled: false, from: "10:00", to: "16:00" },
  },
};

export async function getBusinessHours(): Promise<BusinessHours> {
  try {
    return await api<BusinessHours>("/api/widget-settings/business-hours");
  } catch {
    return DEFAULT_BUSINESS_HOURS;
  }
}

export async function saveBusinessHours(hours: BusinessHours): Promise<BusinessHours> {
  const res = await api<{ ok: boolean; hours: BusinessHours }>("/api/widget-settings/business-hours", {
    method: "PUT",
    body: JSON.stringify(hours),
  });
  return res.hours;
}

/* ── Allowed domains ── */

export interface DomainSettings {
  enabled: boolean;
  domains: string[];
  rate_limit: number; // requests per minute
}

const DEFAULT_DOMAINS: DomainSettings = {
  enabled: false,
  domains: [],
  rate_limit: 30,
};

export async function getDomainSettings(): Promise<DomainSettings> {
  try {
    return await api<DomainSettings>("/api/widget-settings/domains");
  } catch {
    return DEFAULT_DOMAINS;
  }
}

export async function saveDomainSettings(domains: DomainSettings): Promise<DomainSettings> {
  const res = await api<{ ok: boolean; domains: DomainSettings }>("/api/widget-settings/domains", {
    method: "PUT",
    body: JSON.stringify(domains),
  });
  return res.domains;
}

/* ── Avatar upload ── */

export async function uploadWidgetAvatar(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const token = localStorage.getItem("chat_token");
  const res = await fetch(`${API_BASE}/api/widget-settings/avatar`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.avatar_url;
}

/* ── A/B Stats ── */

export async function getABStats(): Promise<ABStats[]> {
  return api<ABStats[]>("/api/widget-settings/ab-stats");
}

/* ── Offline leads ── */

export interface OfflineLead {
  id: string;
  visitor_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  preferred_time: string | null;
  page_url: string | null;
  created_at: string;
}

export async function getOfflineLeads(): Promise<OfflineLead[]> {
  return api<OfflineLead[]>("/api/widget-settings/offline-leads");
}
/* ── Embed code ── */

export function getWidgetEmbedCode(apiBase: string): string {
  return `<script src="${apiBase}/widget.js" async></script>`;
}