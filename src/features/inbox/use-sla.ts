import { useEffect, useRef } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useNotificationStore } from "@/store/notification.store";
import { getSlaMinutes, getSessionDisplayName } from "./inbox.utils";
import { showNativeNotification } from "@/lib/tauri-bridge";

/**
 * SLA-эскалация: следит за диалогами без ответа оператора. Когда чат пересекает
 * порог «просрочено», проигрывает тревожный звук и шлёт нативное Windows-уведомление.
 *
 * Анти-спам:
 *  - на первом тике запоминаем уже просроченные (бэклог), чтобы не залить уведомлениями при старте;
 *  - на каждый чат — одно оповещение за «эпизод» (пока он остаётся просроченным);
 *  - когда оператор ответил/закрыл — чат выходит из набора и может оповестить снова позже.
 */
export function useSla() {
  const alertedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const notif = useNotificationStore.getState();
      if (!notif.slaEnabled) return;

      const sessions = useInboxStore.getState().sessions;
      const now = Date.now();
      const overdueIds = new Set<string>();

      for (const session of sessions) {
        const mins = getSlaMinutes(session, now);
        if (mins != null && mins >= notif.slaOverdueMinutes) {
          overdueIds.add(session.id);
        }
      }

      // Первый запуск — фиксируем текущий бэклог как «уже известный», без оповещений.
      if (!seededRef.current) {
        seededRef.current = true;
        overdueIds.forEach((id) => alertedRef.current.add(id));
        return;
      }

      for (const session of sessions) {
        const mins = getSlaMinutes(session, now);
        if (mins == null || mins < notif.slaOverdueMinutes) continue;
        if (alertedRef.current.has(session.id)) continue;

        alertedRef.current.add(session.id);
        if (notif.isDndNow()) continue;

        if (notif.soundEnabled) notif.playSound("operator_request");
        if (notif.desktopEnabled) {
          const name = getSessionDisplayName(session.visitor_name, session.visitor_id);
          void showNativeNotification(
            "⏱ Чат без ответа",
            `${name} ждёт ответа уже ${mins} мин`,
            session.id,
          );
        }
      }

      // Сброс оповещения для чатов, которые перестали быть просроченными (оператор ответил/закрыл).
      for (const id of Array.from(alertedRef.current)) {
        if (!overdueIds.has(id)) alertedRef.current.delete(id);
      }
    };

    tick(); // сразу зафиксировать бэклог
    const timer = setInterval(tick, 20000);
    return () => clearInterval(timer);
  }, []);
}
