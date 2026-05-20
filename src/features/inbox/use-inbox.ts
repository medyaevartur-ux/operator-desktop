import { useEffect } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useInboxHotkeys } from "@/features/inbox/use-hotkeys";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import { useNotificationStore } from "@/store/notification.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { getVisitors } from "@/features/visitors/visitors.api";

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
    // Загружаем visitors раз в минуту чтобы знать кто онлайн на сайте
    const loadVisitors = async () => {
      try {
        const v = await getVisitors({});
        if (Array.isArray(v)) useVisitorsStore.getState().setVisitors(v);
      } catch { /* ignore */ }
    };
    void loadVisitors();
    const t = setInterval(loadVisitors, 60000);
    return () => clearInterval(t);
  }, [loadSessions, loadOperators, loadTags]);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadMessages(activeSessionId);
    void loadNotes(activeSessionId);
    void loadTags(activeSessionId);
  }, [activeSessionId, loadMessages, loadNotes, loadTags]);

  useInboxHotkeys();

  // ═══ Online/Offline status + Heartbeat + Tauri close ═══
  // Подписываемся на operator.id — при смене юзера всё переподнимается.
  const operatorId = useAuthStore((s) => s.operator?.id);

  useEffect(() => {
    if (!operatorId) return;

    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3010";

    void api(`/api/operators/${operatorId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "online" }),
    });

    import("@/lib/tauri-bridge").then(({ setCloseToTray }) => {
      const closeToTray = useNotificationStore.getState().closeToTray;
      setCloseToTray(closeToTray);
    }).catch(() => {});

    useNotificationStore.getState().syncBadge();

    const handleBeforeUnload = () => {
      navigator.sendBeacon?.(
        `${API_URL}/api/operators/${operatorId}/online`,
        JSON.stringify({ is_online: false }),
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    let unlistenClose: (() => void) | null = null;
    import("@/lib/tauri-bridge").then(({ onAppClosing, notifyOfflineNative }) => {
      onAppClosing(() => {
        notifyOfflineNative(API_URL, operatorId);
      }).then((unlisten) => {
        unlistenClose = unlisten;
      });
    }).catch(() => {});

    const heartbeat = setInterval(() => {
      void api(`/api/operators/${operatorId}/heartbeat`, { method: "PATCH" });
    }, 30000);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearInterval(heartbeat);
      if (unlistenClose) unlistenClose();
    };
  }, [operatorId]);
}