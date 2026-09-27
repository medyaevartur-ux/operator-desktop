import { create } from "zustand";

export type Screen = "inbox" | "operators" | "settings" | "dashboard" | "queue" | "visitors" | "widget_settings" | "templates" | "logs";

export type MobileView = "workspace" | "chat-list" | "chat-conversation" | "logs" | "templates" | "settings" | "queue" | "more";

const SIDEBAR_KEY = "zs_sidebar_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { return false; } };

interface NavigationState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  isDetailsOpen: boolean;
  toggleDetails: () => void;
  setDetailsOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  mobileView: MobileView;
  setMobileView: (view: MobileView) => void;
}

const MOBILE_SCREEN: Partial<Record<MobileView, Screen>> = {
  "chat-list": "inbox", "chat-conversation": "inbox", settings: "settings", templates: "templates", logs: "logs", queue: "queue",
};

export const useNavigationStore = create<NavigationState>((set) => ({
  screen: "inbox",
  setScreen: (screen) => set({ screen }),
  isDetailsOpen: typeof window !== "undefined" && window.innerWidth >= 1280,
  toggleDetails: () => set((s) => ({ isDetailsOpen: !s.isDetailsOpen })),
  setDetailsOpen: (open) => set({ isDetailsOpen: open }),
  sidebarCollapsed: readCollapsed(),
  toggleSidebar: () => set((s) => {
    const sidebarCollapsed = !s.sidebarCollapsed;
    try { localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0"); } catch { /* приватный режим */ }
    return { sidebarCollapsed };
  }),
  mobileView: "chat-list",
  setMobileView: view => set({ mobileView: view, ...(MOBILE_SCREEN[view] ? { screen: MOBILE_SCREEN[view] } : {}) }),
}));
