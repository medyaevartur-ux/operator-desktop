import { create } from "zustand";

type Screen = "inbox" | "operators" | "settings" | "dashboard" | "queue" | "visitors" | "widget_settings" | "logs";

type MobileView = "chat-list" | "chat-conversation" | "logs";

interface NavigationState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  isDetailsOpen: boolean;
  toggleDetails: () => void;
  setDetailsOpen: (open: boolean) => void;
  mobileView: MobileView;
  setMobileView: (view: MobileView) => void;
  pendingSessionId: string | null;
  setPendingSessionId: (id: string | null) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  screen: "inbox",
  setScreen: (screen) => set({ screen }),
  isDetailsOpen: true,
  toggleDetails: () => set((s) => ({ isDetailsOpen: !s.isDetailsOpen })),
  setDetailsOpen: (open) => set({ isDetailsOpen: open }),
  mobileView: "chat-list",
  setMobileView: (view) => set({ mobileView: view }),
  pendingSessionId: null,
  setPendingSessionId: (id) => set({ pendingSessionId: id }),
}));