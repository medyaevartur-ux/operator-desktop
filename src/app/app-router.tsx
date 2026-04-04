import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { LoginScreen } from "@/features/auth/login-screen";
import { bootstrapAuth, bindAuthListener } from "@/features/auth/auth.bootstrap";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import { AppUpdater } from "@/components/updater";
import { ToastContainer, TooltipProvider, ConfirmDialog } from "@/components/ui";
import { isMobile } from "@/lib/platform";
import s from "./AppRouter.module.css";

function openSessionById(sessionId: string) {
  const { sessions, setActiveSession, loadMessages } = useInboxStore.getState();
  const { setMobileView, setScreen } = useNavigationStore.getState();

  const target = sessions.find((s) => s.id === sessionId);
  if (target) {
    setActiveSession(target);
    void loadMessages(sessionId);
    setScreen("inbox");
    if (isMobile()) {
      setMobileView("chat-conversation");
    }
  } else {
    // Сессии ещё не загружены — сохраняем pending
    useNavigationStore.getState().setPendingSessionId(sessionId);
  }
}

export function AppRouter() {
  const { token, isLoading } = useAuthStore();
  const mobile = isMobile();
  const pendingSessionId = useNavigationStore((s) => s.pendingSessionId);
  const sessions = useInboxStore((s) => s.sessions);

  useEffect(() => {
    const unbind = bindAuthListener();
    void bootstrapAuth();
    import("@/lib/notifications").then(({ requestNotificationPermission }) => {
      requestNotificationPermission();
    });

    const unlock = () => {
      import("@/lib/notifications").then(({ unlockAudio }) => unlockAudio());
      document.removeEventListener("click", unlock);
    };
    document.addEventListener("click", unlock);

    // Регистрируем глобальную функцию для вызова из Kotlin
    (window as any).__openSessionFromPush = (sessionId: string) => {
      console.log("[push] Opening session:", sessionId);
      openSessionById(sessionId);
    };

    // Проверяем если session_id был передан до загрузки JS
    const pendingFromNative = (window as any).__PUSH_SESSION_ID;
    if (pendingFromNative) {
      (window as any).__PUSH_SESSION_ID = null;
      setTimeout(() => openSessionById(pendingFromNative), 1500);
    }

    return () => {
      unbind();
    };
  }, []);

  // Обрабатываем pending session когда сессии загрузились
  useEffect(() => {
    if (pendingSessionId && sessions.length > 0) {
      const target = sessions.find((s) => s.id === pendingSessionId);
      if (target) {
        const { setActiveSession, loadMessages } = useInboxStore.getState();
        const { setMobileView, setScreen, setPendingSessionId } = useNavigationStore.getState();

        setActiveSession(target);
        void loadMessages(pendingSessionId);
        setScreen("inbox");
        if (isMobile()) {
          setMobileView("chat-conversation");
        }
        setPendingSessionId(null);
      }
    }
  }, [pendingSessionId, sessions]);

  if (isLoading) {
    return (
      <div className={s.loadingScreen}>
        <div className={s.loadingCard}>Загрузка приложения...</div>
      </div>
    );
  }

  if (!token) {
    return (
      <TooltipProvider>
        <LoginScreen />
        <ToastContainer />
        <ConfirmDialog />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <AppShell />
      {!mobile && <AppUpdater />}
      <ToastContainer />
      <ConfirmDialog />
    </TooltipProvider>
  );
}