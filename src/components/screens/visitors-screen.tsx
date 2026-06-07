import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Route,
  Calendar,
} from "lucide-react";
import { useVisitorsStore } from "@/store/visitors.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import {
  getVisitors,
  getVisitorsPage,
  startChatWithVisitor,
} from "@/features/visitors/visitors.api";
import { friendlyIdentity } from "@/features/visitors/friendly-name";
import { VisitorJourney } from "@/features/visitors/visitor-journey";
import { sendInvitation, getInvitations, type ProactiveInvitation } from "@/features/inbox/inbox.api";
import { useAuthStore } from "@/store/auth.store";
import { useVisitorsRealtime } from "@/features/visitors/use-visitors-realtime";
import type { SiteVisitor } from "@/types/visitor";
import { VisitorsStats } from "./visitors-stats";
import s from "./VisitorsScreen.module.css";

const HISTORY_PAGE_SIZE = 10;

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

function refHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Источник трафика: UTM-метка > домен реферера > прямой переход. */
function formatSource(v: SiteVisitor): string {
  if (v.utm_source) {
    return v.utm_medium ? `${v.utm_source} · ${v.utm_medium}` : v.utm_source;
  }
  if (v.referrer && v.referrer.trim()) return refHost(v.referrer);
  return "Прямой переход";
}

