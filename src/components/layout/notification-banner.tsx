import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useNotificationStore } from "@/store/notification.store";
import { Avatar, Button } from "@/components/ui";
import s from "./NotificationBanner.module.css";

/**
 * Строка о новых сообщениях над текущим экраном. Стоит в потоке и сдвигает
 * содержимое, поэтому не закрывает кнопки в шапке. Живёт, пока
 * useNotificationStore.pending непуст.
 *
 *  - «Открыть» — событие "open-chat" (как клик по системному уведомлению).
 *  - × — снимает уведомление (если чатов несколько — все).
 */
export function NotificationBanner() {
  const pending = useNotificationStore(st => st.pending);
  const clearNotifications = useNotificationStore(st => st.clearNotifications);
  const clearAll = useNotificationStore(st => st.clearAll);

  const items = useMemo(() => Object.values(pending).sort((a, b) => b.timestamp - a.timestamp), [pending]);
  const latest = items[0];
  const extraChats = items.length - 1;

  const openChat = () => {
    if (!latest) return;
    window.dispatchEvent(new CustomEvent("open-chat", { detail: { sessionId: latest.sessionId } }));
    // Обработчик open-chat снимет уведомление сам; здесь — на случай, если сессии ещё нет в списке.
    clearNotifications(latest.sessionId);
  };
  const dismiss = () => (items.length > 1 ? clearAll() : latest && clearNotifications(latest.sessionId));

  return (
    <AnimatePresence initial={false}>
      {latest && (
        <motion.div
          className={s.strip}
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        >
          <div className={s.inner}>
            <Avatar name={latest.visitorName} size="sm" />
            <p className={s.text}>
              <strong>{latest.visitorName}{latest.count > 1 ? ` · ${latest.count} новых` : ""}</strong>
              <span>{latest.lastMessage}</span>
              {extraChats > 0 && <em>и ещё {extraChats} {pluralChats(extraChats)}</em>}
            </p>
            <Button size="sm" onClick={openChat}>Открыть</Button>
            <button type="button" className={s.close} aria-label="Скрыть уведомление" onClick={dismiss}><X /></button>
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
