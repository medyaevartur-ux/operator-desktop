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
  Send,
  Users,
} from "lucide-react";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import { getVisitors, getVisitorHistory, startChatWithVisitor } from "@/features/visitors/visitors.api";
import { sendInvitation, getInvitations, type ProactiveInvitation } from "@/features/inbox/inbox.api";
import { useAuthStore } from "@/store/auth.store";
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
  if (id.length <= 12) return id;
  return id.slice(0, 6) + "…" + id.slice(-4);
}

function getDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (target.getTime() === today.getTime()) return "Сегодня";
  if (target.getTime() === yesterday.getTime()) return "Вчера";

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function getDayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── group by day ── */
function groupByDay(visitors: SiteVisitor[]): { key: string; label: string; visitors: SiteVisitor[] }[] {
  const map = new Map<string, SiteVisitor[]>();
  for (const v of visitors) {
    const key = getDayKey(v.last_seen_at);
    const arr = map.get(key) ?? [];
    arr.push(v);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({
      key,
      label: getDayLabel(list[0].last_seen_at),
      visitors: list.sort(
        (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
      ),
    }));
}

/* ══ Main ══ */
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
      /* api not ready */
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

  /* ── split online / offline ── */
  const onlineVisitors = useMemo(
    () => visitors.filter((v) => v.is_online),
    [visitors]
  );

  const offlineVisitors = useMemo(
    () => visitors.filter((v) => !v.is_online),
    [visitors]
  );

  const offlineGrouped = useMemo(
    () => groupByDay(offlineVisitors),
    [offlineVisitors]
  );

  /* ── selected visitor ── */
  const selectedVisitor = useMemo(
    () => visitors.find((v) => v.visitor_id === selectedVisitorId) ?? null,
    [visitors, selectedVisitorId]
  );

  /* ── side panel history ── */
  const [history, setHistory] = useState<VisitorPageEvent[]>([]);
  const operator = useAuthStore((st) => st.operator);
  const [inviteModalVisitorId, setInviteModalVisitorId] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState("Здравствуйте! Могу я вам помочь?");
  const [inviteSending, setInviteSending] = useState(false);
  const [invitations, setInvitations] = useState<ProactiveInvitation[]>([]);

  useEffect(() => {
    getInvitations().then(setInvitations).catch(() => {});
    const t = setInterval(() => {
      getInvitations().then(setInvitations).catch(() => {});
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  const handleSendInvite = async () => {
    if (!inviteModalVisitorId || !operator?.id || inviteSending) return;
    setInviteSending(true);
    try {
      const res = await sendInvitation({
        visitorId: inviteModalVisitorId,
        operatorId: operator.id,
        message: inviteMessage.trim() || undefined,
      });
      if (res.ok) {
        setInviteModalVisitorId(null);
        setInviteMessage("Здравствуйте! Могу я вам помочь?");
        getInvitations().then(setInvitations).catch(() => {});
      }
    } finally {
      setInviteSending(false);
    }
  };

  const getInvitationStatus = (visitorId: string): ProactiveInvitation | null => {
    return invitations.find((inv) => inv.visitor_id === visitorId && inv.status === "sent") || null;
  };

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
            {onlineCount} онлайн · {visitors.length} всего
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
        {isLoading && visitors.length === 0 ? (
          <div className={s.loading}>Загрузка посетителей…</div>
        ) : visitors.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>
              <UserX style={{ width: 24, height: 24 }} />
            </div>
            <div className={s.emptyText}>Нет посетителей</div>
          </div>
        ) : (
          <div className={s.mainArea}>
            {/* ── Online section ── */}
            <div className={s.onlineSection}>
              <div className={s.sectionHeader}>
                <span className={s.sectionDot} />
                <span className={s.sectionTitle}>Сейчас на сайте</span>
                <span className={s.sectionCount}>{onlineVisitors.length}</span>
              </div>

              {onlineVisitors.length === 0 ? (
                <div className={s.noOnline}>
                  <div className={s.noOnlineIcon}>
                    <Users style={{ width: 22, height: 22 }} />
                  </div>
                  <div className={s.noOnlineText}>Нет онлайн-посетителей</div>
                  <div className={s.noOnlineSub}>Когда кто-то зайдёт на сайт, он появится здесь</div>
                </div>
              ) : (
                <div className={s.onlineGrid}>
                  {onlineVisitors.map((v) => (
                    <OnlineCard
                      key={v.visitor_id}
                      visitor={v}
                      isSelected={v.visitor_id === selectedVisitorId}
                      onSelect={() =>
                        setSelectedVisitorId(
                          v.visitor_id === selectedVisitorId ? null : v.visitor_id
                        )
                      }
                      onStartChat={() => handleStartChat(v.visitor_id)}
                      onInvite={() => setInviteModalVisitorId(v.visitor_id)}
                      invitationStatus={getInvitationStatus(v.visitor_id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── History section ── */}
            {offlineGrouped.length > 0 && (
              <div className={s.historySection}>
                <div className={s.sectionHeader}>
                  <span className={s.sectionTitle}>История посещений</span>
                </div>

                {offlineGrouped.map((group) => (
                  <div key={group.key}>
                    <div className={s.dayHeader}>
                      <span className={s.dayLabel}>{group.label}</span>
                      <span className={s.dayLine} />
                      <span className={s.dayCount}>{group.visitors.length}</span>
                    </div>

                    {group.visitors.map((v) => (
                      <HistoryRow
                        key={v.visitor_id}
                        visitor={v}
                        isSelected={v.visitor_id === selectedVisitorId}
                        onSelect={() =>
                          setSelectedVisitorId(
                            v.visitor_id === selectedVisitorId ? null : v.visitor_id
                          )
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Side panel ── */}
        {selectedVisitor && (
          <aside className={s.sidePanel}>
            <div className={s.sidePanelHeader}>
              <div className={s.sidePanelVisitor}>
                <div className={s.sidePanelAvatar}>
                  {selectedVisitor.visitor_id.slice(0, 2).toUpperCase()}
                  <div
                    className={s.sidePanelOnlineDot}
                    style={{
                      background: selectedVisitor.is_online
                        ? "var(--status-online)"
                        : "var(--text-disabled)",
                    }}
                  />
                </div>
                <div>
                  <div className={s.sidePanelTitle}>
                    {shortVisitorId(selectedVisitor.visitor_id)}
                  </div>
                  <div
                    className={s.sidePanelStatus}
                    style={{
                      color: selectedVisitor.is_online
                        ? "var(--status-online)"
                        : "var(--text-disabled)",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: selectedVisitor.is_online
                          ? "var(--status-online)"
                          : "var(--text-disabled)",
                      }}
                    />
                    {selectedVisitor.is_online ? "Онлайн" : "Офлайн"}
                  </div>
                </div>
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
              {/* Actions */}
              {!selectedVisitor.has_chat && selectedVisitor.is_online && (
                <div className={s.sidePanelActions}>
                  <button
                    type="button"
                    className={`${s.sidePanelActionBtn} ${s.sidePanelActionPrimary}`}
                    onClick={() => handleStartChat(selectedVisitor.visitor_id)}
                  >
                    <MessageSquarePlus style={{ width: 14, height: 14 }} />
                    Начать чат
                  </button>
                  {!getInvitationStatus(selectedVisitor.visitor_id) && (
                    <button
                      type="button"
                      className={`${s.sidePanelActionBtn} ${s.sidePanelActionSecondary}`}
                      onClick={() => setInviteModalVisitorId(selectedVisitor.visitor_id)}
                    >
                      <Send style={{ width: 14, height: 14 }} />
                      Пригласить
                    </button>
                  )}
                </div>
              )}

              {/* Info */}
              <div className={s.infoGroup}>
                <div className={s.infoGroupTitle}>Информация</div>
                <InfoRow label="Visitor ID" value={selectedVisitor.visitor_id} />
                <InfoRow label="Визитов" value={String(selectedVisitor.session_count)} />
                <InfoRow label="На сайте" value={duration(selectedVisitor.first_seen_at, selectedVisitor.last_seen_at)} />
                <InfoRow label="Первый визит" value={new Date(selectedVisitor.first_seen_at).toLocaleString()} />
                <InfoRow label="Последняя активность" value={timeAgo(selectedVisitor.last_seen_at)} />
              </div>

              <div className={s.infoGroup}>
                <div className={s.infoGroupTitle}>Устройство</div>
                <InfoRow label="Браузер" value={selectedVisitor.browser ?? "—"} />
                <InfoRow label="ОС" value={selectedVisitor.os ?? "—"} />
                <InfoRow label="Referrer" value={selectedVisitor.referrer || "Прямой заход"} />
              </div>

              <div className={s.infoGroup}>
                <div className={s.infoGroupTitle}>Локация</div>
                <InfoRow label="Город" value={selectedVisitor.city ?? "—"} />
                <InfoRow label="Страна" value={selectedVisitor.country ?? "—"} />
              </div>

              {/* Page history */}
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

      {/* ── Invite modal ── */}
      {inviteModalVisitorId && (
        <div className={s.modalOverlay} onClick={() => setInviteModalVisitorId(null)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <div className={s.modalTitle}>Пригласить в чат</div>
              <button
                type="button"
                className={s.sidePanelClose}
                onClick={() => setInviteModalVisitorId(null)}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div className={s.modalBody}>
              <div className={s.modalLabel}>Посетитель</div>
              <div className={s.modalVisitorId}>{inviteModalVisitorId}</div>
              <div className={s.modalLabel} style={{ marginTop: 12 }}>Сообщение</div>
              <textarea
                className={s.modalTextarea}
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                rows={3}
                placeholder="Текст приглашения..."
              />
            </div>
            <div className={s.modalFooter}>
              <button
                type="button"
                className={s.modalCancelBtn}
                onClick={() => setInviteModalVisitorId(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className={s.modalSendBtn}
                onClick={handleSendInvite}
                disabled={inviteSending}
              >
                <Send style={{ width: 14, height: 14 }} />
                {inviteSending ? "Отправка..." : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══ OnlineCard ══ */
interface OnlineCardProps {
  visitor: SiteVisitor;
  isSelected: boolean;
  onSelect: () => void;
  onStartChat: () => void;
  onInvite: () => void;
  invitationStatus: ProactiveInvitation | null;
}

function OnlineCard({
  visitor,
  isSelected,
  onSelect,
  onStartChat,
  onInvite,
  invitationStatus,
}: OnlineCardProps) {
  return (
    <div
      className={`${s.onlineCard} ${isSelected ? s.onlineCardSelected : ""}`}
      onClick={onSelect}
    >
      <div className={s.cardAvatarWrap}>
        <div className={s.cardAvatar}>
          {visitor.visitor_id.slice(0, 2).toUpperCase()}
        </div>
        <div className={s.cardOnlineDot} />
      </div>

      <div className={s.cardInfo}>
        <div className={s.cardTopRow}>
          <span className={s.cardVisitorId}>{shortVisitorId(visitor.visitor_id)}</span>
          <span className={s.cardTime}>
            <Clock style={{ width: 11, height: 11 }} />
            {duration(visitor.first_seen_at, visitor.last_seen_at)}
          </span>
        </div>

        <div className={s.cardPage}>{visitor.current_page_title || "—"}</div>
        <div className={s.cardUrl}>{visitor.current_page || "—"}</div>

        <div className={s.cardMeta}>
          {visitor.city && (
            <span className={s.cardMetaItem}>
              <Globe style={{ width: 11, height: 11 }} />
              {visitor.city}{visitor.country ? `, ${visitor.country}` : ""}
            </span>
          )}
          <span className={s.cardMetaItem}>
            <Monitor style={{ width: 11, height: 11 }} />
            {visitor.browser ?? "?"} / {visitor.os ?? "?"}
          </span>
          <span className={`${s.chatBadge} ${visitor.has_chat ? s.chatBadgeYes : s.chatBadgeNo}`}>
            {visitor.has_chat ? "Чат" : "Нет чата"}
          </span>
          {invitationStatus && <span className={s.inviteSentBadge}>Приглашение отправлено</span>}
        </div>
      </div>

      <div className={s.cardActions}>
        {!visitor.has_chat && (
          <button
            type="button"
            className={`${s.cardActionBtn} ${s.cardActionPrimary}`}
            title="Начать чат"
            onClick={(e) => {
              e.stopPropagation();
              onStartChat();
            }}
          >
            <MessageSquarePlus style={{ width: 14, height: 14 }} />
          </button>
        )}
        {!visitor.has_chat && !invitationStatus && (
          <button
            type="button"
            className={`${s.cardActionBtn} ${s.cardActionSecondary}`}
            title="Пригласить в чат"
            onClick={(e) => {
              e.stopPropagation();
              onInvite();
            }}
          >
            <Send style={{ width: 14, height: 14 }} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ══ HistoryRow ══ */
interface HistoryRowProps {
  visitor: SiteVisitor;
  isSelected: boolean;
  onSelect: () => void;
}

function HistoryRow({ visitor, isSelected, onSelect }: HistoryRowProps) {
  return (
    <div
      className={`${s.histRow} ${isSelected ? s.histRowSelected : ""}`}
      onClick={onSelect}
    >
      <div className={s.histAvatar}>
        {visitor.visitor_id.slice(0, 2).toUpperCase()}
      </div>

      <div className={s.histInfo}>
        <div className={s.histNameRow}>
          <span className={s.histName}>{shortVisitorId(visitor.visitor_id)}</span>
          <span className={`${s.chatBadge} ${visitor.has_chat ? s.chatBadgeYes : s.chatBadgeNo}`}>
            {visitor.has_chat ? "Чат" : "Нет"}
          </span>
        </div>
        <div className={s.histPage}>{visitor.current_page_title || visitor.current_page || "—"}</div>
      </div>

      <div className={s.histMeta}>
        <span className={s.histMetaItem}>
          <Monitor style={{ width: 11, height: 11 }} />
          {visitor.browser ?? "?"} / {visitor.os ?? "?"}
        </span>
        <span className={s.histMetaItem}>
          <Clock style={{ width: 11, height: 11 }} />
          {duration(visitor.first_seen_at, visitor.last_seen_at)}
        </span>
        <span className={s.histMetaItem}>
          {timeAgo(visitor.last_seen_at)}
        </span>
      </div>
    </div>
  );
}

/* ══ InfoRow ══ */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.infoRow}>
      <span className={s.infoLabel}>{label}</span>
      <span className={s.infoValue}>{value}</span>
    </div>
  );
}