import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { LoginScreen } from "@/features/auth/login-screen";
import { bootstrapAuth, bindAuthListener } from "@/features/auth/auth.bootstrap";
import { useAuthStore } from "@/store/auth.store";
import { AppUpdater } from "@/components/updater";
import { ToastContainer, TooltipProvider, ConfirmDialog } from "@/components/ui";
import s from "./AppRouter.module.css";

export function AppRouter() {
  const { token, isLoading } = useAuthStore();

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

    return () => {
      unbind();
    };
  }, []);

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
      <AppUpdater />
      <ToastContainer />
      <ConfirmDialog />
    </TooltipProvider>
  );
}