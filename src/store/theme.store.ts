import { create } from "zustand";
import { persist } from "zustand/middleware";

// "fairytale" остаётся только для чтения старых сохранений: теперь это светлая тема.
export type Theme = "light" | "dark" | "system" | "fairytale";
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  resolved: ResolvedTheme;
  density: "comfortable" | "compact";
  autoTimeTheme: boolean;   // тёмная тема с 19:00 до 07:00
  setTheme: (theme: Theme) => void;
  setDensity: (density: "comfortable" | "compact") => void;
  setAutoTimeTheme: (enabled: boolean) => void;
}

const SURFACE: Record<ResolvedTheme, string> = { light: "#FAF9F5", dark: "#262624" };

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme, autoTimeTheme: boolean): ResolvedTheme {
  if (autoTimeTheme) {
    const hour = new Date().getHours();
    return hour >= 19 || hour < 7 ? "dark" : "light";
  }
  if (theme === "system") return systemTheme();
  return theme === "dark" ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme, density: "comfortable" | "compact") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-density", density);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", SURFACE[resolved]);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "system",
      resolved: resolveTheme("system", false),
      density: "comfortable",
      autoTimeTheme: false,

      setTheme: (theme) => {
        const resolved = resolveTheme(theme, get().autoTimeTheme);
        applyTheme(resolved, get().density);
        set({ theme, resolved });
      },
      setDensity: (density) => {
        applyTheme(get().resolved, density);
        set({ density });
      },
      setAutoTimeTheme: (autoTimeTheme) => {
        const resolved = resolveTheme(get().theme, autoTimeTheme);
        applyTheme(resolved, get().density);
        set({ autoTimeTheme, resolved });
      },
    }),
    {
      name: "zhivaya-skazka-theme",
      version: 2,
      partialize: ({ theme, density, autoTimeTheme }) => ({ theme, density, autoTimeTheme }),
      migrate: (persisted) => {
        const previous = (persisted ?? {}) as Partial<ThemeState>;
        return { ...previous, theme: previous.theme === "fairytale" ? "light" : (previous.theme ?? "system") } as ThemeState;
      },
    },
  ),
);

function sync() {
  const state = useThemeStore.getState();
  const resolved = resolveTheme(state.theme, state.autoTimeTheme);
  applyTheme(resolved, state.density);
  if (resolved !== state.resolved) useThemeStore.setState({ resolved });
}

if (typeof window !== "undefined") {
  sync();
  useThemeStore.persist.onFinishHydration(sync);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", sync);
  // Переключение по времени суток проверяется раз в минуту.
  setInterval(() => { if (useThemeStore.getState().autoTimeTheme) sync(); }, 60_000);
}
