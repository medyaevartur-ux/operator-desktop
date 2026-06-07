import { useEffect, useRef } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useNotificationStore } from "@/store/notification.store";
import { getSlaMinutes, getSessionDisplayName } from "./inbox.utils";
import { showNativeNotification } from "@/lib/tauri-bridge";

/**
 * SLA-эскалация: следит за диалогами без ответа оператора. Когда чат пересекает
 * порог «просрочено», проигрывает настойчивый звук и шлёт нативное
 * Windows-уведомление.
 *
 * Эскалация ПРИОРИТЕТНА (override): звук + нативный тост срабатывают даже при
 * выключенных soundEnabled / desktopEnabled и в режиме DND — оператор не должен
 * пропустить чат, висящий без ответа.
 *
 * Анти-спам (вместо подавления бэклога):
 *  - бэклог НЕ глушится — уже-просроченные при старте тоже оповещаются;
 *  - повторное оповещение по одному чату — не чаще раза в REALERT_MS;
 *  - когда оператор ответил/закрыл — чат выходит из набора и анти-спам сбрасывается.
 */
const REALERT_MS = 5 * 60 * 1000; // не чаще раза в 5 минут на сессию за сессию-аппа

export function useSla() {
  // sessionId -> время последнего оповещения (мс).
  const lastAlertRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const tick = () => {
      const notif = useNotificationStore.getState();
      if (!notif.slaEnabled) return;

      const sessions = useInboxStore.getState().sessions;
      // Не обрабатываем пустой набор при mount — дождёмся загрузки sessions.
      if (sessions.length === 0) return;

      const now = Date.now();
      const overdueIds = new Set<string>();

      for (const session of sessions) {
        const mins = getSlaMinutes(session, now);
        if (mins == null || mins < notif.slaOverdueMinutes) continue;

        overdueIds.add(session.id);

        // Анти-спам по времени: одно оповещение на чат не чаще REALERT_MS.
        const last = lastAlertRef.current.get(session.id) ?? 0;
        if (now - last < REALERT_MS) continue;
        lastAlertRef.current.set(session.id, now);

        // Эскалация — критический сигнал: поверх настроек/DND.
        notif.playSound("operator_request", true);
        const name = getSessionDisplayName(session.visitor_name, session.visitor_id);
        void showNativeNotification(
          "⏱ Чат без ответа",
          `${name} ждёт ответа уже ${mins} мин`,
          session.id,
        );
      }

      // Чат перестал быть просроченным (оператор ответил/закрыл) — сбросить
      // анти-спам, чтобы при новом эпизоде он снова мог оповестить сразу.
      for (const id of Array.from(lastAlertRef.current.keys())) {
        if (!overdueIds.has(id)) lastAlertRef.current.delete(id);
      }
    };

    tick();
    const timer = setInterval(tick, 20000);
    return () => clearInterval(timer);
  }, []);
}
