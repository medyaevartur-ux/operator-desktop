import { create } from "zustand";
import type { SiteVisitor, VisitorPathStep } from "@/types/visitor";

type VisitorFilter = "all" | "with_chat" | "without_chat";

export function calculateLeadScore(visitor: SiteVisitor): number {
  let score = 0;
  // 1. Количество сессий / визитов
  score += (visitor.session_count || 1) * 10;

  // 2. VIP статус
  if (visitor.is_vip === true) {
    score += 40;
  }

  // 3. Время на сайте (разница между last_seen_at и first_seen_at)
  if (visitor.first_seen_at && visitor.last_seen_at) {
    const timeOnSite = (new Date(visitor.last_seen_at).getTime() - new Date(visitor.first_seen_at).getTime()) / 1000;
    if (timeOnSite > 300) {
      score += 20;
    } else {
      score += 10;
    }
  } else {
    score += 10;
  }

  // 4. Коммерческие страницы
  const page = (visitor.current_page || "").toLowerCase();
  if (
    page.includes("cart") ||
    page.includes("price") ||
    page.includes("checkout") ||
    page.includes("buy") ||
    page.includes("pricing") ||
    page.includes("product") ||
    page.includes("shop")
  ) {
    score += 30;
  }

  return Math.min(100, Math.max(0, score));
}

// Посетитель считается онлайн, только если бэкенд отметил его онлайн И последняя
// активность была недавно. Это убирает «призрачных» онлайн (когда событие
// visitor_offline потерялось, а is_online остался true).
// Порог согласован с серверным TTL (60с) + запас: виджет пингует ~25-30с,
// экран опрашивает REST раз в 30с → 120с гарантированно не даёт ложного офлайна,
// но быстро убирает зависших призраков, если событие потерялось.
const ONLINE_THRESHOLD_MS = 120 * 1000;

function isEffectivelyOnline(v: SiteVisitor): boolean {
  if (!v.is_online) return false;
  const last = new Date(v.last_seen_at).getTime();
  if (Number.isNaN(last)) return true; // нет даты — доверяем флагу
  return Date.now() - last < ONLINE_THRESHOLD_MS;
}

function processAndSortVisitors(list: SiteVisitor[]): SiteVisitor[] {
  return list
    .filter((v) => !v.is_blocked)
    .map((v) => ({
      ...v,
      is_online: isEffectivelyOnline(v),
      score: calculateLeadScore(v),
    }))
    .sort((a, b) => {
      // Сначала те, кто онлайн, потом по score (по убыванию), потом по дате последнего посещения
      if (a.is_online !== b.is_online) {
        return a.is_online ? -1 : 1;
      }
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
    });
}

/**
 * Лёгкая нормализация без пересортировки: применяется к подгружаемой истории.
 * Доверяем порядку сервера (важно при offset-пагинации, иначе дубли/скачки).
 */
function normalizeHistory(list: SiteVisitor[]): SiteVisitor[] {
  return list
    .filter((v) => !v.is_blocked)
    .map((v) => ({
      ...v,
      is_online: isEffectivelyOnline(v),
      score: calculateLeadScore(v),
    }));
}

/** Дедуп по visitor_id с сохранением порядка (первое вхождение выигрывает). */
function dedupeByVisitorId(list: SiteVisitor[]): SiteVisitor[] {
  const seen = new Set<string>();
  const out: SiteVisitor[] = [];
  for (const v of list) {
    if (seen.has(v.visitor_id)) continue;
    seen.add(v.visitor_id);
    out.push(v);
  }
  return out;
}

interface VisitorsState {
  /** «Живой» блок (онлайн + любые посетители из общего запроса). Сортируется по score. */
  visitors: SiteVisitor[];
  setVisitors: (v: SiteVisitor[]) => void;

  /** Upsert single visitor (from WS) */
  upsertVisitor: (v: SiteVisitor) => void;
  removeVisitor: (visitorId: string) => void;
  updateVisitorPage: (visitorId: string, page: string, title: string) => void;
  blockVisitorIP: (visitorId: string) => void;

  /** Пагинируемая история посещений (НЕ пересортировывается — порядок от сервера). */
  historyVisitors: SiteVisitor[];
  /** Заменить историю (первая страница / смена дня). */
  setHistoryVisitors: (v: SiteVisitor[]) => void;
  /** Догрузить следующую страницу истории (append + dedupe). */
  appendVisitors: (v: SiteVisitor[]) => void;
  /** Сбросить историю и счётчики пагинации. */
  resetHistory: () => void;

  /** Текущий offset истории (число уже загруженных записей). */
  historyOffset: number;
  /** Есть ли ещё страницы истории на сервере. */
  hasMore: boolean;
  setHasMore: (v: boolean) => void;
  /** Идёт ли догрузка следующей страницы. */
  isLoadingMore: boolean;
  setLoadingMore: (v: boolean) => void;

  /** Выбранный день истории (YYYY-MM-DD) или null = все. */
  historyDate: string | null;
  setHistoryDate: (d: string | null) => void;

  filter: VisitorFilter;
  setFilter: (f: VisitorFilter) => void;

  countryFilter: string;
  setCountryFilter: (c: string) => void;

  search: string;
  setSearch: (s: string) => void;

  selectedVisitorId: string | null;
  setSelectedVisitorId: (id: string | null) => void;

