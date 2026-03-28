import { useEffect } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useInboxHotkeys } from "@/features/inbox/use-hotkeys";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";

export function useInbox() {
  const activeSessionId = useInboxStore((state) => state.activeSession?.id);
  const loadSessions = useInboxStore((state) => state.loadSessions);
  const loadMessages = useInboxStore((state) => state.loadMessages);
  const loadNotes = useInboxStore((state) => state.loadNotes);
  const loadTags = useInboxStore((state) => state.loadTags);
  const loadOperators = useInboxStore((state) => state.loadOperators);

  useEffect(() => {
    void loadSessions();
    void loadOperators();
    void loadTags(null);
  }, [loadSessions, loadOperators, loadTags]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    void loadMessages(activeSessionId);
    void loadNotes(activeSessionId);
    void loadTags(activeSessionId);
  }, [activeSessionId, loadMessages, loadNotes, loadTags]);

  useInboxHotkeys();

  // Online/offline status + heartbeat
  useEffect(() => {
    const operator = useAuthStore.getState().operator;

    if (!operator?.id) {
      return;
    }

    // Устанавливаем статус online
    void api(`/api/operators/${operator.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "online" }),
    });

    // При закрытии вкладки — offline
    const handleBeforeUnload = () => {
      navigator.sendBeacon?.(
        `${import.meta.env.VITE_API_URL || "http://localhost:3010"}/api/operators/${operator.id}/online`,
        JSON.stringify({ is_online: false })
      );
    };

    // Heartbeat каждые 30 секунд
    const heartbeat = setInterval(() => {
      void api(`/api/operators/${operator.id}/heartbeat`, {
        method: "PATCH",
      });
    }, 30000);

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearInterval(heartbeat);
    };
  }, []);
}