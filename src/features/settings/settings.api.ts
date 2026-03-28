import { api } from "@/lib/api";

/* ── Pre-chat form ── */

export interface PrechatField {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "select";
  required: boolean;
  options?: string[]; // for select type
}

export interface PrechatFormConfig {
  enabled: boolean;
  fields: PrechatField[];
}

export async function getPrechatFormConfig(): Promise<PrechatFormConfig> {
  return api<PrechatFormConfig>("/api/settings/prechat_form");
}

export async function savePrechatFormConfig(config: PrechatFormConfig): Promise<PrechatFormConfig> {
  return api<PrechatFormConfig>("/api/settings/prechat_form", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/* ── Widget config ── */

export interface WidgetConfig {
  position: "bottom-right" | "bottom-left";
  color: string;
  greeting: string;
  avatar_url: string | null;
  show_operator_name: boolean;
  show_operator_avatar: boolean;
  button_icon: "chat" | "help" | "custom";
  button_text: string;
  auto_open_delay: number;
  hide_on_mobile: boolean;
  custom_css: string;
}

const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  position: "bottom-right",
  color: "#8b5cf6",
  greeting: "Привет! Чем помочь?",
  avatar_url: null,
  show_operator_name: true,
  show_operator_avatar: true,
  button_icon: "chat",
  button_text: "",
  auto_open_delay: 0,
  hide_on_mobile: false,
  custom_css: "",
};

export async function getWidgetConfig(): Promise<WidgetConfig> {
  try {
    return await api<WidgetConfig>("/api/settings/widget_config");
  } catch {
    return DEFAULT_WIDGET_CONFIG;
  }
}

export async function saveWidgetConfig(config: Partial<WidgetConfig>): Promise<WidgetConfig> {
  return api<WidgetConfig>("/api/settings/widget_config", {
    method: "PATCH",
    body: JSON.stringify(config),
  });
}

export function getWidgetEmbedCode(apiBase: string): string {
  return `<script src="${apiBase}/widget.js" async></script>`;
}