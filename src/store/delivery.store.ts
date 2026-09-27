import { create } from "zustand";
import { api } from "@/lib/api";
import { useNotificationStore } from "./notification.store";
export interface DeliveryPreferences { enabled: boolean; new_messages: boolean; escalation: boolean; show_preview: boolean; dnd_start: string | null; dnd_end: string | null; timezone: string }
export interface DeviceReport {
  permission?: "granted" | "denied" | "default" | "unknown"; channel_enabled?: boolean | null; battery_optimized?: boolean | null;
  background_restricted?: boolean | null; quiet_mode?: string | null; toast_setting?: string | null; push_registered?: boolean | null;
  activation_ready?: boolean; queued_actions?: number; app_version?: string;
}
export interface Device {
  id: string; installation_id: string; platform: string; provider: string; name: string; enabled: boolean; last_seen_at: string; app_version: string;
  has_address?: boolean; socket_online?: boolean; diagnostics?: DeviceReport; diagnostics_at?: string | null;
  last_status?: string | null; last_error?: string | null; last_attempt_at?: string | null; last_channel?: string | null;
  last_ack_at?: string | null; last_ack_outcome?: string | null; pending?: number; failed_24h?: number;
}
export interface LoginSession { id: string; installation_id: string; client_name: string; created_at: string; last_used_at: string; current: boolean }
export interface DeliveryLog {
  id: string; status: string; attempts: number; error_code: string | null; created_at: string; platform: string; provider: string;
  device_name: string; operator_name: string; session_id: string;
  sent_at?: string | null; acknowledged_at?: string | null; ack_outcome?: string | null; channel?: string | null; last_attempt_at?: string | null;
}
export interface RoutingSettings { automatic: boolean; escalation_minutes: number; idle_minutes: number }
const defaults: DeliveryPreferences = { enabled: true, new_messages: true, escalation: true, show_preview: true, dnd_start: null, dnd_end: null, timezone: "Asia/Yekaterinburg" };
interface DeliveryState {
  preferences: DeliveryPreferences; devices: Device[]; sessions: LoginSession[]; log: DeliveryLog[]; routing: RoutingSettings;
  loading: boolean; error: string | null;
  loadPreferences: () => Promise<void>; savePreferences: (preferences: DeliveryPreferences) => Promise<void>;
  loadDevices: () => Promise<void>; revokeSession: (id: string) => Promise<void>; loadLog: () => Promise<void>;
  loadRouting: () => Promise<void>; saveRouting: (routing: RoutingSettings) => Promise<void>; quiet: () => boolean;
}
function syncLocal(preferences: DeliveryPreferences) {
  useNotificationStore.setState({ desktopEnabled: preferences.enabled, showMessagePreview: preferences.show_preview,
    dndScheduleEnabled: !!preferences.dnd_start, dndFrom: preferences.dnd_start || "22:00", dndTo: preferences.dnd_end || "09:00" });
}
export const useDeliveryStore = create<DeliveryState>((set, get) => ({
  preferences: defaults, devices: [], sessions: [], log: [], routing: { automatic: false, escalation_minutes: 3, idle_minutes: 5 }, loading: false, error: null,
  loadPreferences: async () => {
    try { const preferences = await api<DeliveryPreferences>("/api/chat-v8/notification-preferences"); set({ preferences, error: null }); syncLocal(preferences); }
    catch { set({ error: "Не удалось загрузить настройки уведомлений" }); }
  },
  savePreferences: async preferences => {
    const saved = await api<DeliveryPreferences>("/api/chat-v8/notification-preferences", { method: "PUT", body: JSON.stringify(preferences) });
    set({ preferences: saved, error: null }); syncLocal(saved);
  },
  loadDevices: async () => {
    set({ loading: true, error: null });
    try { const [devices, sessions] = await Promise.all([api<Device[]>("/api/chat-v8/devices"), api<LoginSession[]>("/api/chat-v8/auth/sessions")]); set({ devices, sessions }); }
    catch { set({ error: "Не удалось загрузить устройства" }); } finally { set({ loading: false }); }
  },
  revokeSession: async id => { await api(`/api/chat-v8/auth/sessions/${id}`, { method: "DELETE" }); await get().loadDevices(); },
  loadLog: async () => { set({ log: await api<DeliveryLog[]>("/api/chat-v8/delivery-log") }); },
  loadRouting: async () => { set({ routing: await api<RoutingSettings>("/api/chat-v8/routing") }); },
  saveRouting: async routing => { set({ routing: await api<RoutingSettings>("/api/chat-v8/routing", { method: "PUT", body: JSON.stringify(routing) }) }); },
  quiet: () => {
    const p = get().preferences;
    if (!p.enabled) return true;
    if (!p.dnd_start || !p.dnd_end) return false;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: p.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    return p.dnd_start < p.dnd_end ? parts >= p.dnd_start && parts < p.dnd_end : parts >= p.dnd_start || parts < p.dnd_end;
  },
}));
