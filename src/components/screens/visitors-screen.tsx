import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Eye,
  Search,
  X,
  MessageSquarePlus,
  Globe,
  Monitor,
  Clock,
  UserX,
} from "lucide-react";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import { getVisitors, getVisitorHistory, startChatWithVisitor } from "@/features/visitors/visitors.api";
import { useVisitorsRealtime } from "@/features/visitors/use-visitors-realtime";
import type { SiteVisitor, VisitorPageEvent } from "@/types/visitor";
import s from "./VisitorsScreen.module.css";

/* ── helpers ── */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} д`;
}

function duration(first: string, last: string): string {
  const diff = new Date(last).getTime() - new Date(first).getTime();
  const min = Math.max(0, Math.floor(diff / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}ч ${m}м`;
}

function shortVisitorId(id: string): string {
  if (id.length <= 10) return id;
  return id.slice(0, 4) + "…" + id.slice(-4);
}

/* ── Main ── */
export function VisitorsScreen() {
  useVisitorsRealtime();

  const {
    visitors,
    setVisitors,
    filter,
    setFilter,
    countryFilter,
    setCountryFilter,
    search,
    setSearch,
    selectedVisitorId,
    setSelectedVisitorId,
    isLoading,
    setLoading,
    onlineCount,
  } = useVisitorsStore();

  const setScreen = useNavigationStore((st) => st.setScreen);
  const setActiveSession = useInboxStore((st) => st.setActiveSession);
  const sessions = useInboxStore((st) => st.sessions);

  /* ── fetch ── */
  const fetchVisitors = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (filter === "with_chat") params.has_chat = true;
      if (filter === "without_chat") params.has_chat = false;
      if (countryFilter) params.country = countryFilter;
      if (search) params.search = search;
      const data = await getVisitors(params);
      setVisitors(data);
    } catch {
      /* api not ready — ok */
    } finally {
      setLoading(false);
    }
  }, [filter, countryFilter, search, setVisitors, setLoading]);

  useEffect(() => {
    fetchVisitors();
    const interval = setInterval(fetchVisitors, 30_000);
    return () => clearInterval(interval);
  }, [fetchVisitors]);

  /* ── debounce search ── */
  const [localSearch, setLocalSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setSearch(localSearch), 300);
    return () => clearTimeout(t);
  }, [localSearch, setSearch]);

  /* ── countries ── */
  const countries = useMemo(() => {
    const set = new Set<string>();
    visitors.forEach((v) => v.country && set.add(v.country));
    return Array.from(set).sort();
  }, [visitors]);

  /* ── filtered ── */
  const filtered = useMemo(() => {
    return visitors; // backend already filters, this is a fallback
  }, [visitors]);

  /* ── selected visitor ── */
  const selectedVisitor = useMemo(
    () => filtered.find((v) => v.visitor_id === selectedVisitorId) ?? null,
    [filtered, selectedVisitorId]
  );

  /* ── side panel history ── */
  const [history, setHistory] = useState<VisitorPageEvent[]>([]);
  useEffect(() => {
    if (!selectedVisitorId) {
      setHistory([]);
      return;
    }
    getVisitorHistory(selectedVisitorId).then(setHistory).catch(() => setHistory([]));
  }, [selectedVisitorId]);

  /* ── start chat ── */
  const handleStartChat = async (visitorId: string) => {
    try {
      const { session_id } = await startChatWithVisitor(visitorId);
      setScreen("inbox");
      const session = sessions.find((ses) => ses.id === session_id) ?? null;
      if (session) setActiveSession(session);
    } catch {
      /* */
    }
  };

  return (
    <div className={s.container}>
      {/* ── Header ── */}
      <div className={s.header}>
        <div className={s.headerIcon}>
          <Eye style={{ width: 20, height: 20 }} />
        </div>
        <div>
          <div className={s.headerTitle}>Посетители</div>
          <div className={s.headerCount}>
            <span className={s.onlineDot} />
            {onlineCount} онлайн
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className={s.toolbar}>
        <div className={s.searchWrap}>
          <Search className={s.searchIcon} style={{ width: 16, height: 16 }} />
          <input
            className={s.searchInput}
            placeholder="Поиск по visitor_id…"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
          />
        </div>

        <div className={s.filterGroup}>
          {(["all", "with_chat", "without_chat"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`${s.filterBtn} ${filter === f ? s.filterBtnActive : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Все" : f === "with_chat" ? "С чатом" : "Без чата"}
            </button>
          ))}
        </div>

        {countries.length > 0 && (
          <select
            className={s.countrySelect}
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
          >
            <option value="">Все страны</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Content ── */}
      <div className={s.content}>
        {isLoading && filtered.length === 0 ? (
          <div className={s.loading}>Загрузка посетителей…</div>
        ) : filtered.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>
              <UserX style={{ width: 24, height: 24 }} />
            </div>
            <div className={s.emptyText}>Нет онлайн-посетителей</div>
          </div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Посетитель</th>
                  <th>Страница</th>
                  <th>Гео</th>
                  <th>Браузер / ОС</th>
                  <th>На сайте</th>
                  <th>Чат</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <VisitorRow
                    key={v.visitor_id}
                    visitor={v}
                    isSelected={v.visitor_id === selectedVisitorId}
                    onSelect={() =>
                      setSelectedVisitorId(
                        v.visitor_id === selectedVisitorId ? null : v.visitor_id
                      )
                    }
                    onStartChat={() => handleStartChat(v.visitor_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Side panel ── */}
        {selectedVisitor && (
          <aside className={s.sidePanel}>
            <div className={s.sidePanelHeader}>
              <div className={s.sidePanelTitle}>
                {shortVisitorId(selectedVisitor.visitor_id)}
              </div>
              <button
                type="button"
                className={s.sidePanelClose}
                onClick={() => setSelectedVisitorId(null)}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div className={s.sidePanelBody}>
              <InfoRow label="Visitor ID" value={selectedVisitor.visitor_id} />
              <InfoRow label="Визитов" value={String(selectedVisitor.session_count)} />
              <InfoRow label="Город" value={selectedVisitor.city ?? "—"} />
              <InfoRow label="Страна" value={selectedVisitor.country ?? "—"} />
              <InfoRow label="Браузер" value={selectedVisitor.browser ?? "—"} />
              <InfoRow label="ОС" value={selectedVisitor.os ?? "—"} />
              <InfoRow label="Referrer" value={selectedVisitor.referrer || "—"} />
              <InfoRow label="Первый визит" value={new Date(selectedVisitor.first_seen_at).toLocaleString()} />
              <InfoRow label="Последний" value={timeAgo(selectedVisitor.last_seen_at)} />

              <div className={s.historyTitle}>История страниц</div>
              {history.length === 0 ? (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-disabled)" }}>
                  Нет данных
                </div>
              ) : (
                history.map((h, i) => (
                  <div key={i} className={s.historyItem}>
                    <div className={s.historyPage}>{h.title || h.page}</div>
                    <div className={s.historyTime}>
                      {new Date(h.visited_at).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ── VisitorRow ── */
interface VisitorRowProps {
  visitor: SiteVisitor;
  isSelected: boolean;
  onSelect: () => void;
  onStartChat: () => void;
}

function VisitorRow({ visitor, isSelected, onSelect, onStartChat }: VisitorRowProps) {
  return (
    <tr
      className={`${s.row} ${isSelected ? s.rowSelected : ""}`}
      onClick={onSelect}
    >
      <td>
        <div className={s.visitorCell}>
          <div className={s.visitorAvatar}>
            {visitor.visitor_id.slice(0, 2).toUpperCase()}
          </div>
          <span className={s.visitorName}>{shortVisitorId(visitor.visitor_id)}</span>
        </div>
      </td>
      <td>
        <div className={s.pageCell}>
          <span className={s.pageTitle}>{visitor.current_page_title || "—"}</span>
          <span className={s.pageUrl}>{visitor.current_page || "—"}</span>
        </div>
      </td>
      <td>
        <div className={s.geoCell}>
          <Globe style={{ width: 14, height: 14, flexShrink: 0, color: "var(--text-disabled)" }} />
          {visitor.city ? `${visitor.city}, ${visitor.country ?? ""}` : visitor.country ?? "—"}
        </div>
      </td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Monitor style={{ width: 14, height: 14, color: "var(--text-disabled)" }} />
          {visitor.browser ?? "—"} / {visitor.os ?? "—"}
        </div>
      </td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Clock style={{ width: 14, height: 14, color: "var(--text-disabled)" }} />
          {duration(visitor.first_seen_at, visitor.last_seen_at)}
        </div>
      </td>
      <td>
        <span className={`${s.chatBadge} ${visitor.has_chat ? s.chatBadgeYes : s.chatBadgeNo}`}>
          {visitor.has_chat ? "Есть" : "Нет"}
        </span>
      </td>
      <td>
        {!visitor.has_chat && (
          <button
            type="button"
            className={s.startChatBtn}
            onClick={(e) => {
              e.stopPropagation();
              onStartChat();
            }}
          >
            <MessageSquarePlus style={{ width: 14, height: 14 }} />
          </button>
        )}
      </td>
    </tr>
  );
}

/* ── InfoRow ── */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.infoRow}>
      <span className={s.infoLabel}>{label}</span>
      <span className={s.infoValue}>{value}</span>
    </div>
  );
}