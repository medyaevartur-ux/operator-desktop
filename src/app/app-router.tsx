import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { LoginScreen } from "@/features/auth/login-screen";
import { bootstrapAuth, bindAuthListener } from "@/features/auth/auth.bootstrap";
import { useAuthStore } from "@/store/auth.store";
import { openConversationFromNotification } from "@/lib/open-conversation";
import { AppUpdater } from "@/components/updater";
import { ToastContainer, TooltipProvider, ConfirmDialog } from "@/components/ui";
import { useIsMobile } from "@/lib/platform";
import s from "./AppRouter.module.css";

let queuedNotificationSession: string | null = null;
function queueNotificationSession(id: string) {
  if(!/^[a-f0-9-]{36}$/i.test(id)) return;
  if(useAuthStore.getState().token) openSessionById(id);
  else queuedNotificationSession = id;
}
function openSessionById(sessionId: string) { void openConversationFromNotification(sessionId); }

export function AppRouter() {
  const { token, isLoading } = useAuthStore();
  const mobile = useIsMobile();

  useEffect(() => {
    const unbind = bindAuthListener();
    void bootstrapAuth();
    const unlock = () => {
      import("@/lib/notifications").then(({ unlockAudio }) => unlockAudio());
      document.removeEventListener("click", unlock);
    };
    document.addEventListener("click", unlock);

    // Регистрируем глобальную функцию для вызова из Kotlin
    (window as any).__openSessionFromPush = (sessionId: string) => {
      console.log("[push] Opening session:", sessionId);
      queueNotificationSession(sessionId);
    };

    const url = new URL(window.location.href);
    const linkedSession = url.searchParams.get("session_id");
    if(linkedSession && /^[a-f0-9-]{36}$/i.test(linkedSession)) {
      queueNotificationSession(linkedSession);
      history.replaceState({},"",url.pathname);
    }
    // Проверяем если session_id был передан до загрузки JS
    const pendingFromNative = (window as any).__PUSH_SESSION_ID;
    if (pendingFromNative) {
      (window as any).__PUSH_SESSION_ID = null;
      queueNotificationSession(pendingFromNative);
    }

    return () => {
      unbind();
    };
  }, []);

  useEffect(() => {
    if(token && queuedNotificationSession) { const id=queuedNotificationSession;queuedNotificationSession=null;openSessionById(id); }
  },[token]);
  useEffect(() => {
    if(!("__TAURI_INTERNALS__" in window)) return;
    let disposed=false;const stops:Array<()=>void>=[];
    void Promise.all([import("@tauri-apps/api/event"),import("@tauri-apps/api/core")]).then(async ([events,core])=>{
      const open=await events.listen<{sessionId:string}>("open-chat",event=>queueNotificationSession(event.payload.sessionId));
      const replies=await events.listen("native-replies-ready",()=>{void import("@/lib/delivery").then(module=>module.recoverNativeReplies())});
      if(disposed){open();replies();return;}stops.push(open,replies);
      const pending=await core.invoke<string|null>("take_native_notification");if(pending)queueNotificationSession(pending);
    }).catch(()=>undefined);
    return()=>{disposed=true;stops.forEach(stop=>stop())};
  },[]);

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
      {!mobile && "__TAURI_INTERNALS__" in window && <AppUpdater />}
      <ToastContainer />
      <ConfirmDialog />
    </TooltipProvider>
  );
}
