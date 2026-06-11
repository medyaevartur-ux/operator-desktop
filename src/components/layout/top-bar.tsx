import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Search, Sun, Moon, Sparkles, Palette, Monitor, Bell } from "lucide-react";
import { useThemeStore, type Theme } from "@/store/theme.store";
import { useNotificationStore } from "@/store/notification.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useAuthStore } from "@/store/auth.store";
import { Tooltip } from "@/components/ui";
import { CommandPalette } from "./command-palette";
import s from "./TopBar.module.css";

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun; swatch: string }> = [
  { value: "fairytale", label: "Сказочная", icon: Sparkles, swatch: "linear-gradient(135deg,#d97706,#fbbf24)" },
  { value: "light", label: "Светлая", icon: Sun, swatch: "#fafaf9" },
  { value: "dark", label: "Тёмная", icon: Moon, swatch: "#1c1917" },
  { value: "system", label: "Системная", icon: Monitor, swatch: "linear-gradient(135deg,#fafaf9 50%,#1c1917 50%)" },
];

const STATUS_OPTIONS: Array<{
  value: "online" | "away" | "dnd" | "offline";
  label: string;
  color: string;
}> = [
  { value: "online", label: "Онлайн", color: "var(--status-online)" },
  { value: "away", label: "Отошёл", color: "var(--status-away)" },
  { value: "dnd", label: "Не беспокоить", color: "var(--status-dnd)" },
  { value: "offline", label: "Офлайн", color: "var(--status-offline)" },
];

export function TopBar() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const theme = useThemeStore((st) => st.theme);
  const setTheme = useThemeStore((st) => st.setTheme);

  const setScreen = useNavigationStore((st) => st.setScreen);
  const operator = useAuthStore((st) => st.operator);
  const updateOperatorStatus = useAuthStore((st) => st.updateOperatorStatus);
  const currentStatus = operator?.status ?? "online";
  const currentStatusOption =
    STATUS_OPTIONS.find((o) => o.value === currentStatus) ?? STATUS_OPTIONS[0];
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

      <DropdownMenu.Root>
        <Tooltip content="Статус оператора" side="bottom">
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={s.statusPill}
              data-status={currentStatus}
              aria-label={`Статус: ${currentStatusOption.label}`}
            >
              <span
                className={s.statusPillDot}
                style={{ background: currentStatusOption.color }}
              />
              <span className={s.statusPillLabel}>{currentStatusOption.label}</span>
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={s.menuContent} sideOffset={8} align="start">
            <div className={s.menuLabel}>Мой статус</div>
            {STATUS_OPTIONS.map((opt) => (
              <DropdownMenu.Item
                key={opt.value}
                className={s.statusMenuItem}
                onSelect={() => void updateOperatorStatus(opt.value)}
              >
                <span className={s.statusMenuDot} style={{ background: opt.color }} />
                {opt.label}
                {currentStatus === opt.value && (
                  <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <button type="button" className={s.searchBtn} onClick={() => setPaletteOpen(true)}>
        <Search style={{ width: 14, height: 14 }} />
        <span className={s.searchLabel}>Поиск чатов, операторов, команд…</span>
        <span className={s.kbdGroup}>
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </span>
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
