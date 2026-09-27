import { API_BASE, fetchWithDeadline, isNative } from "./api-config";
import { getSession, onSessionChange } from "./auth-session";
let registration: ServiceWorkerRegistration | undefined;
export async function registerOperatorWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (isNative() || !import.meta.env.PROD) {
    for (const worker of await navigator.serviceWorker.getRegistrations()) {
      const script = worker.active?.scriptURL || worker.waiting?.scriptURL;
      if (script && new URL(script).origin === location.origin && new URL(script).pathname === "/sw.js") await worker.unregister();
    }
    return;
  }
  registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  const sync = () => {
    const session = getSession(), target = registration?.active;
    target?.postMessage(session ? { type: "AUTH_CONTEXT", apiBase: API_BASE, installationId: session.installation_id, operatorId: session.operator.id } : { type: "AUTH_CLEAR" });
  };
  onSessionChange(sync);
  navigator.serviceWorker.addEventListener("controllerchange", sync);
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.type === "OPEN_CHAT") window.dispatchEvent(new CustomEvent("open-chat", { detail: { sessionId: event.data.sessionId, deliveryId: event.data.deliveryId } }));
  });
  if (getSession()) sync();
  const announce = () => { if (registration?.waiting) window.dispatchEvent(new Event("app-update-ready")); };
  registration.addEventListener("updatefound", () => registration?.installing?.addEventListener("statechange", announce));
  announce();
}
export async function requestPushPermission() {
  if (isNative()) {
    const { readDeviceDiagnostics } = await import("./tauri-bridge");
    if ((await readDeviceDiagnostics()).permission !== "granted") {
      // Плагин на Android 13+ может не ответить, если разрешение уже выдано, — не ждём дольше 10 секунд
      // и перепроверяем по самому устройству, а не по кэшу плагина.
      const permissions = await import("@tauri-apps/plugin-notification");
      await Promise.race([permissions.requestPermission().catch(() => "denied"), new Promise(resolve => setTimeout(resolve, 10_000))]);
      if ((await readDeviceDiagnostics()).permission !== "granted") throw new Error("Уведомления выключены в настройках устройства. Откройте настройки и разрешите их для «Живой Сказки».");
    }
  } else {
    if (!("Notification" in window) || !("PushManager" in window)) throw new Error("Этот браузер не поддерживает push-уведомления");
    if (await Notification.requestPermission() !== "granted") throw new Error("Разрешите уведомления для приложения в настройках браузера");
    const worker = registration || await navigator.serviceWorker.getRegistration();
    if (!worker) throw new Error("Push доступны в опубликованной HTTPS-версии приложения");
    const response = await fetchWithDeadline("/api/chat-v8/meta", { credentials: "omit" });
    const meta = await response.json();
    if (!meta.vapid_public_key) throw new Error("На сервере ещё не настроен Web Push");
    const key = meta.vapid_public_key.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(key + "=".repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0));
    if (!await worker.pushManager.getSubscription()) await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  }
  window.dispatchEvent(new Event("push-subscription-changed"));
}
export async function applyWebUpdate() {
  const worker = registration || await navigator.serviceWorker?.getRegistration();
  if (worker?.waiting) {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    worker.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  } else { await worker?.update(); if (worker?.waiting) await applyWebUpdate(); }
}
