import { useEffect, useState } from "react";
import { BellRing, Share, X } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { isNative } from "@/lib/api-config";
import { isIos, isStandalone } from "@/lib/ios-web";
import { IOS_INSTALL_HINT, requestPushPermission } from "@/lib/pwa";
import s from "./NotificationBanner.module.css";

type Need = "install" | "allow" | "denied" | null;
const DISMISSED = "zs_push_prompt_dismissed";

function need(): Need {
  if (isNative()) return null;
  if (isIos() && !isStandalone()) return "install";
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) return null;
  return Notification.permission === "default" ? "allow" : Notification.permission === "denied" ? "denied" : null;
}
const dismissed = () => { try { return !!sessionStorage.getItem(DISMISSED); } catch { return false; } };

/**
 * Веб-версия: без экрана «Домой» (iPhone) или без разрешения уведомлений новые клиенты теряются.
 * Разрешение iPhone даёт только по нажатию — поэтому кнопка, а не автоматический запрос. Скрыть — до следующего запуска.
 */
export function WebPushPrompt() {
  const [state, setState] = useState<Need>(() => (dismissed() ? null : need()));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => setState(dismissed() ? null : need());
    window.addEventListener("push-subscription-changed", update);
    return () => window.removeEventListener("push-subscription-changed", update);
  }, []);
  if (!state) return null;

  const hide = () => { try { sessionStorage.setItem(DISMISSED, "1"); } catch { /* закроется до перезагрузки */ } setState(null); };
  const allow = async () => {
    setBusy(true);
    try {
      await requestPushPermission();
      toast.success("Уведомления включены", "Новые обращения придут, даже когда приложение закрыто.");
    } catch (error) {
      toast.error("Уведомления не включились", error instanceof Error ? error.message : undefined);
    } finally { setBusy(false); setState(need()); }
  };
  const text = state === "install" ? IOS_INSTALL_HINT
    : state === "allow" ? "Включите уведомления, чтобы не пропускать новых клиентов, когда приложение закрыто."
    : isIos() ? "Уведомления запрещены. Включите их: Настройки iPhone → Уведомления → Живая Сказка."
    : "Уведомления запрещены. Разрешите их для этого сайта в настройках браузера.";

  return (
    <div className={s.strip} role="status">
      <div className={s.inner}>
        {state === "install" ? <Share aria-hidden className={s.icon} /> : <BellRing aria-hidden className={s.icon} />}
        <p className={s.hint}>{text}</p>
        {state === "allow" && <Button size="sm" onClick={() => void allow()} loading={busy}>Включить</Button>}
        <button type="button" className={s.close} aria-label="Скрыть подсказку" onClick={hide}><X /></button>
      </div>
    </div>
  );
}
