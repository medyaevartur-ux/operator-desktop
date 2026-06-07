import { Search, Inbox, Flame, Clock, User, Bot, CheckCircle2, XCircle } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNotificationStore } from "@/store/notification.store";
import { Avatar } from "@/components/ui";
import { SkeletonCard } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { formatChatTime, getSlaMinutes, getSlaState, formatSlaLabel } from "@/features/inbox/inbox.utils";
import { markChatSessionRead } from "@/features/inbox/inbox.api";
import type { InboxFilter } from "@/features/inbox/inbox.utils";
import type { ChatSession } from "@/types/chat";
import s from "./ChatSidebar.module.css";

const URGENT_THRESHOLD_MS = 60 * 1000; // > 60 сек без ответа = срочно

/* ── Filters ── */

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "Входящие" },
  { key: "with_operator", label: "Мои" },
  { key: "closed", label: "Все" },
];

/* ── Status helpers ── */

function getSessionStatus(status: string): "online" | "away" | "dnd" | "offline" {
  if (status === "with_operator") return "online";
  if (status === "ai") return "away";
  if (status === "closed") return "offline";
  return "dnd";
}

function getStatusDotClass(status: string): string {
  if (status === "with_operator") return s.statusOperator;
  if (status === "ai") return s.statusAi;
  if (status === "closed") return s.statusClosed;
  return s.statusOther;
}

/* ── SessionCard ── */

