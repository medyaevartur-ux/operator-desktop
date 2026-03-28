import { create } from "zustand";

type Screen = "inbox" | "operators" | "settings" | "dashboard" | "queue" | "visitors" | "widget_settings";

interface NavigationState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  isDetailsOpen: boolean;
  toggleDetails: () => void;
  setDetailsOpen: (open: boolean) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  screen: "inbox",
  setScreen: (screen) => set({ screen }),
  isDetailsOpen: true,
  toggleDetails: () => set((s) => ({ isDetailsOpen: !s.isDetailsOpen })),
  setDetailsOpen: (open) => set({ isDetailsOpen: open }),
}));