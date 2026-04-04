import { Search, Inbox, ScrollText } from "lucide-react";
import { useMemo } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useNavigationStore } from "@/store/navigation.store";
import { Avatar } from "@/components/ui";
import { SkeletonCard } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import { formatChatTime } from "@/features/inbox/inbox.utils";
import { markChatSessionRead } from "@/features/inbox/inbox.api";
import type { InboxFilter } from "@/features/inbox/inbox.utils";
import type { ChatSession } from "@/types/chat";
import s from "./MobileChatList.module.css";

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "Все" },
  { key: "with_operator", label: "Мои" },
  { key: "ai", label: "AI" },
  { key: "closed", label: "Все" },
];

function getSessionStatus(status: string): "online" | "away" | "dnd" | "offline" {
  if (status === "with_operator") return "online";
  if (status === "ai") return "away";
  if (status === "closed") return "offline";
  return "dnd";
}

function MobileSessionCard({
  session,
  onClick,
}: {
  session: ChatSession;
  onClick: () => void;
}) {
  const displayName = getSessionDisplayName(session.visitor_name, session.visitor_id);
  const unread = session.unread_count ?? 0;
  const lastTime = formatChatTime(session.last_message_at ?? session.created_at);
  const preview = session.last_message_text || session.visitor_email || "Новый диалог";

  return (
    <button type="button" onClick={onClick} className={s.card}>
      <Avatar
        name={displayName}
        size="md"
        status={getSessionStatus(session.status)}
      />
      <div className={s.cardBody}>
        <div className={s.cardRow}>
          <div className={s.cardName}>{displayName}</div>
          <div className={s.cardTimeBadge}>
            <span className={s.cardTime}>{lastTime}</span>
            {unread > 0 && (
              <span className={s.unreadBadge}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </div>
        </div>
        <div className={s.cardPreview}>{preview}</div>
      </div>
    </button>
  );
}

export function MobileChatList() {
  const {
    sessions,
    setActiveSession,
    isSessionsLoading,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
  } = useInboxStore();
  const setMobileView = useNavigationStore((s) => s.setMobileView);

  const filteredSessions = useMemo(() => {
    let next = sessions;
    if (filter !== "all" && filter !== "closed") {
      next = next.filter((ses) => ses.status === filter);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      next = next.filter((ses) => {
        const name = getSessionDisplayName(ses.visitor_name, ses.visitor_id).toLowerCase();
        return [name, ses.visitor_email ?? "", ses.visitor_phone ?? ""]
          .join(" ")
          .includes(query);
      });
    }
    return next;
  }, [filter, searchQuery, sessions]);

  const handleSelectSession = (session: ChatSession) => {
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
    setMobileView("chat-conversation");
  };

  return (
    <div className={s.container}>
      <div className={s.header}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 className={s.title}>Диалоги</h1>
          <button
            type="button"
            onClick={() => setMobileView("logs")}
            style={{
              background: "none",
              border: "1px solid #ccc",
              borderRadius: 8,
              padding: "6px 10px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "#666",
            }}
          >
            <ScrollText style={{ width: 16, height: 16 }} />
            Логи
          </button>
        </div>
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
        <div className={s.searchWrap}>
          <Search className={s.searchIcon} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск..."
            className={s.searchInput}
          />
        </div>
      </div>

      <div className={s.list}>
        {isSessionsLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!isSessionsLoading && filteredSessions.length === 0 && (
          <div className={s.empty}>
            <Inbox style={{ width: 32, height: 32, color: "var(--text-disabled)" }} />
            <p>Нет диалогов</p>
          </div>
        )}

        {filteredSessions.map((session) => (
          <MobileSessionCard
            key={session.id}
            session={session}
            onClick={() => handleSelectSession(session)}
          />
        ))}
      </div>
    </div>
  );
}