function SessionCard({
  session,
  isActive,
  isVisitorOnline,
  onClick,
}: {
  session: ChatSession;
  isActive: boolean;
  isVisitorOnline: boolean;
  onClick: () => void;
}) {
  const displayName = getSessionDisplayName(session.visitor_name, session.visitor_id);
  const unread = session.unread_count ?? 0;
  const lastTime = formatChatTime(session.last_message_at ?? session.created_at);
  const preview = session.last_message_text || session.visitor_email || session.current_page || session.visitor_phone || "Новый диалог";
  const totalVisits = session.total_visitor_sessions ?? session.visit_count ?? 1;
  const priority = session.priority || "normal";
  const isVip = session.is_vip === true;
  // «Пропущено» — посетитель ждёт оператора и его ещё не взяли, либо есть неотвеченные сообщения без оператора
  const isMissed =
    session.status === "waiting_operator" ||
    (!session.operator_id &&
      (session.unread_count ?? 0) > 0 &&
      session.last_message_sender === "visitor" &&
      session.status !== "closed");

  const slaEnabled = useNotificationStore((n) => n.slaEnabled);
  const slaWarnMin = useNotificationStore((n) => n.slaWarnMinutes);
  const slaOverdueMin = useNotificationStore((n) => n.slaOverdueMinutes);
  const slaMin = slaEnabled ? getSlaMinutes(session) : null;
  const slaState = getSlaState(slaMin, slaWarnMin, slaOverdueMin);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${s.card} ${isActive ? s.cardActive : ""} ${
        slaState === "overdue" ? s.cardSlaOverdue :
        priority === "urgent" ? s.cardUrgent :
        priority === "high" ? s.cardHigh :
        priority === "low" ? s.cardLow : ""
      }`}
    >
      {/* Avatar with status dot + priority border */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Avatar
          name={displayName}
          size="md"
          status={isVisitorOnline ? "online" : "offline"}
        />
      </div>

      <div className={s.cardBody}>
        {/* Name + time + badge row */}
        <div className={s.cardRow}>
          <div className={s.cardName}>
            {isVip && <span className={s.vipBadge}>VIP</span>}
            {displayName}
          </div>
          <div className={s.cardTimeBadge}>
            <span className={s.cardTime}>{lastTime}</span>
            {unread > 0 && (
              <span className={s.unreadBadge}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </div>
        </div>

        {/* «Пропущено» — чёткий красный индикатор для неотвеченных */}
        {isMissed && (
          <div className={s.missedBadge}>
            <XCircle style={{ width: 13, height: 13 }} />
            Пропущенное обращение
          </div>
        )}

        {/* Превью последнего сообщения (одна строка) */}
        <div className={s.cardPreview}>
          {!isMissed && slaState === "overdue" && (
            <span
              className={`${s.slaBadge} ${s.slaOverdue}`}
              title={`Без ответа оператора ${slaMin} мин`}
            >
              <Clock style={{ width: 10, height: 10 }} />
              {formatSlaLabel(slaMin ?? 0)}
            </span>
          )}
          {totalVisits > 1 && (
            <span className={s.repeatBadge} title={`Повторных визитов: ${totalVisits}`}>×{totalVisits}</span>
          )}
          {preview}
        </div>
      </div>
    </button>
  );
}

/* ── Empty State ── */

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>
        {hasSearch ? (
          <Search style={{ width: 24, height: 24 }} />
        ) : (
          <Inbox style={{ width: 24, height: 24 }} />
        )}
      </div>
      <div className={s.emptyTitle}>
        {hasSearch ? "Ничего не найдено" : "Нет диалогов"}
      </div>
      <div className={s.emptyDesc}>
        {hasSearch
          ? "Попробуйте изменить параметры поиска"
          : "Новые диалоги появятся здесь автоматически"}
      </div>
    </div>
  );
}

/* ── Main ── */

export function ChatSidebar() {
  const {
    sessions,
    activeSession,
    openSession,
    isSessionsLoading,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
  } = useInboxStore();
  const myOperatorId = useAuthStore((st) => st.operator?.id);
  const visitors = useVisitorsStore((st) => st.visitors);

  // Тик раз в 30с — чтобы SLA-таймеры на карточках «росли» без новых событий.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const onlineVisitorIds = useMemo(
    () => new Set(visitors.filter((v) => v.is_online).map((v) => v.visitor_id)),
    [visitors]
  );

  const filteredSessions = useMemo(() => {
    let next = sessions;

    if (filter === "with_operator") {
      // «Мои» — только сессии, привязанные к текущему оператору
      next = next.filter((ses) => ses.operator_id === myOperatorId);
    } else if (filter === "ai") {
      next = next.filter((ses) => ses.status === "ai");
    }
    // filter "all" и "closed" — без фильтрации (закрытые показываются вместе со всеми)

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      next = next.filter((ses) => {
        const displayName = getSessionDisplayName(ses.visitor_name, ses.visitor_id).toLowerCase();
        return [
          displayName,
          ses.visitor_email ?? "",
          ses.visitor_phone ?? "",
          ses.visitor_id ?? "",
          ses.current_page ?? "",
          ses.city ?? "",
          ses.country ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
    }

    return next;
  }, [filter, searchQuery, sessions, myOperatorId]);

  // Группировка по сегментам — только когда выбран фильтр "Входящие".
  // В остальных режимах показываем плоский список.
  const segments = useMemo(() => {
    if (filter !== "all" || searchQuery.trim()) return null;
    const now = Date.now();
    const urgent: ChatSession[] = [];
    const waiting: ChatSession[] = [];
    const mine: ChatSession[] = [];
    const ai: ChatSession[] = [];
    const closed: ChatSession[] = [];

    for (const ses of filteredSessions) {
      if (ses.status === "closed") { closed.push(ses); continue; }
      // Разделение операторов: чат, который взял ДРУГОЙ оператор, во «Входящих» не показываем
      if (ses.operator_id && ses.operator_id !== myOperatorId) { continue; }
      const lastTs = ses.last_message_at ? new Date(ses.last_message_at).getTime() : 0;
      const unread = ses.unread_count ?? 0;
      const isUrgent = unread > 0 && lastTs > 0 && (now - lastTs) > URGENT_THRESHOLD_MS && !ses.operator_id;

      if (isUrgent) { urgent.push(ses); continue; }
      if (ses.operator_id === myOperatorId && myOperatorId) { mine.push(ses); continue; }
      if (ses.status === "ai") { ai.push(ses); continue; }
      waiting.push(ses);
    }

    return { urgent, waiting, mine, ai, closed };
  }, [filteredSessions, filter, searchQuery, myOperatorId]);

  return (
    <aside className={s.sidebar}>
      <div className={s.header}>
        <h2 className={s.title}>Диалоги</h2>

        {/* Filter pills */}
        <div className={s.filters}>
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`${s.filterPill} ${filter === item.key ? s.filterPillActive : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className={s.searchWrap}>
          <Search className={s.searchIcon} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по имени, email, телефону..."
            className={s.searchInput}
          />
        </div>
      </div>

      {/* List */}
      <div className={`${s.list} scrollbar-thin`}>
        {/* Skeleton loading */}
        {isSessionsLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {/* Empty state */}
        {!isSessionsLoading && filteredSessions.length === 0 && (
          <EmptyState hasSearch={!!searchQuery.trim()} />
        )}

        {/* Сегментированный список (только в фильтре "Все") */}
        {!isSessionsLoading && segments && filteredSessions.length > 0 && (
          <>
            <Segment icon={Flame} label="Срочные" cssClass={s.sectionUrgent} items={segments.urgent} activeId={activeSession?.id} onPick={pickSession} onlineSet={onlineVisitorIds} />
            <Segment icon={Clock} label="Ждут оператора" cssClass={s.sectionWaiting} items={segments.waiting} activeId={activeSession?.id} onPick={pickSession} onlineSet={onlineVisitorIds} />
            <Segment icon={User} label="Мои" cssClass={s.sectionMine} items={segments.mine} activeId={activeSession?.id} onPick={pickSession} onlineSet={onlineVisitorIds} />
            <Segment icon={Bot} label="У бота" cssClass={s.sectionAi} items={segments.ai} activeId={activeSession?.id} onPick={pickSession} onlineSet={onlineVisitorIds} />
            <Segment icon={CheckCircle2} label="Закрытые" cssClass="" items={segments.closed} activeId={activeSession?.id} onPick={pickSession} onlineSet={onlineVisitorIds} />
          </>
        )}

        {/* Плоский список (поиск или конкретный фильтр) */}
        {!isSessionsLoading && !segments && filteredSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={activeSession?.id === session.id}
            isVisitorOnline={onlineVisitorIds.has(session.visitor_id)}
            onClick={() => pickSession(session)}
          />
        ))}
      </div>
    </aside>
  );

  function pickSession(session: ChatSession) {
    openSession(session);
    void useInboxStore.getState().loadMessages(session.id);
    if (session.unread_count && session.unread_count > 0) {
      void markChatSessionRead(session.id);
      useInboxStore.setState((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === session.id ? { ...s, unread_count: 0 } : s
        ),
      }));
    }
  }
}

function Segment({
  icon: Icon, label, cssClass, items, activeId, onPick, onlineSet,
}: {
  icon: typeof Flame;
  label: string;
  cssClass: string;
  items: ChatSession[];
  activeId: string | undefined;
  onPick: (s: ChatSession) => void;
  onlineSet: Set<string>;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className={`${s.section} ${cssClass}`}>
        <Icon className={s.sectionIcon} />
        {label}
        <span className={s.sectionCount}>{items.length}</span>
      </div>
      {items.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          isActive={activeId === session.id}
          isVisitorOnline={onlineSet.has(session.visitor_id)}
          onClick={() => onPick(session)}
        />
      ))}
    </>
  );
}