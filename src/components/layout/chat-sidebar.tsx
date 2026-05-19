import { Search, Inbox, Flame, Clock, User, Bot, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { Avatar } from "@/components/ui";
import { SkeletonCard } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { formatChatTime } from "@/features/inbox/inbox.utils";
import { markChatSessionRead } from "@/features/inbox/inbox.api";
import type { InboxFilter } from "@/features/inbox/inbox.utils";
import type { ChatSession } from "@/types/chat";
import s from "./ChatSidebar.module.css";

const URGENT_THRESHOLD_MS = 60 * 1000; // > 60 сек без ответа = срочно

/* ── Filters ── */

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "Входящие" },
  { key: "with_operator", label: "Мои" },
  { key: "ai", label: "AI" },
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
  onClick,
}: {
  session: ChatSession;
  isActive: boolean;
  onClick: () => void;
}) {
  const displayName = getSessionDisplayName(session.visitor_name, session.visitor_id);
  const unread = session.unread_count ?? 0;
  const lastTime = formatChatTime(session.last_message_at ?? session.created_at);
  const preview = session.last_message_text || session.visitor_email || session.current_page || session.visitor_phone || "Новый диалог";
  const totalVisits = (session as any).total_visitor_sessions ?? 1;
  const priority = (session as any).priority || "normal";
  const isVip = (session as any).is_vip === true;  
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${s.card} ${isActive ? s.cardActive : ""} ${
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
          status={getSessionStatus(session.status)}
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

        {/* Preview + repeat badge */}
        <div className={s.cardPreview}>
          {totalVisits > 1 && (
            <span className={s.repeatBadge}>×{totalVisits}</span>
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
    setActiveSession,
    isSessionsLoading,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
  } = useInboxStore();
  const myOperatorId = useAuthStore((st) => st.operator?.id);

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
      const lastTs = ses.last_message_at ? new Date(ses.last_message_at).getTime() : 0;
      const unread = ses.unread_count ?? 0;
      const isUrgent = unread > 0 && lastTs > 0 && (now - lastTs) > URGENT_THRESHOLD_MS && !ses.operator_id;

      if (isUrgent) { urgent.push(ses); continue; }
      if (ses.operator_id === myOperatorId && myOperatorId) { mine.push(ses); continue; }
      if (ses.status === "with_operator") { mine.push(ses); continue; }
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
            <Segment icon={Flame} label="Срочные" cssClass={s.sectionUrgent} items={segments.urgent} activeId={activeSession?.id} onPick={pickSession} />
            <Segment icon={Clock} label="Ждут оператора" cssClass={s.sectionWaiting} items={segments.waiting} activeId={activeSession?.id} onPick={pickSession} />
            <Segment icon={User} label="Мои" cssClass={s.sectionMine} items={segments.mine} activeId={activeSession?.id} onPick={pickSession} />
            <Segment icon={Bot} label="У бота" cssClass={s.sectionAi} items={segments.ai} activeId={activeSession?.id} onPick={pickSession} />
            <Segment icon={CheckCircle2} label="Закрытые" cssClass="" items={segments.closed} activeId={activeSession?.id} onPick={pickSession} />
          </>
        )}

        {/* Плоский список (поиск или конкретный фильтр) */}
        {!isSessionsLoading && !segments && filteredSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={activeSession?.id === session.id}
            onClick={() => pickSession(session)}
          />
        ))}
      </div>
    </aside>
  );

  function pickSession(session: ChatSession) {
    setActiveSession(session);
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
  icon: Icon, label, cssClass, items, activeId, onPick,
}: {
  icon: typeof Flame;
  label: string;
  cssClass: string;
  items: ChatSession[];
  activeId: string | undefined;
  onPick: (s: ChatSession) => void;
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
          onClick={() => onPick(session)}
        />
      ))}
    </>
  );
}