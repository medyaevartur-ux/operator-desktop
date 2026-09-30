import { api } from "./api";
import { isNative, isAndroid } from "./api-config";
import { authEpoch, getSession } from "./auth-session";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useNotificationStore } from "@/store/notification.store";
import { useDeliveryStore } from "@/store/delivery.store";
import { useNavigationStore } from "@/store/navigation.store";
import { offlineQueue } from "./offline-queue";
export interface Delivery { delivery_id: string; event_id: string; session_id: string; kind: string; title: string; body: string }
const pending = new Set<string>();
const uuid = /^[a-f0-9]{8}-[a-f0-9-]{27}$/i;
export async function acknowledgeDelivery(id: string, outcome: "displayed" | "read" | "opened" | "blocked" | "suppressed") {
  await api(`/api/chat-v8/notifications/${id}/ack`, { method: "POST", body: JSON.stringify({ outcome }) });
}
export async function showDeliveryNotification(delivery: Delivery): Promise<boolean> {
  if (isNative()) {
    return (await import("@tauri-apps/api/core")).invoke<boolean>("show_chat_notification", { deliveryId: delivery.delivery_id });
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const worker = await navigator.serviceWorker?.getRegistration();
  const data = { sessionId: delivery.session_id, deliveryId: delivery.delivery_id };
  if (worker) await worker.showNotification(delivery.title, { body: delivery.body, tag: `chat-${delivery.session_id}`, icon: "/book-mark.svg", data });
  else {
    const notice = new Notification(delivery.title, { body: delivery.body, tag: `chat-${delivery.session_id}`, icon: "/book-mark.svg" });
    notice.onclick = () => { window.focus(); window.dispatchEvent(new CustomEvent("open-chat", { detail: data })); notice.close(); };
  }
  return true;
}
export async function handleDelivery(id: string) {
  if (!uuid.test(id) || pending.has(id) || !getSession()) return;
  pending.add(id);
  const epoch = authEpoch(), owner = getSession()!.operator.id;
  const work = async () => {
    const key = `chat_v8_seen_${owner}`;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* Storage can be unavailable. */ }
    if (seen.includes(id)) { await acknowledgeDelivery(id, "displayed"); return; }
    const delivery = await api<Delivery>(`/api/chat-v8/notifications/${id}`);
    if (authEpoch() !== epoch) return;
    const preferences = useDeliveryStore.getState();
    if (preferences.quiet() || useAuthStore.getState().operator?.status === "dnd") { await acknowledgeDelivery(id, "suppressed"); return; }
    const navigation = useNavigationStore.getState();
    const viewing = navigation.screen === "inbox" && (window.innerWidth >= 768 || navigation.mobileView === "chat-conversation");
    let focused=document.hasFocus()&&!document.hidden;
    if(isNative()&&!isAndroid()) {
      const nativeWindow=(await import("@tauri-apps/api/webviewWindow")).getCurrentWebviewWindow();
      focused=await nativeWindow.isFocused() && await nativeWindow.isVisible();
    }
    const inbox = useInboxStore.getState();
    const viewingChat = viewing && focused && inbox.activeSession?.id === delivery.session_id;
    const active = viewingChat && inbox.readingLatest && !inbox.focusedMessageId;
    let outcome: "read" | "displayed" | "blocked" = "displayed";
    if (active) {
      await api(`/api/sessions/${delivery.session_id}/read`, { method: "PATCH" }); outcome = "read";
    } else if (viewingChat) {
      // Диалог открыт, оператор лишь пролистал выше: новое видно по кнопке «вниз», строка «Открыть» не нужна.
      useNotificationStore.getState().playSound(/escalation|operator.request/.test(delivery.kind) ? "operator_request" : "new_message");
    } else {
      useNotificationStore.getState().addNotification(delivery.session_id, delivery.title, delivery.body, /escalation|operator.request/.test(delivery.kind) ? "operator_request" : "new_message", !focused);
      if (!focused) outcome = await showDeliveryNotification(delivery) ? "displayed" : "blocked";
    }
    try { if(outcome!=="blocked")localStorage.setItem(key, JSON.stringify([...seen, id].slice(-500))); } catch { /* A lost ack remains safe to retry. */ }
    await acknowledgeDelivery(id, outcome);
  };
  try {
    if (navigator.locks && !isNative()) await navigator.locks.request(`chat-delivery-${id}`, work);
    else await work();
  } catch { /* Durable server retry/catch-up handles a sleeping or offline client. */ }
  finally { pending.delete(id); }
}
export async function catchUpDeliveries() {
  try { for (const item of await api<Delivery[]>("/api/chat-v8/notifications")) await handleDelivery(item.delivery_id); } catch { /* Wait for reconnect. */ }
}
export async function recoverNativeReplies() {
  if (!isNative() || !getSession()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const owner = getSession()!.operator.id;
    const replies = await invoke<Array<{ client_id: string; session_id: string; operator_id: string; message: string; created_at: string }>>("read_native_replies");
    for (const reply of replies) {
      if (reply.operator_id !== owner || getSession()?.operator.id !== owner || !uuid.test(reply.client_id) || !uuid.test(reply.session_id)) continue;
      await offlineQueue.enqueue({ tempId: reply.client_id, clientId: reply.client_id, sessionId: reply.session_id, operatorId: owner, message: reply.message, created_at: /^\d+$/.test(reply.created_at) ? new Date(Number(reply.created_at)).toISOString() : reply.created_at, error: "Ответ из уведомления не отправлен. Проверьте и повторите." });
      await invoke("ack_native_reply", { clientId: reply.client_id });
    }
  } catch { /* Leave encrypted native replies intact until the next resume. */ }
}
