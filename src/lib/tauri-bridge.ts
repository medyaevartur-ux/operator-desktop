/**
 * Bridge between frontend and Tauri native APIs
 * Gracefully degrades to no-op when not in Tauri environment
 */

function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let listen: ((event: string, handler: (event: any) => void) => Promise<() => void>) | null = null;

async function getInvoke() {
  if (invoke) return invoke;
  if (!isTauri()) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke;
    return invoke;
  } catch {
    return null;
  }
}

async function getListen() {
  if (listen) return listen;
  if (!isTauri()) return null;
  try {
    const mod = await import("@tauri-apps/api/event");
    listen = mod.listen;
    return listen;
  } catch {
    return null;
  }
}

// ═══ Badge ═══

/** Счётчик на иконке приложения; заголовок окна ставит AppShell. */
export async function setBadgeCount(count: number): Promise<void> {
  const inv = await getInvoke();
  if (inv) await inv("set_badge_count", { count });
}

// ═══ Close to Tray ═══

export async function getCloseToTray(): Promise<boolean> {
  const inv = await getInvoke();
  if (inv) {
    return (await inv("get_close_to_tray")) as boolean;
  }
  return false;
}

export async function setCloseToTray(value: boolean): Promise<void> {
  const inv = await getInvoke();
  if (inv) {
    await inv("set_close_to_tray", { value });
  }
}

// ═══ Listen to app-closing event ═══

export async function onAppClosing(handler: () => void): Promise<() => void> {
  const lis = await getListen();
  if (lis) {
    return await lis("app-closing", () => handler());
  }
  return () => {};
}

// ═══ Notification diagnostics ═══
// Сами уведомления показывает lib/delivery.ts (show_chat_notification / Service Worker).

export interface DeviceDiagnostics {
  permission?: "granted" | "denied" | "default" | "unknown";
  channel_enabled?: boolean | null;
  battery_optimized?: boolean | null;
  background_restricted?: boolean | null;
  quiet_mode?: string | null;
  toast_setting?: string | null;
  push_registered?: boolean | null;
  activation_ready?: boolean;
  queued_actions?: number;
}

/** Что знает само устройство: разрешение ОС, канал, экономия батареи (Windows/Android — нативно, браузер — Notification API). */
export async function readDeviceDiagnostics(): Promise<DeviceDiagnostics> {
  const inv = await getInvoke();
  if (inv) {
    try { return ((await inv("notification_diagnostics")) as DeviceDiagnostics | null) ?? { permission: "unknown" }; }
    catch { return { permission: "unknown" }; }
  }
  const permission = "Notification" in window ? (Notification.permission as DeviceDiagnostics["permission"]) : "unknown";
  let push_registered: boolean | null = null;
  try {
    const worker = await navigator.serviceWorker?.getRegistration();
    push_registered = worker?.pushManager ? !!(await worker.pushManager.getSubscription()) : null;
  } catch { push_registered = null; }
  return { permission, push_registered };
}

/** Открыть системные настройки уведомлений или экономии батареи. false — на этой платформе нельзя. */
export async function openSystemSettings(kind: "notifications" | "battery"): Promise<boolean> {
  const inv = await getInvoke();
  if (!inv) return false;
  try { await inv("open_system_settings", { kind }); return true; } catch { return false; }
}

// ═══ Focus window ═══

export async function focusMainWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = getCurrentWebviewWindow();
    await win.show();
    await win.unminimize();
    await win.setFocus();
  } catch {}
}