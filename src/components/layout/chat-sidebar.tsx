import { Search, MessageSquareText, Inbox } from "lucide-react";
import { useMemo } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { Avatar } from "@/components/ui";
import { SkeletonCard } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { formatChatTime } from "@/features/inbox/inbox.utils";
import { markChatSessionRead } from "@/features/inbox/inbox.api";
import type { InboxFilter } from "@/features/inbox/inbox.utils";
import type { ChatSession } from "@/types/chat";
import s from "./ChatSidebar.module.css";

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

  const filteredSessions = useMemo(() => {
    let next = sessions;

    if (filter !== "all" && filter !== "closed") {
      next = next.filter((ses) => ses.status === filter);
    }

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
  }, [filter, searchQuery, sessions]);

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

        {/* Session list */}
        {filteredSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={activeSession?.id === session.id}
            onClick={() => {
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
            }}
          />
        ))}
      </div>
    </aside>
  );
}