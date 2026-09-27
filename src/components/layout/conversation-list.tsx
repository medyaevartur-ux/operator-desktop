import { useEffect, useMemo, useState } from "react";
import { Flag, Inbox, Search, Star } from "lucide-react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNotificationStore } from "@/store/notification.store";
import { Avatar, SkeletonCard } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { groupConversations, shortTime, waitingLabel, waitingMinutes } from "@/features/inbox/conversation-list";
import { pickConversation } from "@/lib/open-conversation";
import type { ChatSession } from "@/types/chat";
import s from "./ConversationList.module.css";

function previewOf(session: ChatSession, typing: string | null) {
  if (typing !== null) return { text: typing ? `печатает: ${typing}` : "печатает…", typing: true };
  const text = session.last_message_text?.trim();
  if (!text) return { text: session.current_page_title || session.visitor_email || "Новый диалог", typing: false };
  const prefix = session.last_message_sender === "operator" ? "Вы: " : session.last_message_sender === "ai" ? "Бот: " : "";
  return { text: prefix + text, typing: false };
}

function Row({ session, active, online, now }: { session: ChatSession; active: boolean; online: boolean; now: number }) {
  const name = getSessionDisplayName(session.visitor_name, session.visitor_id);
  const unread = session.unread_count ?? 0;
  const typing = useInboxStore(state => {
    const item = state.typingPreviews[session.id];
    return item?.isTyping && now - item.updatedAt < 8000 ? item.text : null;
  });
  const warn = useNotificationStore(state => state.slaWarnMinutes);
  const overdue = useNotificationStore(state => state.slaOverdueMinutes);
  const wait = waitingMinutes(session, now);
  const level = wait === null ? null : wait >= overdue ? "overdue" : wait >= warn ? "warn" : "fresh";
  const preview = previewOf(session, typing);
  const flagged = session.priority === "urgent" || session.priority === "high";

  return (
    <button
      type="button"
      className={s.row}
      data-active={active || undefined}
      data-unread={unread > 0 || undefined}
      aria-current={active ? "true" : undefined}
      onClick={() => pickConversation(session)}
    >
      <Avatar name={name} size="md" status={online ? "online" : undefined} />
      <span className={s.body}>
        <span className={s.line}>
          <span className={s.name}>{name}</span>
          {session.is_vip && <Star className={s.vip} aria-label="VIP" />}
          {flagged && <Flag className={s.flag} data-priority={session.priority} aria-label={session.priority === "urgent" ? "Срочно" : "Высокий приоритет"} />}
          {level && level !== "fresh" && wait !== null
            ? <span className={s.wait} data-level={level}>{waitingLabel(wait)}</span>
            : <span className={s.time}>{shortTime(session.last_message_at ?? session.created_at, now)}</span>}
        </span>
        <span className={s.line}>
          <span className={s.preview} data-typing={preview.typing || undefined}>{preview.text}</span>
          {unread > 0 && <span className={s.count} aria-label={`Непрочитанных: ${unread}`}>{unread > 99 ? "99+" : unread}</span>}
        </span>
      </span>
    </button>
  );
}

export function ConversationList() {
  const sessions = useInboxStore(state => state.sessions);
  const activeId = useInboxStore(state => state.activeSession?.id);
  const loading = useInboxStore(state => state.isSessionsLoading);
  const filter = useInboxStore(state => state.filter);
  const query = useInboxStore(state => state.searchQuery);
  const me = useAuthStore(state => state.operator?.id);
  const visitors = useVisitorsStore(state => state.visitors);

  // Таймеры ожидания растут без новых событий.
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);

  const online = useMemo(() => new Set(visitors.filter(item => item.is_online).map(item => item.visitor_id)), [visitors]);
  const groups = useMemo(() => groupConversations(sessions, { filter, query, me, now }), [sessions, filter, query, me, now]);

  if (loading && !sessions.length) return <div className={s.list}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;
  if (!groups.length) {
    const searching = !!query.trim();
    const Icon = searching ? Search : Inbox;
    return (
      <div className={s.empty}>
        <Icon className={s.emptyIcon} />
        <strong>{searching ? "Ничего не найдено" : filter === "with_operator" ? "Нет диалогов в работе" : "Всё спокойно"}</strong>
        <span>{searching ? "Проверьте имя, телефон или текст сообщения." : filter === "with_operator" ? "Взятые вами диалоги появятся здесь." : "Новые обращения появятся здесь сами."}</span>
      </div>
    );
  }
  return (
    <div className={s.list}>
      {groups.map(group => (
        <section key={group.key} className={s.group} aria-label={group.label}>
          <h3 className={s.groupLabel}>{group.label}<span>{group.items.length}</span></h3>
          {group.items.map(session => (
            <Row key={session.id} session={session} active={session.id === activeId} online={online.has(session.visitor_id)} now={now} />
          ))}
        </section>
      ))}
    </div>
  );
}