  isLoading: boolean;
  setLoading: (v: boolean) => void;

  onlineCount: number;

  /**
   * Живые карты пути по visitor_id. Наполняются по сокету 'visitor_path_step'
   * (каждый переход посетителя). VisitorJourney мёржит их поверх загруженного
   * по REST пути, чтобы карта обновлялась без перезапроса.
   */
  livePaths: Record<string, VisitorPathStep[]>;
  /** Засеять/перезаписать кэш пути (после REST-загрузки в VisitorJourney). */
  setVisitorPath: (visitorId: string, steps: VisitorPathStep[]) => void;
  /** Добавить шаг пути (по сокету). Дедуп подряд одинаковых страниц, перенос is_current. */
  appendVisitorPathStep: (visitorId: string, step: VisitorPathStep) => void;
}

export const useVisitorsStore = create<VisitorsState>((set, get) => ({
  visitors: [],
  setVisitors: (visitors) => {
    const processed = processAndSortVisitors(visitors);
    set({ visitors: processed, onlineCount: processed.filter((v) => v.is_online).length });
  },

  upsertVisitor: (visitor) => {
    const list = get().visitors;
    const idx = list.findIndex((v) => v.visitor_id === visitor.visitor_id);
    let next: SiteVisitor[];
    if (idx >= 0) {
      next = [...list];
      next[idx] = { ...next[idx], ...visitor };
    } else {
      next = [visitor, ...list];
    }
    const processed = processAndSortVisitors(next);
    set({ visitors: processed, onlineCount: processed.filter((v) => v.is_online).length });
  },

  removeVisitor: (visitorId) => {
    const next = get().visitors.filter((v) => v.visitor_id !== visitorId);
    const processed = processAndSortVisitors(next);
    set({ visitors: processed, onlineCount: processed.filter((v) => v.is_online).length });
  },

  // история — server-driven, но блокировку отражаем локально

  updateVisitorPage: (visitorId, page, title) => {
    const list = get().visitors;
    const idx = list.findIndex((v) => v.visitor_id === visitorId);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx], current_page: page, current_page_title: title, last_seen_at: new Date().toISOString() };
    const processed = processAndSortVisitors(next);
    set({ visitors: processed });
  },

  blockVisitorIP: (visitorId) => {
    const next = get().visitors.map((v) =>
      v.visitor_id === visitorId ? { ...v, is_blocked: true, is_online: false } : v
    );
    const processed = processAndSortVisitors(next);
    const history = get().historyVisitors.filter((v) => v.visitor_id !== visitorId);
    set({
      visitors: processed,
      historyVisitors: history,
      historyOffset: history.length,
      onlineCount: processed.filter((v) => v.is_online).length,
      selectedVisitorId: get().selectedVisitorId === visitorId ? null : get().selectedVisitorId,
    });
  },

  historyVisitors: [],
  setHistoryVisitors: (list) => {
    const normalized = dedupeByVisitorId(normalizeHistory(list));
    set({ historyVisitors: normalized, historyOffset: normalized.length });
  },
  appendVisitors: (list) => {
    const incoming = normalizeHistory(list);
    const merged = dedupeByVisitorId([...get().historyVisitors, ...incoming]);
    set({ historyVisitors: merged, historyOffset: merged.length });
  },
  resetHistory: () =>
    set({ historyVisitors: [], historyOffset: 0, hasMore: true, isLoadingMore: false }),

  historyOffset: 0,
  hasMore: true,
  setHasMore: (hasMore) => set({ hasMore }),
  isLoadingMore: false,
  setLoadingMore: (isLoadingMore) => set({ isLoadingMore }),

  historyDate: null,
  setHistoryDate: (historyDate) => set({ historyDate }),

  filter: "all",
  setFilter: (filter) => set({ filter }),

  countryFilter: "",
  setCountryFilter: (countryFilter) => set({ countryFilter }),

  search: "",
  setSearch: (search) => set({ search }),

  selectedVisitorId: null,
  setSelectedVisitorId: (selectedVisitorId) => set({ selectedVisitorId }),

  isLoading: false,
  setLoading: (isLoading) => set({ isLoading }),

  onlineCount: 0,

  livePaths: {},

  setVisitorPath: (visitorId, steps) =>
    set((state) => ({
      livePaths: { ...state.livePaths, [visitorId]: steps },
    })),

  appendVisitorPathStep: (visitorId, step) =>
    set((state) => {
      const prev = state.livePaths[visitorId] ?? [];
      const last = prev[prev.length - 1];

      // Дедуп: тот же URL подряд — не плодим шаг, лишь обновляем время/флаг.
      if (last && last.page === step.page) {
        const merged = [...prev];
        merged[merged.length - 1] = {
          ...last,
          title: step.title ?? last.title,
          visited_at: step.visited_at ?? last.visited_at,
          is_current: step.is_current ?? true,
        };
        return { livePaths: { ...state.livePaths, [visitorId]: merged } };
      }

      // Снимаем «сейчас здесь» с прежних шагов, помечаем новый текущим.
      const cleared = prev.map((s) =>
        s.is_current ? { ...s, is_current: false } : s
      );
      const next: VisitorPathStep[] = [
        ...cleared,
        { ...step, is_current: step.is_current ?? true },
      ];
      return { livePaths: { ...state.livePaths, [visitorId]: next } };
    }),
}));