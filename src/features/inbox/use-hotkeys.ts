import { useEffect } from "react";
import { useInboxStore } from "@/store/inbox.store";

export function useInboxHotkeys() {
  const sessions = useInboxStore((state) => state.sessions);
  const activeSession = useInboxStore((state) => state.activeSession);
  const setActiveSession = useInboxStore((state) => state.setActiveSession);
  const closeActiveSession = useInboxStore((state) => state.closeActiveSession);
  const assignActiveSession = useInboxStore((state) => state.assignActiveSession);
  const markActiveSessionRead = useInboxStore((state) => state.markActiveSessionRead);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      // Alt+W — закрыть диалог
      if (event.altKey && event.key === "w") {
        event.preventDefault();
        void closeActiveSession();
        return;
      }

      // Alt+A — забрать чат
      if (event.altKey && event.key === "a") {
        event.preventDefault();
        void assignActiveSession();
        return;
      }

      // Alt+R — пометить прочитанным
      if (event.altKey && event.key === "r") {
        event.preventDefault();
        void markActiveSessionRead();
        return;
      }

      // Не обрабатываем навигацию, если фокус в инпуте
      if (isInput) {
        return;
      }

      // Alt+ArrowDown — следующий чат
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        navigateSession(1);
        return;
      }

      // Alt+ArrowUp — предыдущий чат
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        navigateSession(-1);
        return;
      }

      // Escape — сбросить поиск по сообщениям
      if (event.key === "Escape") {
        useInboxStore.getState().clearMessageSearch();
        return;
      }
    }

    function navigateSession(direction: 1 | -1) {
      if (sessions.length === 0) {
        return;
      }

      const currentIndex = sessions.findIndex(
        (s) => s.id === activeSession?.id
      );

      let nextIndex = currentIndex + direction;

      if (nextIndex < 0) {
        nextIndex = sessions.length - 1;
      }

      if (nextIndex >= sessions.length) {
        nextIndex = 0;
      }

      setActiveSession(sessions[nextIndex]);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    sessions,
    activeSession,
    setActiveSession,
    closeActiveSession,
    assignActiveSession,
    markActiveSessionRead,
  ]);
}