/** Новый посетитель или вернувшийся (по числу визитов). */
function visitorKind(v: SiteVisitor): string {
  return (v.session_count ?? 1) > 1 ? `Вернулся · ${v.session_count}` : "Новый";
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

function getHourKey(dateStr: string): string {
  const d = new Date(dateStr);
  return String(d.getHours()).padStart(2, "0");
}

function getHourLabel(hourKey: string): string {
  return `${hourKey}:00`;
}

interface HourGroup {
  key: string;
  label: string;
  visitors: SiteVisitor[];
}

interface DayGroup {
  key: string;
  label: string;
  count: number;
  hours: HourGroup[];
}

/* ── group by day → hour (двухуровневая, БЕЗ пересортировки внутри: порядок от сервера) ── */
function groupByDayHour(visitors: SiteVisitor[]): DayGroup[] {
  const dayMap = new Map<string, Map<string, SiteVisitor[]>>();
  const dayOrder: string[] = [];

  for (const v of visitors) {
    const dayKey = getDayKey(v.last_seen_at);
    const hourKey = getHourKey(v.last_seen_at);
    let hourMap = dayMap.get(dayKey);
    if (!hourMap) {
      hourMap = new Map<string, SiteVisitor[]>();
      dayMap.set(dayKey, hourMap);
      dayOrder.push(dayKey);
    }
    const arr = hourMap.get(hourKey) ?? [];
    arr.push(v);
    hourMap.set(hourKey, arr);
  }

  return dayOrder.map((dayKey) => {
    const hourMap = dayMap.get(dayKey)!;
    let count = 0;
    // Часы — по убыванию (более поздние сверху), но визиторов внутри часа
    // НЕ пересортировываем, доверяем серверу.
    const hours: HourGroup[] = Array.from(hourMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([hourKey, list]) => {
        count += list.length;
        return { key: hourKey, label: getHourLabel(hourKey), visitors: list };
      });
    const sample = hourMap.values().next().value as SiteVisitor[] | undefined;
    return {
      key: dayKey,
      label: sample ? getDayLabel(sample[0].last_seen_at) : dayKey,
      count,
      hours,
    };
  });
}

/* ══ Main ══ */
export function VisitorsScreen() {
  useVisitorsRealtime();
  const [activeTab, setActiveTab] = useState<"live" | "stats">("live");

  const {
    visitors,
    setVisitors,
    historyVisitors,
    setHistoryVisitors,
    appendVisitors,
    resetHistory,
    hasMore,
    setHasMore,
    isLoadingMore,
    setLoadingMore,
    historyDate,
    setHistoryDate,
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

  /* ── common filter params (без offset/limit) ── */
  const baseParams = useCallback(() => {
    const params: Record<string, any> = {};
    if (filter === "with_chat") params.has_chat = true;
    if (filter === "without_chat") params.has_chat = false;
    if (countryFilter) params.country = countryFilter;
    if (search) params.search = search;
    if (historyDate) params.date = historyDate;
    return params;
  }, [filter, countryFilter, search, historyDate]);

  /* ── online poller (только живой блок, историю НЕ трогает) ── */
  const fetchOnline = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (filter === "with_chat") params.has_chat = true;
      if (filter === "without_chat") params.has_chat = false;
      if (countryFilter) params.country = countryFilter;
      if (search) params.search = search;
      const data = await getVisitors(params);
      setVisitors(data);
    } catch (err) {
      // Тихо логируем: это фоновый поллер (раз в 30с), toast здесь спамил бы оператора.
      console.warn("[visitors] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, countryFilter, search, setVisitors, setLoading]);

  useEffect(() => {
    fetchOnline();
    const interval = setInterval(fetchOnline, 30_000);
    return () => clearInterval(interval);
  }, [fetchOnline]);

  /* ── history: первая страница (при смене фильтров/дня) ── */
  const fetchHistoryFirstPage = useCallback(async () => {
    setLoadingMore(true);
    try {
      const { items, has_more } = await getVisitorsPage({
        ...baseParams(),
        limit: HISTORY_PAGE_SIZE,
        offset: 0,
      });
      setHistoryVisitors(items);
      setHasMore(has_more);
    } catch (err) {
      console.warn("[visitors] history fetch failed:", err);
      setHistoryVisitors([]);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [baseParams, setHistoryVisitors, setHasMore, setLoadingMore]);

  useEffect(() => {
    resetHistory();
    fetchHistoryFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, countryFilter, search, historyDate]);

  /* ── history: догрузка по 10 (infinite scroll) ── */
  const loadMore = useCallback(async () => {
    const st = useVisitorsStore.getState();
    if (st.isLoadingMore || !st.hasMore) return;
    setLoadingMore(true);
    try {
      const { items, has_more } = await getVisitorsPage({
        ...baseParams(),
        limit: HISTORY_PAGE_SIZE,
        offset: st.historyOffset,
      });
      appendVisitors(items);
      setHasMore(has_more && items.length > 0);
    } catch (err) {
      console.warn("[visitors] loadMore failed:", err);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [baseParams, appendVisitors, setHasMore, setLoadingMore]);

  /* ── IntersectionObserver-сентинел ── */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

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

  /* ── online (живой блок) ── */
  const onlineVisitors = useMemo(
    () => visitors.filter((v) => v.is_online),
    [visitors]
  );

  const onlineIds = useMemo(
    () => new Set(onlineVisitors.map((v) => v.visitor_id)),
    [onlineVisitors]
  );

  /* ── история (пагинируемая, исключаем тех, кто уже онлайн сверху) ── */
  const offlineVisitors = useMemo(
    () => historyVisitors.filter((v) => !v.is_online && !onlineIds.has(v.visitor_id)),
    [historyVisitors, onlineIds]
  );

  const offlineGrouped = useMemo(
    () => groupByDayHour(offlineVisitors),
    [offlineVisitors]
  );

  /* ── selected visitor (из любого блока) ── */
  const selectedVisitor = useMemo(
    () =>
      visitors.find((v) => v.visitor_id === selectedVisitorId) ??
      historyVisitors.find((v) => v.visitor_id === selectedVisitorId) ??
      null,
    [visitors, historyVisitors, selectedVisitorId]
  );

  /* ── side panel ── */
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
            {onlineCount} онлайн · {visitors.length} в списке
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={s.tabsRow}>
        <button
          type="button"
          className={`${s.tabBtn} ${activeTab === "live" ? s.tabBtnActive : ""}`}
          onClick={() => setActiveTab("live")}
        >
          <span className={s.tabIcon}>🟢</span>
          Мониторинг ({onlineCount})
        </button>
        <button
          type="button"
          className={`${s.tabBtn} ${activeTab === "stats" ? s.tabBtnActive : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          <span className={s.tabIcon}>📊</span>
          Аналитика
        </button>
      </div>

      {activeTab === "stats" ? (
        <div className={s.mainArea} style={{ overflowY: "auto", flex: 1, padding: "var(--space-4) var(--space-6)" }}>
          <VisitorsStats visitors={visitors} onlineCount={onlineCount} />
        </div>
      ) : (
        <>
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

            {/* ── Календарь: фильтр истории по дню ── */}
            <div className={s.datePickerWrap}>
              <Calendar className={s.datePickerIcon} style={{ width: 14, height: 14 }} />
              <input
                type="date"
                className={s.datePicker}
                value={historyDate ?? ""}
                max={getDayKey(new Date().toISOString())}
                onChange={(e) => setHistoryDate(e.target.value || null)}
                title="История за выбранный день"
              />
              {historyDate && (
                <button
                  type="button"
                  className={s.datePickerClear}
                  onClick={() => setHistoryDate(null)}
                  title="Сбросить день"
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>
          </div>

          {/* ── Content ── */}
          <div className={s.content}>
            {isLoading && visitors.length === 0 && historyVisitors.length === 0 ? (
              <div className={s.loading}>Загрузка посетителей…</div>
            ) : visitors.length === 0 && offlineVisitors.length === 0 ? (
              <div className={s.empty}>
                <div className={s.emptyIcon}>
                  <UserX style={{ width: 24, height: 24 }} />
                </div>
                <div className={s.emptyText}>
                  {historyDate ? "Нет посещений за этот день" : "Нет посетителей"}
                </div>
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

                {/* ── History section (день → час, инфинит-скролл) ── */}
                {(offlineGrouped.length > 0 || isLoadingMore) && (
                  <div className={s.historySection}>
                    <div className={s.sectionHeader}>
                      <span className={s.sectionTitle}>История посещений</span>
                      {historyDate && (
                        <span className={s.sectionCount}>
                          {getDayLabel(new Date(historyDate).toISOString())}
                        </span>
                      )}
                    </div>

                    {offlineGrouped.map((group) => (
                      <div key={group.key}>
                        <div className={s.dayHeader}>
                          <span className={s.dayLabel}>{group.label}</span>
                          <span className={s.dayLine} />
                          <span className={s.dayCount}>{group.count}</span>
                        </div>

                        {group.hours.map((hour) => (
                          <div key={`${group.key}-${hour.key}`} className={s.hourGroup}>
                            <div className={s.hourHeader}>{hour.label}</div>
                            {hour.visitors.map((v) => (
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
                    ))}

                    {/* IntersectionObserver-сентинел */}
                    <div ref={sentinelRef} className={s.sentinel}>
                      {isLoadingMore
                        ? "Загрузка…"
                        : hasMore
                          ? ""
                          : offlineGrouped.length > 0
                            ? "Это всё"
                            : ""}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Side panel ── */}
            {selectedVisitor && (
              <aside className={s.sidePanel}>
                <div className={s.sidePanelHeader}>
                  <div className={s.sidePanelVisitor}>
                    <div
                      className={s.sidePanelAvatar}
                      style={{
                        background: friendlyIdentity(selectedVisitor.visitor_id).avatarBg,
                        color: friendlyIdentity(selectedVisitor.visitor_id).avatarFg,
                      }}
                    >
                      {friendlyIdentity(selectedVisitor.visitor_id).initials}
                      <div
                        className={s.sidePanelOnlineDot}
                        style={{
                          background: selectedVisitor.is_online
                            ? "var(--status-online)"
                            : "var(--text-disabled)",
                        }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className={s.sidePanelTitle}>
                        {friendlyIdentity(selectedVisitor.visitor_id).name}
                      </div>
                      <div className={s.sidePanelIdSub} title={selectedVisitor.visitor_id}>
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
                    <InfoRow label="Тип" value={visitorKind(selectedVisitor)} />
                    <InfoRow label="Визитов" value={String(selectedVisitor.session_count)} />
                    <InfoRow label="Первый визит" value={new Date(selectedVisitor.first_seen_at).toLocaleString()} />
                    <InfoRow label="Последняя активность" value={timeAgo(selectedVisitor.last_seen_at)} />
                  </div>

                  <div className={s.infoGroup}>
                    <div className={s.infoGroupTitle}>Источник трафика</div>
                    <InfoRow label="Источник" value={formatSource(selectedVisitor)} />
                    {selectedVisitor.utm_campaign && (
                      <InfoRow label="Кампания" value={selectedVisitor.utm_campaign} />
                    )}
                    <InfoRow label="Referrer" value={selectedVisitor.referrer ? refHost(selectedVisitor.referrer) : "Прямой заход"} />
                  </div>

                  <div className={s.infoGroup}>
                    <div className={s.infoGroupTitle}>Устройство</div>
                    <InfoRow label="Браузер" value={selectedVisitor.browser ?? "—"} />
                    <InfoRow label="ОС" value={selectedVisitor.os ?? "—"} />
                  </div>

                  <div className={s.infoGroup}>
                    <div className={s.infoGroupTitle}>Локация</div>
                    <InfoRow label="Город" value={selectedVisitor.city ?? "—"} />
                    <InfoRow label="Страна" value={selectedVisitor.country ?? "—"} />
                  </div>

                  {/* Карта пути */}
                  <div className={s.historyTitle}>Карта пути</div>
                  <VisitorJourney
                    key={selectedVisitor.visitor_id}
                    visitor={selectedVisitor}
                  />
                </div>
              </aside>
            )}
          </div>
        </>
      )}

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
              <div className={s.modalVisitorName}>{friendlyIdentity(inviteModalVisitorId).name}</div>
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
  const identity = friendlyIdentity(visitor.visitor_id);
  return (
    <div
      className={`${s.onlineCard} ${isSelected ? s.onlineCardSelected : ""}`}
      onClick={onSelect}
    >
      <div className={s.cardAvatarWrap}>
        <div
          className={s.cardAvatar}
          style={{ background: identity.avatarBg, color: identity.avatarFg }}
        >
          {identity.initials}
        </div>
        <div className={s.cardOnlineDot} />
      </div>

      <div className={s.cardInfo}>
        <div className={s.cardTopRow}>
          <span className={s.cardVisitorId}>{identity.name}</span>
          <span className={s.cardTime} title="Последняя активность">
            <Clock style={{ width: 11, height: 11 }} />
            {timeAgo(visitor.last_seen_at)}
          </span>
        </div>
        <div className={s.cardIdSub} title={visitor.visitor_id}>
          {shortVisitorId(visitor.visitor_id)}
        </div>

        <div className={s.cardPage}>{visitor.current_page_title || "—"}</div>
        <div className={s.cardUrl}>{visitor.current_page || "—"}</div>

        <div className={s.cardMeta}>
          <span className={s.cardMetaItem} title={visitor.referrer || undefined}>
            <Route style={{ width: 11, height: 11 }} />
            {formatSource(visitor)}
          </span>
          <span className={s.cardMetaItem}>{visitorKind(visitor)}</span>
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
  const identity = friendlyIdentity(visitor.visitor_id);
  return (
    <div
      className={`${s.histRow} ${isSelected ? s.histRowSelected : ""}`}
      onClick={onSelect}
    >
      <div
        className={s.histAvatar}
        style={{ background: identity.avatarBg, color: identity.avatarFg }}
      >
        {identity.initials}
      </div>

      <div className={s.histInfo}>
        <div className={s.histNameRow}>
          <span className={s.histName}>{identity.name}</span>
          <span className={s.histIdSub} title={visitor.visitor_id}>
            {shortVisitorId(visitor.visitor_id)}
          </span>
          <span className={`${s.chatBadge} ${visitor.has_chat ? s.chatBadgeYes : s.chatBadgeNo}`}>
            {visitor.has_chat ? "Чат" : "Нет"}
          </span>
        </div>
        <div className={s.histPage}>{visitor.current_page_title || visitor.current_page || "—"}</div>
      </div>

      <div className={s.histMeta}>
        <span className={s.histMetaItem} title={visitor.referrer || undefined}>
          <Route style={{ width: 11, height: 11 }} />
          {formatSource(visitor)}
        </span>
        <span className={s.histMetaItem}>
          <Monitor style={{ width: 11, height: 11 }} />
          {visitor.browser ?? "?"} / {visitor.os ?? "?"}
        </span>
        <span className={s.histMetaItem} title="Последняя активность">
          <Clock style={{ width: 11, height: 11 }} />
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