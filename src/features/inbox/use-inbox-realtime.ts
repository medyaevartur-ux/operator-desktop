import { openConversationFromNotification } from "@/lib/open-conversation";
import { useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useTemplatesStore } from "@/store/templates.store";
import { useDeliveryStore } from "@/store/delivery.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useNotificationStore } from "@/store/notification.store";
import { catchUpDeliveries, handleDelivery, acknowledgeDelivery, recoverNativeReplies } from "@/lib/delivery";
import { isNative } from "@/lib/api-config";
import type { ChatMessage } from "@/types/chat";

export function useInboxRealtime() {
  useEffect(() => {
    const socket = getSocket();
    let disposed = false, reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshSessions = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { if (!disposed) void useInboxStore.getState().loadSessions(); }, 150); };
    const activeId = () => useInboxStore.getState().activeSession?.id;
    const setContext = () => {
      if (!isNative()) return;
      const nav = useNavigationStore.getState();
      const visible = !document.hidden && document.hasFocus() && nav.screen === "inbox" && (window.innerWidth >= 768 || nav.mobileView === "chat-conversation");
      void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_native_chat_context", { sessionId: visible ? activeId() || null : null })).catch(() => undefined);
    };
    const reconcile = () => {
      void useInboxStore.getState().loadSessions();
      if (activeId()) { socket.emit("join_session", activeId()); void useInboxStore.getState().loadMessages(); }
      void useDeliveryStore.getState().loadPreferences().then(() => catchUpDeliveries());
      void useTemplatesStore.getState().load();
      void recoverNativeReplies();
      void useDeliveryStore.getState().loadRouting().catch(()=>undefined); setContext();
    };
    const newMessage = (message: ChatMessage) => {
      const state = useInboxStore.getState();
      if (message.session_id === activeId() && !state.focusedMessageId) state.appendMessage(message);
      refreshSessions();
    };
    const messageUpdated = (message: ChatMessage) => {
      if (message?.session_id === activeId() && message.id && typeof message.message === "string") useInboxStore.getState().appendMessage(message);
      else if (!message?.session_id || message.session_id === activeId()) void useInboxStore.getState().loadMessages();
    };
    const statuses = (data: { session_id: string; messages: Array<{ id: string; status: "delivered" | "read"; delivered_at?: string; read_at?: string }> }) => {
      if (data.session_id === activeId()) useInboxStore.getState().updateMessageStatuses(data.messages);
      refreshSessions();
    };
    const typing = (data: { sessionId: string; text: string; isTyping: boolean }) => useInboxStore.getState().setTypingPreview(data.sessionId, data.text, data.isTyping);
    const status = (data: { operator_id: string; status: string; is_online: boolean }) => {
      const own = useAuthStore.getState().operator;
      useInboxStore.setState(state=>({operators:state.operators.map(item=>item.id===data.operator_id?{...item,status:data.status,is_online:data.is_online}:item)}));
      if (own?.id === data.operator_id) useAuthStore.getState().setOperator({ ...own, status: data.status, is_online: data.is_online });
      refreshSessions();
    };
    const page = (data: { sessionId: string; url: string; title: string }) => {
      const active = useInboxStore.getState().activeSession;
      if (active?.id === data.sessionId) useInboxStore.getState().upsertSession({ ...active, current_page: data.url, current_page_title: data.title });
    };
    const templates = () => void useTemplatesStore.getState().load();
    const delivery = (data: { delivery_id: string }) => { if (data?.delivery_id) void handleDelivery(data.delivery_id); };
    const deviceReady = () => void catchUpDeliveries();
    const routing = () => void useDeliveryStore.getState().loadRouting().catch(() => undefined);
    const open = async (event: Event) => {
      const data = (event as CustomEvent<{ sessionId?: string; deliveryId?: string }>).detail;
      if (!data?.sessionId || !/^[a-f0-9-]{36}$/i.test(data.sessionId)) return;
      if (!(await openConversationFromNotification(data.sessionId, () => !disposed))) return;
      useNotificationStore.getState().clearNotifications(data.sessionId);
      if (data.deliveryId) void acknowledgeDelivery(data.deliveryId, "opened").catch(() => undefined);
    };
    const onVisible = () => { setContext(); if (!document.hidden) reconcile(); };
    const onFocus = () => { setContext(); if (socket.connected) void catchUpDeliveries(); };
    const unsubInbox = useInboxStore.subscribe((state, previous) => {
      if (state.activeSession?.id !== previous.activeSession?.id) {
        if (previous.activeSession) socket.emit("leave_session", previous.activeSession.id);
        if (state.activeSession) { socket.emit("join_session", state.activeSession.id); useNotificationStore.getState().clearNotifications(state.activeSession.id); }
        setContext();
      }
    });
    const unsubNav = useNavigationStore.subscribe(setContext);
    const events: Array<[string, (...args: any[]) => void]> = [
      ["connect", reconcile], ["new_message", newMessage], ["message_updated", messageUpdated], ["message_deleted", messageUpdated],
      ["message_status_changed", statuses], ["reaction_updated", messageUpdated], ["session_updated", refreshSessions], ["new_session", refreshSessions],
      ["operator_requested", refreshSessions], ["operator_status_changed", status], ["session_page_changed", page], ["typing_content", typing],
      ["operator_updated",()=>void useInboxStore.getState().loadOperators()],["templates_updated", templates], ["notification_event", delivery], ["routing_updated", routing],
    ];
    events.forEach(([name, handler]) => socket.on(name, handler));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus); window.addEventListener("blur", setContext);
    window.addEventListener("online", reconcile); window.addEventListener("open-chat", open); window.addEventListener("chat-device-ready", deviceReady);
    if (socket.connected) reconcile();
    return () => {
      disposed = true; clearTimeout(reloadTimer); unsubInbox(); unsubNav();
      events.forEach(([name, handler]) => socket.off(name, handler));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus); window.removeEventListener("blur", setContext);
      window.removeEventListener("online", reconcile); window.removeEventListener("open-chat", open); window.removeEventListener("chat-device-ready", deviceReady);
      if (activeId()) socket.emit("leave_session", activeId());
    };
  }, []);
}
