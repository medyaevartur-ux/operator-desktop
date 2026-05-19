import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DraftsState {
  drafts: Record<string, string>;
  setDraft: (sessionId: string, text: string) => void;
  getDraft: (sessionId: string) => string;
  clearDraft: (sessionId: string) => void;
}

export const useDraftsStore = create<DraftsState>()(
  persist(
    (set, get) => ({
      drafts: {},
      setDraft: (sessionId, text) => {
        if (!sessionId) return;
        if (!text) {
          const next = { ...get().drafts };
          delete next[sessionId];
          set({ drafts: next });
        } else {
          set({ drafts: { ...get().drafts, [sessionId]: text } });
        }
      },
      getDraft: (sessionId) => get().drafts[sessionId] ?? "",
      clearDraft: (sessionId) => {
        const next = { ...get().drafts };
        delete next[sessionId];
        set({ drafts: next });
      },
    }),
    { name: "zhivaya-skazka-drafts" }
  )
);
