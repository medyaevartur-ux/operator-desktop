import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "fairytale" | "system";
export type ResolvedTheme = "light" | "dark" | "fairytale";

interface ThemeState {
  theme: Theme;
  resolved: ResolvedTheme;
  accentHue: number;        // 0..360, для live-кастомизации акцента
  density: "comfortable" | "compact";
  setTheme: (theme: Theme) => void;
  setAccentHue: (hue: number) => void;
  setDensity: (density: "comfortable" | "compact") => void;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme, accentHue: number, density: "comfortable" | "compact") {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-density", density);
  root.style.setProperty("--accent-hue", String(accentHue));
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "fairytale",
      resolved: "fairytale",
      accentHue: 32,         // золотисто-янтарный по умолчанию
      density: "comfortable",

      setTheme: (theme) => {
        const resolved = theme === "system" ? getSystemTheme() : theme;
        applyTheme(resolved, get().accentHue, get().density);
        set({ theme, resolved });
      },
      setAccentHue: (accentHue) => {
        applyTheme(get().resolved, accentHue, get().density);
        set({ accentHue });
      },
      setDensity: (density) => {
        applyTheme(get().resolved, get().accentHue, density);
        set({ density });
      },
    }),
    {
      name: "zhivaya-skazka-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved = state.theme === "system" ? getSystemTheme() : state.theme;
          applyTheme(resolved, state.accentHue, state.density);
          state.resolved = resolved;
        }
      },
    }
  )
);

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const state = useThemeStore.getState();
    if (state.theme === "system") {
      const resolved = getSystemTheme();
      applyTheme(resolved, state.accentHue, state.density);
      useThemeStore.setState({ resolved });
    }
  });
}
