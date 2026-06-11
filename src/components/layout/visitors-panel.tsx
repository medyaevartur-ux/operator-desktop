import { useVisitorsStore } from "@/store/visitors.store";
import { useInboxStore } from "@/store/inbox.store";
import {
  Search,
  Eye,
  MessageSquare,
  Ban,
  TrendingUp,
  History,
  Monitor,
  Smartphone,
  ExternalLink,
  Users,
} from "lucide-react";
import { useConfirm, Tooltip } from "@/components/ui";
import { blockVisitorIP, startChatWithVisitor } from "@/features/visitors/visitors.api";
import { VisitorHistoryDrawer } from "@/components/layout/visitor-history-drawer";
import type { SiteVisitor } from "@/types/visitor";
import s from "./VisitorsPanel.module.css";

export function VisitorsPanel() {
  const visitors = useVisitorsStore((st) => st.visitors);
  const search = useVisitorsStore((st) => st.search);
  const setSearch = useVisitorsStore((st) => st.setSearch);
  const filter = useVisitorsStore((st) => st.filter);
  const setFilter = useVisitorsStore((st) => st.setFilter);
  const selectedVisitorId = useVisitorsStore((st) => st.selectedVisitorId);
  const setSelectedVisitorId = useVisitorsStore((st) => st.setSelectedVisitorId);
  const blockVisitorLocal = useVisitorsStore((st) => st.blockVisitorIP);

  const onlineCount = useVisitorsStore((st) => st.onlineCount);
  const { confirm } = useConfirm();

  // Filter visitors locally
  const filteredVisitors = visitors.filter((v) => {
    // 1. Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      const idMatch = v.visitor_id.toLowerCase().includes(q);
      const pageMatch = (v.current_page || "").toLowerCase().includes(q);
      const pageTitleMatch = (v.current_page_title || "").toLowerCase().includes(q);
      const cityMatch = (v.city || "").toLowerCase().includes(q);
      const countryMatch = (v.country || "").toLowerCase().includes(q);

      if (!idMatch && !pageMatch && !pageTitleMatch && !cityMatch && !countryMatch) {
        return false;
      }
    }

    // 2. Filter by tabs
    if (filter === "with_chat") {
      return v.has_chat;
    }
    if (filter === "without_chat") {
      return !v.has_chat;
    }

    return true;
  });

  // Flag emoji helper
  const getCountryFlag = (countryCode: string | null) => {
    if (!countryCode) return "🌐";
    const codePoints = countryCode
      .toUpperCase()
      .split("")
      .map((char) => 127397 + char.charCodeAt(0));
    try {
      return String.fromCodePoint(...codePoints);
    } catch {
      return "🌐";
    }
  };

  // Avatar gradient helper
  const getAvatarGradient = (visitorId: string) => {
    let hash = 0;
    for (let i = 0; i < visitorId.length; i++) {
      hash = visitorId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${h}, 70%, 55%) 0%, hsl(${(h + 40) % 360}, 80%, 45%) 100%)`;
  };

  // Handle Ban
  const handleBan = async (e: React.MouseEvent, v: SiteVisitor) => {
    e.stopPropagation();
    const ok = await confirm({
      title: "Заблокировать посетителя?",
      message: `IP-адрес посетителя будет занесён в чёрный список. Он больше не сможет отправлять сообщения в виджет.`,
      confirmText: "Заблокировать",
      cancelText: "Отмена",
      danger: true,
    });

    if (!ok) return;

    try {
      await blockVisitorIP(v.visitor_id, "");
      blockVisitorLocal(v.visitor_id);
    } catch (err) {
      console.error("Failed to block IP:", err);
    }
  };

  // Handle Start Chat
  const handleStartChat = async (e: React.MouseEvent, v: SiteVisitor) => {
    e.stopPropagation();
    try {
      if (v.has_chat && v.chat_session_id) {
        // Already has chat, select it
        const inboxStore = useInboxStore.getState();
        await inboxStore.loadSessions();
        const session = inboxStore.sessions.find((s) => s.id === v.chat_session_id);
        if (session) {
          inboxStore.setActiveSession(session);
        }
      } else {
        // Create new chat
        const { session_id } = await startChatWithVisitor(v.visitor_id);
        const inboxStore = useInboxStore.getState();
        await inboxStore.loadSessions();
        const session = inboxStore.sessions.find((s) => s.id === session_id);
        if (session) {
          inboxStore.setActiveSession(session);
        }
      }
    } catch (err) {
      console.error("Failed to start chat:", err);
    }
  };

  const isCommercialPage = (page: string) => {
    const p = page.toLowerCase();
    return (
      p.includes("cart") ||
      p.includes("price") ||
      p.includes("checkout") ||
      p.includes("buy") ||
      p.includes("pricing") ||
      p.includes("product") ||
      p.includes("shop")
    );
  };

  return (
    <div className={s.panel}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerTop}>
          <div className={s.title}>
            <Users style={{ width: 16, height: 16, color: "var(--accent)" }} />
            <span>Активные визиты</span>
          </div>
          <div className={s.onlineBadge}>
            <span className={s.onlineDot} />
            {onlineCount} онлайн
          </div>
        </div>

        {/* Search */}
        <div className={s.searchWrap}>
          <Search className={s.searchIcon} style={{ width: 14, height: 14 }} />
          <input
            type="text"
            className={s.searchInput}
            placeholder="Поиск по стране, странице..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Tabs */}
        <div className={s.tabs}>
          <button
            className={`${s.tab} ${filter === "all" ? s.tabActive : ""}`}
            onClick={() => setFilter("all")}
          >
            Все
          </button>
          <button
            className={`${s.tab} ${filter === "with_chat" ? s.tabActive : ""}`}
            onClick={() => setFilter("with_chat")}
          >
            С чатом
          </button>
          <button
            className={`${s.tab} ${filter === "without_chat" ? s.tabActive : ""}`}
            onClick={() => setFilter("without_chat")}
          >
            Без чата
          </button>
        </div>
      </div>

      {/* List */}
      <div className={`${s.list} scrollbar-thin`}>
        {filteredVisitors.length === 0 ? (
          <div className={s.emptyState}>
            <div className={s.emptyIcon}>
              <Eye style={{ width: 24, height: 24 }} />
            </div>
            <div className={s.emptyTitle}>Посетители не найдены</div>
            <div className={s.emptyDesc}>Никто на сайте не удовлетворяет условиям фильтра.</div>
          </div>
        ) : (
          filteredVisitors.map((v) => {
            const isCommercial = isCommercialPage(v.current_page || "");
            const isHigh = (v.score || 0) >= 70;
            const isMedium = (v.score || 0) >= 40 && (v.score || 0) < 70;

            return (
              <div
                key={v.visitor_id}
                className={`${s.card} ${selectedVisitorId === v.visitor_id ? s.cardActive : ""}`}
                onClick={() => setSelectedVisitorId(v.visitor_id)}
              >
                {/* Top Row: Avatar and ID */}
                <div className={s.cardTop}>
                  <div className={s.avatarArea}>
                    <div className={s.avatarWrapper}>
                      <div
                        className={s.avatar}
                        style={{ background: getAvatarGradient(v.visitor_id) }}
                      >
                        {v.visitor_id.slice(0, 2).toUpperCase()}
                      </div>
                      {v.is_online && <span className={s.statusDot} />}
                    </div>
                    <div className={s.visitorInfo}>
                      <span className={s.visitorId}>#{v.visitor_id.substring(0, 6)}</span>
                      <span className={s.location}>
                        {getCountryFlag(v.country)} {v.city || v.country || "Локация"}
                      </span>
                    </div>
                  </div>

                  {/* Lead Score */}
                  <Tooltip content="Балл ценности лида (Lead Score)" side="top">
                    <span
                      className={`${s.scoreBadge} ${
                        isHigh ? s.scoreHigh : isMedium ? s.scoreMedium : s.scoreLow
                      }`}
                    >
                      {v.score || 0} XP
                    </span>
                  </Tooltip>
                </div>

                {/* Bottom Row: Page and OS */}
                <div className={s.cardBottom}>
                  {v.current_page && (
                    <span
                      className={`${s.pageLink} ${isCommercial ? s.commercialPage : ""}`}
                      title={v.current_page_title || v.current_page}
                    >
                      <ExternalLink style={{ width: 10, height: 10, flexShrink: 0 }} />
                      {v.current_page_title || v.current_page}
                    </span>
                  )}

                  <div className={s.metaRow}>
                    <span className={s.deviceInfo}>
                      {v.os?.toLowerCase().includes("windows") || v.os?.toLowerCase().includes("mac") ? (
                        <Monitor style={{ width: 10, height: 10 }} />
                      ) : (
                        <Smartphone style={{ width: 10, height: 10 }} />
                      )}
                      {v.os || "OS"}
                    </span>
                    <span>{v.session_count || 1} визит</span>
                  </div>
                </div>

                {/* Action Buttons (Visible on Hover) */}
                <div className={s.actions}>
                  <Tooltip content="Путь по страницам (Таймлайн)" side="top">
                    <button
                      className={s.actionBtn}
                      onClick={() => setSelectedVisitorId(v.visitor_id)}
                      type="button"
                    >
                      <History style={{ width: 12, height: 12 }} />
                    </button>
                  </Tooltip>
                  <Tooltip content={v.has_chat ? "Открыть чат" : "Пригласить в чат"} side="top">
                    <button
                      className={s.actionBtn}
                      onClick={(e) => void handleStartChat(e, v)}
                      type="button"
                    >
                      <MessageSquare style={{ width: 12, height: 12 }} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Заблокировать по IP" side="top">
                    <button
                      className={`${s.actionBtn} s.actionBtnBan`}
                      onClick={(e) => void handleBan(e, v)}
                      type="button"
                    >
                      <Ban style={{ width: 12, height: 12 }} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Drawer */}
      <VisitorHistoryDrawer
        visitorId={selectedVisitorId}
        onClose={() => setSelectedVisitorId(null)}
      />
    </div>
  );
}
