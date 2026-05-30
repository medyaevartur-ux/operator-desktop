import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "fairytale" | "system";
export type ResolvedTheme = "light" | "dark" | "fairytale";

interface ThemeState {
  theme: Theme;
  resolved: ResolvedTheme;
  accentHue: number;        // 0..360, для live-кастомизации акцента
  density: "comfortable" | "compact";
  autoTimeTheme: boolean;   // Автоматическая смена по времени суток (19:00 - 07:00)
  setTheme: (theme: Theme) => void;
  setAccentHue: (hue: number) => void;
  setDensity: (density: "comfortable" | "compact") => void;
  setAutoTimeTheme: (enabled: boolean) => void;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getAutoTimeThemeResolved(baseTheme: Theme): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  const hour = new Date().getHours();
  // С 19:00 до 07:00 включаем темную тему
  if (hour >= 19 || hour < 7) {
    return "dark";
  }
  // В светлое время суток возвращаем базовую выбранную светлую тему, если она не тёмная
  if (baseTheme === "light" || baseTheme === "fairytale") {
    return baseTheme;
  }
  return "fairytale"; // Сказочная по умолчанию
}

function resolveTheme(theme: Theme, autoTimeTheme: boolean): ResolvedTheme {
  if (autoTimeTheme) {
    return getAutoTimeThemeResolved(theme);
  }
  if (theme === "system") {
    return getSystemTheme();
  }
  return theme;
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
      theme: "light",
      resolved: "light",
      accentHue: 222,        // деловой синий по умолчанию (сказочная/тёмная — в настройках)
      density: "comfortable",
      autoTimeTheme: false,

      setTheme: (theme) => {
        const resolved = resolveTheme(theme, get().autoTimeTheme);
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
      setAutoTimeTheme: (autoTimeTheme) => {
        const resolved = resolveTheme(get().theme, autoTimeTheme);
        applyTheme(resolved, get().accentHue, get().density);
        set({ autoTimeTheme, resolved });
      },
    }),
    {
      name: "zhivaya-skazka-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved = resolveTheme(state.theme, state.autoTimeTheme);
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
    if (state.theme === "system" && !state.autoTimeTheme) {
      const resolved = getSystemTheme();
      applyTheme(resolved, state.accentHue, state.density);
      useThemeStore.setState({ resolved });
    }
  });

  // Автоматический мониторинг времени раз в минуту
  setInterval(() => {
    const state = useThemeStore.getState();
    if (state.autoTimeTheme) {
      const resolved = resolveTheme(state.theme, true);
      if (resolved !== state.resolved) {
        applyTheme(resolved, state.accentHue, state.density);
        useThemeStore.setState({ resolved });
      }
    }
  }, 60000);
}
