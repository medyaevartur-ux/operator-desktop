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

/* ── Embed code ── */

export function getWidgetEmbedCode(apiBase: string): string {
  return `<script src="${apiBase}/widget.js" async></script>`;
}