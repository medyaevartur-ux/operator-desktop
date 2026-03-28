import { useState, useEffect, useRef, useCallback } from "react";
import { Clock, UserPlus, AlertTriangle, Inbox, Volume2 } from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { getQueueSessions, assignSession } from "@/features/inbox/inbox.api";
import { Avatar } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { useNotificationStore } from "@/store/notification.store";
import type { ChatSession } from "@/types/chat";
import s from "./QueueScreen.module.css";


/* ── Timer helpers ── */

function getWaitSeconds(queuedAt: string | null): number {
  if (!queuedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(queuedAt).getTime()) / 1000));
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}с`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return `${min}м ${sec.toString().padStart(2, "0")}с`;
  const hr = Math.floor(min / 60);
  return `${hr}ч ${(min % 60).toString().padStart(2, "0")}м`;
}

function getWaitColor(seconds: number): string {
  if (seconds < 60) return "var(--status-online, #22c55e)";
  if (seconds < 180) return "var(--status-away, #f59e0b)";
  if (seconds < 300) return "#f97316";
  return "#ef4444";
}

function getWaitLevel(seconds: number): "green" | "yellow" | "orange" | "red" {
  if (seconds < 60) return "green";
  if (seconds < 180) return "yellow";
  if (seconds < 300) return "orange";
  return "red";
}

/* ── QueueCard ── */

function QueueCard({
  session,
  onAssign,
  isAssigning,
}: {
  session: ChatSession;
  onAssign: (id: string) => void;
  isAssigning: boolean;
}) {
  const [waitSec, setWaitSec] = useState(() => getWaitSeconds(session.queued_at));

  useEffect(() => {
    const timer = setInterval(() => {
      setWaitSec(getWaitSeconds(session.queued_at));
    }, 1000);
    return () => clearInterval(timer);
  }, [session.queued_at]);

  const level = getWaitLevel(waitSec);
  const displayName = getSessionDisplayName(session.visitor_name, session.visitor_id);
  const priority = session.priority || "normal";
  const isVip = session.is_vip === true;
  const totalVisits = (session as any).total_visitor_sessions ?? session.visit_count ?? 1;

  return (
    <div
      className={`${s.card} ${
        level === "red" ? s.cardRed :
        level === "orange" ? s.cardOrange :
        level === "yellow" ? s.cardYellow : s.cardGreen
      } ${
        priority === "urgent" ? s.cardPriorityUrgent :
        priority === "high" ? s.cardPriorityHigh : ""
      }`}
    >
      <div className={s.cardTop}>
        <div className={s.cardUser}>
          <Avatar name={displayName} size="md" />
          <div>
            <div className={s.cardName}>
              {isVip && <span className={s.vipBadge}>VIP</span>}
              {displayName}
            </div>
            <div className={s.cardMeta}>
              {session.current_page && (
                <span className={s.cardPage}>📄 {session.current_page_title || session.current_page}</span>
              )}
              {totalVisits > 1 && (
                <span className={s.repeatBadge}>×{totalVisits}</span>
              )}
            </div>
          </div>
        </div>

        <div className={s.timerBlock}>
          <div className={s.timerValue} style={{ color: getWaitColor(waitSec) }}>
            <Clock style={{ width: 14, height: 14 }} />
            {formatWait(waitSec)}
          </div>
          {level === "red" && (
            <div className={s.timerAlert}>
              <AlertTriangle style={{ width: 12, height: 12 }} />
              Долгое ожидание
            </div>
          )}
        </div>
      </div>

      <div className={s.cardBottom}>
        <div className={s.cardInfo}>
          <span className={s.cardMessages}>
            {session.messages_count ?? 0} сообщ.
          </span>
          {priority !== "normal" && (
            <span className={`${s.priorityLabel} ${
              priority === "urgent" ? s.priorityUrgent :
              priority === "high" ? s.priorityHigh : s.priorityLow
            }`}>
              {priority === "urgent" ? "🔴 Срочный" :
               priority === "high" ? "🟡 Высокий" : "⬇️ Низкий"}
            </span>
          )}
        </div>

        <button
          type="button"
          className={s.assignBtn}
          onClick={() => onAssign(session.id)}
          disabled={isAssigning}
        >
          <UserPlus style={{ width: 15, height: 15 }} />
          Забрать
        </button>
      </div>
    </div>
  );
}

/* ── QueueScreen ── */

export function QueueScreen() {
  const [queue, setQueue] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const operator = useAuthStore((st) => st.operator);
  const prevCountRef = useRef(0);
  const soundEnabled = useNotificationStore((st) => st.soundEnabled);

  const loadQueue = useCallback(async () => {
    try {
      const data = await getQueueSessions();
      setQueue(data);

      // Звук при новом чате в очереди
      if (data.length > prevCountRef.current && prevCountRef.current > 0 && soundEnabled) {
        try {
          const audio = new Audio("/sounds/queue-alert.mp3");
          audio.volume = 0.5;
          audio.play().catch(() => {});
        } catch {}
      }
      prevCountRef.current = data.length;
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [soundEnabled]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 5000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  // Слушаем WebSocket queue_updated
  useEffect(() => {
    const handleQueueUpdate = () => {
      loadQueue();
    };

    // Подписка через глобальный сокет inbox store
    const sessions = useInboxStore.getState().sessions;
    // Просто делаем polling, сокет уже триггерит session_updated
    // который вызывает loadSessions в use-inbox-realtime

    return () => {};
  }, [loadQueue]);

  const handleAssign = async (sessionId: string) => {
    if (!operator?.id) return;
    setAssigningId(sessionId);
    try {
      await assignSession(sessionId, operator.id);
      setQueue((prev) => prev.filter((s) => s.id !== sessionId));
      // Обновить sidebar
      void useInboxStore.getState().loadSessions();
    } catch (err) {
      console.error("Ошибка забора чата:", err);
    } finally {
      setAssigningId(null);
    }
  };

  if (isLoading) {
    return (
      <div className={s.screen}>
        <div className={s.header}>
          <h2 className={s.title}>Очередь</h2>
        </div>
        <div className={s.loading}>Загрузка...</div>
      </div>
    );
  }

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <h2 className={s.title}>
          Очередь
          {queue.length > 0 && (
            <span className={s.queueCount}>{queue.length}</span>
          )}
        </h2>
        <p className={s.subtitle}>
          Неназначенные чаты, ожидающие оператора
        </p>
      </div>

      <div className={s.list}>
        {queue.length === 0 ? (
          <div className={s.empty}>
            <Inbox style={{ width: 40, height: 40, opacity: 0.3 }} />
            <div className={s.emptyTitle}>Очередь пуста</div>
            <div className={s.emptyDesc}>Все клиенты обслужены 🎉</div>
          </div>
        ) : (
          queue.map((session) => (
            <QueueCard
              key={session.id}
              session={session}
              onAssign={handleAssign}
              isAssigning={assigningId === session.id}
            />
          ))
        )}
      </div>
    </div>
  );
}