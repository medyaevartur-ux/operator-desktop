import { create } from "zustand";
import type { SiteVisitor } from "@/types/visitor";

type VisitorFilter = "all" | "with_chat" | "without_chat";

interface VisitorsState {
  visitors: SiteVisitor[];
  setVisitors: (v: SiteVisitor[]) => void;

  /** Upsert single visitor (from WS) */
  upsertVisitor: (v: SiteVisitor) => void;
  removeVisitor: (visitorId: string) => void;
  updateVisitorPage: (visitorId: string, page: string, title: string) => void;

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
  setVisitors: (visitors) => set({ visitors, onlineCount: visitors.filter((v) => v.is_online).length }),

  upsertVisitor: (visitor) => {
    const list = get().visitors;
    const idx = list.findIndex((v) => v.visitor_id === visitor.visitor_id);
    let next: SiteVisitor[];
    if (idx >= 0) {
      next = [...list];
      next[idx] = visitor;
    } else {
      next = [visitor, ...list];
    }
    set({ visitors: next, onlineCount: next.filter((v) => v.is_online).length });
  },

  removeVisitor: (visitorId) => {
    const next = get().visitors.filter((v) => v.visitor_id !== visitorId);
    set({ visitors: next, onlineCount: next.filter((v) => v.is_online).length });
  },

  updateVisitorPage: (visitorId, page, title) => {
    const list = get().visitors;
    const idx = list.findIndex((v) => v.visitor_id === visitorId);
    if (idx < 0) return;
    const next = [...list];
    next[idx] = { ...next[idx], current_page: page, current_page_title: title, last_seen_at: new Date().toISOString() };
    set({ visitors: next });
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