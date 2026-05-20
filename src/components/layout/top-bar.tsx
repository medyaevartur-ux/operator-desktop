import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Search, Sun, Moon, Sparkles, Palette, Monitor, Bell } from "lucide-react";
import { useThemeStore, type Theme } from "@/store/theme.store";
import { useNotificationStore } from "@/store/notification.store";
import { useNavigationStore } from "@/store/navigation.store";
import { Tooltip } from "@/components/ui";
import { CommandPalette } from "./command-palette";
import s from "./TopBar.module.css";

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun; swatch: string }> = [
  { value: "fairytale", label: "Сказочная", icon: Sparkles, swatch: "linear-gradient(135deg,#d97706,#fbbf24)" },
  { value: "light", label: "Светлая", icon: Sun, swatch: "#fafaf9" },
  { value: "dark", label: "Тёмная", icon: Moon, swatch: "#1c1917" },
  { value: "system", label: "Системная", icon: Monitor, swatch: "linear-gradient(135deg,#fafaf9 50%,#1c1917 50%)" },
];

export function TopBar() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const theme = useThemeStore((st) => st.theme);
  const setTheme = useThemeStore((st) => st.setTheme);

  const setScreen = useNavigationStore((st) => st.setScreen);
  const totalUnread = useNotificationStore((st) => st.totalUnread);
  const [prevUnread, setPrevUnread] = useState(totalUnread);
  const [isSwinging, setIsSwinging] = useState(false);

  useEffect(() => {
    if (totalUnread > prevUnread) {
      setIsSwinging(true);
      const timer = setTimeout(() => setIsSwinging(false), 600);
      return () => clearTimeout(timer);
    }
    setPrevUnread(totalUnread);
  }, [totalUnread, prevUnread]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const currentTheme = THEMES.find((t) => t.value === theme) ?? THEMES[0];
  const CurrentIcon = currentTheme.icon;

  return (
    <header className={s.topbar}>
      <div className={s.brand}>
        <img src="/logo.svg" alt="Живая Сказка" className={s.brandLogo} />
        Живая Сказка
      </div>

      <button type="button" className={s.searchBtn} onClick={() => setPaletteOpen(true)}>
        <Search style={{ width: 14, height: 14 }} />
        Поиск чатов, операторов, команд…
        <kbd>Ctrl K</kbd>
      </button>

      <div className={s.spacer} />

      <div className={s.actions}>
        <Tooltip content="Уведомления" side="bottom">
          <button
            type="button"
            className={`${s.iconBtn} ${isSwinging ? s.swinging : ""}`}
            aria-label="Уведомления"
            onClick={() => setScreen("inbox")}
          >
            <Bell style={{ width: 16, height: 16 }} />
            {totalUnread > 0 && (
              <span className={s.badge}>{totalUnread}</span>
            )}
          </button>
        </Tooltip>

        <DropdownMenu.Root>
          <Tooltip content={`Тема: ${currentTheme.label}`} side="bottom">
            <DropdownMenu.Trigger asChild>
              <button type="button" className={s.iconBtn} aria-label="Сменить тему">
                <CurrentIcon style={{ width: 16, height: 16 }} />
              </button>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={s.menuContent} sideOffset={8} align="end">
              <div className={s.menuLabel}>Тема оформления</div>
              {THEMES.map((t) => {
                const Icon = t.icon;
                return (
                  <DropdownMenu.Item
                    key={t.value}
                    className={s.themeMenuItem}
                    onSelect={() => setTheme(t.value)}
                  >
                    <span className={s.themeSwatch} style={{ background: t.swatch }} />
                    <Icon style={{ width: 14, height: 14 }} />
                    {t.label}
                    {theme === t.value && <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>}
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <Tooltip content="Кастомизация UI" side="bottom">
          <button type="button" className={s.iconBtn} aria-label="Настройки UI" onClick={() => setScreen("settings")}>
            <Palette style={{ width: 16, height: 16 }} />
          </button>
        </Tooltip>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
