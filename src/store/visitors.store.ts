import { create } from "zustand";
import type { SiteVisitor } from "@/types/visitor";

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
// visitor_left потерялось, а is_online остался true).
const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

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

interface VisitorsState {
  visitors: SiteVisitor[];
  setVisitors: (v: SiteVisitor[]) => void;

  /** Upsert single visitor (from WS) */
  upsertVisitor: (v: SiteVisitor) => void;
  removeVisitor: (visitorId: string) => void;
  updateVisitorPage: (visitorId: string, page: string, title: string) => void;
  blockVisitorIP: (visitorId: string) => void;

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
    set({
      visitors: processed,
      onlineCount: processed.filter((v) => v.is_online).length,
      selectedVisitorId: get().selectedVisitorId === visitorId ? null : get().selectedVisitorId,
    });
  },

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
}));