import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNotificationStore } from "@/store/notification.store";
import s from "./NotificationBanner.module.css";

/**
 * Висящая плашка о непрочитанных чатах. Показывается поверх UI, пока
 * useNotificationStore.pending непуст.
 *
 *  - «Открыть чат» — диспатчит событие "open-chat" (тот же механизм, что и
 *    клик по нативному тосту в use-inbox-realtime): открывает сессию через
 *    openSession и снимает её уведомления.
 *  - «Отклонить» — clearNotifications для выбранной сессии (а при наличии
 *    нескольких — снимает все pending).
 */
export function NotificationBanner() {
  const pending = useNotificationStore((st) => st.pending);
  const clearNotifications = useNotificationStore((st) => st.clearNotifications);
  const clearAll = useNotificationStore((st) => st.clearAll);

  // Самый свежий ожидающий чат — его и открываем по кнопке.
  const items = useMemo(
    () => Object.values(pending).sort((a, b) => b.timestamp - a.timestamp),
    [pending],
  );
  const latest = items[0];
  const totalCount = items.reduce((sum, p) => sum + p.count, 0);
  const extraChats = items.length - 1;

  const openChat = () => {
    if (!latest) return;
    window.dispatchEvent(
      new CustomEvent("open-chat", { detail: { sessionId: latest.sessionId } }),
    );
    // open-chat-обработчик сам вызовет clearNotifications для этой сессии,
    // но подстрахуемся на случай, если сессии ещё нет в списке.
    clearNotifications(latest.sessionId);
  };

  const dismiss = () => {
    if (items.length > 1) clearAll();
    else if (latest) clearNotifications(latest.sessionId);
  };

  return (
    <AnimatePresence>
      {latest && (
        <motion.div
          className={s.banner}
          role="alert"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className={s.badge}>{totalCount}</span>

          <div className={s.body}>
            <div className={s.title}>
              {latest.count > 1
                ? `${latest.count} новых от ${latest.visitorName}`
                : `Сообщение от ${latest.visitorName}`}
            </div>
            <div className={s.message}>
              {latest.lastMessage}
              {extraChats > 0 && (
                <span className={s.more}>
                  {" "}
                  и ещё {extraChats}{" "}
                  {pluralChats(extraChats)}
                </span>
              )}
            </div>
          </div>

          <div className={s.actions}>
            <button type="button" className={s.openBtn} onClick={openChat}>
              Открыть чат
            </button>
            <button type="button" className={s.dismissBtn} onClick={dismiss}>
              Отклонить
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function pluralChats(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "чат";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "чата";
  return "чатов";
}

export default NotificationBanner;
