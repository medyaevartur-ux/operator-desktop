import { useEffect } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useInboxHotkeys } from "@/features/inbox/use-hotkeys";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import { useNotificationStore } from "@/store/notification.store";

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
    if (!activeSessionId) return;
    void loadMessages(activeSessionId);
    void loadNotes(activeSessionId);
    void loadTags(activeSessionId);
  }, [activeSessionId, loadMessages, loadNotes, loadTags]);

  useInboxHotkeys();

  // ═══ Online/Offline status + Heartbeat + Tauri close ═══
  useEffect(() => {
    const operator = useAuthStore.getState().operator;
    if (!operator?.id) return;

    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3010";

    // Set online
    void api(`/api/operators/${operator.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "online" }),
    });

    // Sync close-to-tray setting on mount
    import("@/lib/tauri-bridge").then(({ setCloseToTray }) => {
      const closeToTray = useNotificationStore.getState().closeToTray;
      setCloseToTray(closeToTray);
    }).catch(() => {});

    // Sync badge on mount
    useNotificationStore.getState().syncBadge();

    // Browser: beforeunload → offline
    const handleBeforeUnload = () => {
      navigator.sendBeacon?.(
        `${API_URL}/api/operators/${operator.id}/online`,
        JSON.stringify({ is_online: false }),
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Tauri: app-closing event → offline via Rust (more reliable)
    let unlistenClose: (() => void) | null = null;
    import("@/lib/tauri-bridge").then(({ onAppClosing, notifyOfflineNative }) => {
      onAppClosing(() => {
        notifyOfflineNative(API_URL, operator.id);
      }).then((unlisten) => {
        unlistenClose = unlisten;
      });
    }).catch(() => {});

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      void api(`/api/operators/${operator.id}/heartbeat`, { method: "PATCH" });
    }, 30000);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearInterval(heartbeat);
      if (unlistenClose) unlistenClose();
    };
  }, []);
}