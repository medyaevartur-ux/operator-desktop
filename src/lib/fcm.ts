import { api } from "./api";
import { getSession, clientName } from "./auth-session";
import { isAndroid, isNative } from "./api-config";
import { readDeviceDiagnostics } from "./tauri-bridge";

const HEARTBEAT_MS = 30_000;
const DIAGNOSTICS_EVERY = 10; // диагностика устройства — примерно раз в 5 минут и при возвращении в приложение

type NativeWindow = Window & { __FCM_TOKEN?: string };
let stop: (() => void) | null = null;
export function stopDeviceRegistration() { stop?.(); stop = null; }

/** Register one installation, retry transient failures, and replace rotated FCM tokens. */
export async function startDeviceRegistration(operatorId: string): Promise<void> {
  stopDeviceRegistration();
  let cancelled = false, busy = false, fingerprint = "", delay = 2000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retry = () => { clearTimeout(timer); timer = setTimeout(() => void register(), delay); delay = Math.min(60000, delay * 2); };
  const register = async () => {
    if (cancelled || busy || getSession()?.operator.id !== operatorId) return;
    if (!navigator.onLine) { retry(); return; }
    busy = true;
    const session = getSession()!;
    try {
      let subscription: PushSubscription | null = null;
      if (!isNative() && "serviceWorker" in navigator && "PushManager" in window) {
        const worker = await navigator.serviceWorker.getRegistration();
        subscription = await worker?.pushManager.getSubscription() ?? null;
      }
      const token = isAndroid() ? (window as NativeWindow).__FCM_TOKEN : undefined;
      const body = {
        installation_id: session.installation_id,
        platform: isAndroid() ? "android" : isNative() ? "windows" : "web",
        provider: token ? "fcm" : subscription ? "webpush" : "socket",
        token, subscription: subscription?.toJSON(), name: clientName(), app_version: __APP_VERSION__,
      };
      if (cancelled || getSession()?.operator.id !== operatorId) return;
      const next = JSON.stringify(body);
      if (next !== fingerprint) {
        await api("/api/chat-v8/devices/register", { method: "POST", body: next });
        if (cancelled) return;
        fingerprint = next;
        window.dispatchEvent(new Event("chat-device-ready"));
        void beat(true);
      }
      delay = 2000;
      // FCM may arrive after the WebView is ready.
      if (isAndroid() && !token) retry();
    } catch { if (!cancelled) retry(); }
    finally { busy = false; }
  };
  // Пульс сообщает серверу, что устройство живо, и раз в несколько минут — что видит сама ОС.
  // Если сервер отключил устройство (заменили токен, сбои доставки), регистрируемся заново.
  let beats = 0, lastRecovery = 0;
  async function beat(withDiagnostics: boolean) {
    if (cancelled || !fingerprint || !navigator.onLine) return;
    const diagnostics = withDiagnostics ? await readDeviceDiagnostics().catch(() => null) : null;
    const result = await api<{ registered?: boolean; enabled?: boolean }>("/api/chat-v8/devices/heartbeat", {
      method: "POST",
      body: JSON.stringify(diagnostics ? { diagnostics: { ...diagnostics, app_version: __APP_VERSION__ } } : {}),
    }).catch(() => null);
    // Не чаще раза за интервал и через обычный таймер с нарастающей паузой — без цикла, если сервер упорно отказывает.
    if (!cancelled && result && (result.registered === false || result.enabled === false) && Date.now() - lastRecovery > HEARTBEAT_MS) {
      lastRecovery = Date.now();
      fingerprint = "";
      retry();
    }
  }
  const onChange = () => { void register(); };
  const onVisible = () => { if (!document.hidden) { onChange(); void beat(true); } };
  const heartbeat = setInterval(() => { void beat(++beats % DIAGNOSTICS_EVERY === 0); }, HEARTBEAT_MS);
  window.addEventListener("fcm-token", onChange);
  window.addEventListener("push-subscription-changed", onChange);
  window.addEventListener("online", onChange);
  document.addEventListener("visibilitychange", onVisible);
  stop = () => {
    cancelled = true; clearTimeout(timer); clearInterval(heartbeat);
    window.removeEventListener("fcm-token", onChange);
    window.removeEventListener("push-subscription-changed", onChange);
    window.removeEventListener("online", onChange);
    document.removeEventListener("visibilitychange", onVisible);
  };
  await register();
}
