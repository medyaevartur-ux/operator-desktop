import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useNotificationStore } from "@/store/notification.store";
import type { ChatMessage } from "@/types/chat";

interface MessageStatusPayload {
  session_id: string;
  messages: Array<{
    id: string;
    status: "delivered" | "read";
    delivered_at?: string;
    read_at?: string;
  }>;
}

export function useInboxRealtime() {
  const appendMessage = useInboxStore((s) => s.appendMessage);
  const loadSessions = useInboxStore((s) => s.loadSessions);
  const loadMessages = useInboxStore((s) => s.loadMessages);
  const updateMessageStatuses = useInboxStore((s) => s.updateMessageStatuses);
  const activeSessionRef = useRef<string | null>(null);

  useEffect(() => {
    return useInboxStore.subscribe((state) => {
      activeSessionRef.current = state.activeSession?.id ?? null;
    });
  }, []);

  // Listen for notification clicks
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId) {
        const sessions = useInboxStore.getState().sessions;
        const target = sessions.find((s) => s.id === detail.sessionId);
        if (target) {
          useInboxStore.getState().setActiveSession(target);
        }
        useNotificationStore.getState().clearNotifications(detail.sessionId);
      }
    };
    window.addEventListener("open-chat", handler);
    return () => window.removeEventListener("open-chat", handler);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleNewMessage = (message: ChatMessage) => {
      if (message.session_id === activeSessionRef.current) {
        appendMessage(message);
      }

      if (message.sender !== "operator" && message.sender !== "system") {
        const operator = useAuthStore.getState().operator;
        if (operator?.status === "dnd") return;

        const sessions = useInboxStore.getState().sessions;
        const session = sessions.find((s) => s.id === message.session_id);
        const visitorName = session?.visitor_name?.trim() || `Гость ${message.session_id.slice(-6)}`;

        const isActiveAndFocused = message.session_id === activeSessionRef.current && document.hasFocus();

        if (!isActiveAndFocused) {
          const isMention = message.message.includes(`@${operator?.name}`);
          if (isMention) {
            useNotificationStore.getState().playSound("mention");
            return; // mention sound takes priority
          }

          useNotificationStore.getState().addNotification(
            message.session_id,
            visitorName,
            message.message
          );
        }
      }
    };

    const handleSessionUpdated = (data?: { session_id?: string; is_new?: boolean; visitor_name?: string }) => {
      void loadSessions();

      if (data?.is_new) {
        const operator = useAuthStore.getState().operator;
        if (operator?.status !== "dnd") {
          useNotificationStore.getState().playSound("new_chat");
          useNotificationStore.getState().addNotification(
            data.session_id || "new",
            data.visitor_name || "Новый клиент",
            "Начал диалог"
          );
        }
      }
    };

    // ═══ НОВОЕ: обработка message_status_changed ═══
    const handleMessageStatusChanged = (data: MessageStatusPayload) => {
      if (data.session_id === activeSessionRef.current) {
        updateMessageStatuses(data.messages);
      }
    };

    const handleMessageUpdated = () => {
      void loadMessages();
    };

    const handleMessageDeleted = () => {
      void loadMessages();
    };

    const handleReactionUpdated = () => {
      void loadMessages();
    };

    // Live typing preview
    const handleTypingContent = (data: { sessionId: string; text: string; isTyping: boolean }) => {
      useInboxStore.getState().setTypingPreview(data.sessionId, data.text, data.isTyping);
    };

    const handleOperatorStatus = (data: { operator_id: string; status: string; is_online: boolean }) => {
      const currentOperator = useAuthStore.getState().operator;
      if (currentOperator && data.operator_id === currentOperator.id) {
        useAuthStore.getState().setOperator({
          ...currentOperator,
          status: data.status,
          is_online: data.is_online,
        });
      }
      void loadSessions();
    };

    socket.on("new_message", handleNewMessage);
    socket.on("session_updated", handleSessionUpdated);
    const handlePageChanged = (data: { sessionId: string; url: string; title: string }) => {
      const state = useInboxStore.getState();
      if (state.activeSession?.id === data.sessionId) {
        useInboxStore.getState().upsertSession({
          ...state.activeSession,
          current_page: data.url,
          current_page_title: data.title,
        });
      }
    };

    socket.on("session_page_changed", handlePageChanged);    
    socket.on("message_status_changed", handleMessageStatusChanged);
    socket.on("message_updated", handleMessageUpdated);
    socket.on("message_deleted", handleMessageDeleted);
    socket.on("reaction_updated", handleReactionUpdated);
    socket.on("operator_status_changed", handleOperatorStatus);
    socket.on("typing_content", handleTypingContent);
    socket.on("operator_requested", (data: { session_id: string; visitor_name: string; message: string }) => {
      const operator = useAuthStore.getState().operator;
      if (operator?.status === "dnd") return;

      void loadSessions();

      useNotificationStore.getState().playSound("operator_request");
      useNotificationStore.getState().addNotification(
        data.session_id,
        data.visitor_name || "Посетитель",
        data.message || "Запросил оператора"
      );
    });    

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("session_updated", handleSessionUpdated);
      socket.off("message_status_changed", handleMessageStatusChanged);
      socket.off("session_page_changed", handlePageChanged);      
      socket.off("message_updated", handleMessageUpdated);
      socket.off("message_deleted", handleMessageDeleted);
      socket.off("reaction_updated", handleReactionUpdated);
      socket.off("operator_status_changed", handleOperatorStatus);
      socket.off("typing_content", handleTypingContent);     
      socket.off("operator_requested");       
    };
  }, [appendMessage, loadSessions, loadMessages, updateMessageStatuses]);

  // Subscribe to active session room
  useEffect(() => {
    const socket = getSocket();

    const unsub = useInboxStore.subscribe((state, prev) => {
      if (prev.activeSession?.id && prev.activeSession.id !== state.activeSession?.id) {
        socket.emit("leave_session", prev.activeSession.id);
      }

      if (state.activeSession?.id && state.activeSession.id !== prev.activeSession?.id) {
        socket.emit("join_session", state.activeSession.id);
        useNotificationStore.getState().clearNotifications(state.activeSession.id);
      }
    });

    const currentId = useInboxStore.getState().activeSession?.id;
    if (currentId) {
      socket.emit("join_session", currentId);
    }

    return () => {
      unsub();
      const id = useInboxStore.getState().activeSession?.id;
      if (id) socket.emit("leave_session", id);
    };
  }, []);
}