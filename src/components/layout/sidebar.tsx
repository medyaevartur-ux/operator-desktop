import { useMemo } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell, BellOff, ChartColumn, Check, ChevronsUpDown, Eye, Hourglass, LogOut, MessageSquareQuote, MessagesSquare,
  Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Send, Settings, Stethoscope, Sun, Users, Volume2, VolumeX, WifiOff, X, Zap,
} from "lucide-react";
import { useOutbox } from "@/features/inbox/use-outbox";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useNavigationStore, type Screen } from "@/store/navigation.store";
import { useNotificationStore } from "@/store/notification.store";
import { useDeliveryStore } from "@/store/delivery.store";
import { useVisitorsStore } from "@/store/visitors.store";
import { useThemeStore, type Theme } from "@/store/theme.store";
import { useSocketStore, reconnectSocket } from "@/lib/socket";
import { LIST_FILTERS, queueCount } from "@/features/inbox/conversation-list";
import { Avatar, Tooltip } from "@/components/ui";
import { env } from "@/lib/env";
import { ConversationList } from "./conversation-list";
import s from "./Sidebar.module.css";

type Role = "admin" | "supervisor" | "operator";
const MANAGERS: Role[] = ["admin", "supervisor"];
const EVERYONE: Role[] = ["admin", "supervisor", "operator"];

const NAV: Array<{ screen: Screen; label: string; icon: typeof Zap; roles: Role[] }> = [
  { screen: "inbox", label: "Диалоги", icon: MessagesSquare, roles: EVERYONE },
  { screen: "queue", label: "Очередь", icon: Hourglass, roles: EVERYONE },
  { screen: "visitors", label: "Посетители", icon: Eye, roles: MANAGERS },
  { screen: "templates", label: "Быстрые ответы", icon: Zap, roles: EVERYONE },
  { screen: "operators", label: "Команда", icon: Users, roles: MANAGERS },
  { screen: "dashboard", label: "Статистика", icon: ChartColumn, roles: MANAGERS },
  { screen: "widget_settings", label: "Виджет на сайте", icon: MessageSquareQuote, roles: MANAGERS },
];

export const STATUS_OPTIONS = [
  { value: "online", label: "На связи" },
  { value: "away", label: "Отошёл" },
  { value: "dnd", label: "Не беспокоить" },
  { value: "offline", label: "Не в сети" },
] as const;
export type OperatorStatus = typeof STATUS_OPTIONS[number]["value"];

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Светлая", icon: Sun },
  { value: "dark", label: "Тёмная", icon: Moon },
  { value: "system", label: "Как в системе", icon: Monitor },
];

const avatarUrl = (url?: string | null) => (url ? (url.startsWith("http") ? url : `${env.apiUrl}${url}`) : null);

function ProfileMenu() {
  const operator = useAuthStore(state => state.operator);
  const updateStatus = useAuthStore(state => state.updateOperatorStatus);
  const logout = useAuthStore(state => state.logout);
  const setScreen = useNavigationStore(state => state.setScreen);
  const sound = useNotificationStore(state => state.soundEnabled);
  const setSound = useNotificationStore(state => state.setSoundEnabled);
  const alerts = useDeliveryStore(state => state.preferences.enabled);
  const theme = useThemeStore(state => state.theme);
  const setTheme = useThemeStore(state => state.setTheme);
  const status = (operator?.status ?? "online") as OperatorStatus;
  const statusLabel = STATUS_OPTIONS.find(option => option.value === status)?.label ?? "На связи";
  const currentTheme = THEMES.find(item => item.value === theme) ?? THEMES[0];
  const ThemeIcon = currentTheme.icon;
  const toggleAlerts = () => {
    const store = useDeliveryStore.getState();
    void store.savePreferences({ ...store.preferences, enabled: !store.preferences.enabled }).catch(() => undefined);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={s.profile} aria-label={`Профиль и статус: ${statusLabel}`}>
          <Avatar name={operator?.name ?? "Оператор"} src={avatarUrl(operator?.avatar_url)} size="sm" status={status} />
          <span className={s.profileText}>
            <span className={s.profileName}>{operator?.name ?? "Оператор"}</span>
            <span className={s.profileStatus}>{statusLabel}</span>
          </span>
          <ChevronsUpDown className={s.profileChevron} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.menu} side="top" align="start" sideOffset={6}>
          <div className={s.menuHead}>{operator?.email ?? ""}</div>
          <DropdownMenu.Label className={s.menuLabel}>Статус</DropdownMenu.Label>
          {STATUS_OPTIONS.map(option => (
            <DropdownMenu.Item key={option.value} className={s.menuItem} onSelect={() => void updateStatus(option.value).catch(() => undefined)}>
              <span className={s.dot} data-status={option.value} />
              {option.label}
              {status === option.value && <Check className={s.menuCheck} />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className={s.menuSeparator} />
          <DropdownMenu.Item className={s.menuItem} onSelect={event => { event.preventDefault(); setSound(!sound); }}>
            {sound ? <Volume2 className={s.menuIcon} /> : <VolumeX className={s.menuIcon} />}
            Звук новых сообщений
            <span className={s.menuState}>{sound ? "вкл" : "выкл"}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={s.menuItem} onSelect={event => { event.preventDefault(); toggleAlerts(); }}>
            {alerts ? <Bell className={s.menuIcon} /> : <BellOff className={s.menuIcon} />}
            Уведомления
            <span className={s.menuState}>{alerts ? "вкл" : "выкл"}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className={s.menuItem}>
              <ThemeIcon className={s.menuIcon} />
              Оформление
              <span className={s.menuState}>{currentTheme.label}</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className={s.menu} sideOffset={6}>
                {THEMES.map(item => (
                  <DropdownMenu.Item key={item.value} className={s.menuItem} onSelect={() => setTheme(item.value)}>
                    <item.icon className={s.menuIcon} />{item.label}
                    {theme === item.value && <Check className={s.menuCheck} />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Separator className={s.menuSeparator} />
          <DropdownMenu.Item className={s.menuItem} onSelect={() => setScreen("settings")}><Settings className={s.menuIcon} />Настройки</DropdownMenu.Item>
          <DropdownMenu.Item className={s.menuItem} onSelect={() => setScreen("logs")}><Stethoscope className={s.menuIcon} />Диагностика</DropdownMenu.Item>
          <DropdownMenu.Separator className={s.menuSeparator} />
          <DropdownMenu.Item className={s.menuItem} onSelect={() => void logout()}><LogOut className={s.menuIcon} />Выйти</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function useNavItems() {
  const role = (useAuthStore(state => state.operator?.role) ?? "operator") as Role;
  const sessions = useInboxStore(state => state.sessions);
  const online = useVisitorsStore(state => state.onlineCount);
  return useMemo(() => {
    const badges: Partial<Record<Screen, number>> = {
      inbox: sessions.reduce((sum, item) => sum + (item.unread_count ?? 0), 0),
      queue: queueCount(sessions),
      visitors: online,
    };
    return NAV.filter(item => item.roles.includes(role)).map(item => ({ ...item, badge: badges[item.screen] ?? 0 }));
  }, [role, sessions, online]);
}

/** Свёрнутая панель: только значки разделов, чтобы переписка получила всю ширину. */
export function SidebarRail({ onOpenPalette }: { onOpenPalette: () => void }) {
  const items = useNavItems();
  const screen = useNavigationStore(state => state.screen);
  const setScreen = useNavigationStore(state => state.setScreen);
  const toggleSidebar = useNavigationStore(state => state.toggleSidebar);
  const socket = useSocketStore(state => state.status);
  return (
    <aside className={s.rail} aria-label="Навигация">
      <Tooltip content="Показать панель" kbd="Ctrl B" side="right">
        <button type="button" className={s.iconButton} onClick={toggleSidebar} aria-label="Показать боковую панель"><PanelLeftOpen /></button>
      </Tooltip>
      <Tooltip content="Поиск и команды" kbd="Ctrl K" side="right">
        <button type="button" className={s.iconButton} onClick={onOpenPalette} aria-label="Поиск и команды"><Search /></button>
      </Tooltip>
      <span className={s.railDivider} />
      {items.map(item => (
        <Tooltip key={item.screen} content={item.badge ? `${item.label} · ${item.badge}` : item.label} side="right">
          <button type="button" className={s.iconButton} aria-label={item.label} aria-current={screen === item.screen ? "page" : undefined} onClick={() => setScreen(item.screen)}>
            <item.icon />
            {item.badge > 0 && <span className={s.railDot} data-kind={item.screen} />}
          </button>
        </Tooltip>
      ))}
      <span className={s.railSpacer} />
      {socket !== "connected" && (
        <Tooltip content="Нет связи с сервером — повторить" side="right">
          <button type="button" className={s.iconButton} data-danger onClick={() => reconnectSocket()} aria-label="Восстановить связь"><WifiOff /></button>
        </Tooltip>
      )}
      <Tooltip content="Настройки" side="right">
        <button type="button" className={s.iconButton} aria-label="Настройки" aria-current={screen === "settings" ? "page" : undefined} onClick={() => setScreen("settings")}><Settings /></button>
      </Tooltip>
    </aside>
  );
}

export function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const items = useNavItems();
  const screen = useNavigationStore(state => state.screen);
  const setScreen = useNavigationStore(state => state.setScreen);
  const toggleSidebar = useNavigationStore(state => state.toggleSidebar);
  const filter = useInboxStore(state => state.filter);
  const setFilter = useInboxStore(state => state.setFilter);
  const query = useInboxStore(state => state.searchQuery);
  const setQuery = useInboxStore(state => state.setSearchQuery);
  const socket = useSocketStore(state => state.status);
  const unsent = useOutbox(useAuthStore(state => state.operator?.id)).filter(item => item.error).length;

  return (
    <aside className={s.sidebar} aria-label="Навигация и диалоги">
      <div className={s.top}>
        <div className={s.brand}>
          <img src="/book-mark.svg" alt="" className={s.logo} />
          <span className={s.wordmark}>Живая Сказка</span>
        </div>
        <Tooltip content="Скрыть панель" kbd="Ctrl B" side="bottom">
          <button type="button" className={s.iconButton} onClick={toggleSidebar} aria-label="Скрыть боковую панель">
            <PanelLeftClose />
          </button>
        </Tooltip>
      </div>

      <button type="button" className={s.search} onClick={onOpenPalette}>
        <Search />
        <span>Поиск и команды</span>
        <kbd>Ctrl K</kbd>
      </button>

      <nav className={s.nav}>
        {items.map(item => (
          <button key={item.screen} type="button" className={s.navItem} aria-current={screen === item.screen ? "page" : undefined} onClick={() => setScreen(item.screen)}>
            <item.icon />
            <span>{item.label}</span>
            {item.badge > 0 && <span className={s.navBadge} data-kind={item.screen}>{item.badge > 99 ? "99+" : item.badge}</span>}
          </button>
        ))}
      </nav>

      <div className={s.listHead}>
        <div className={s.segmented} role="tablist" aria-label="Какие диалоги показать">
          {LIST_FILTERS.map(item => (
            <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}</button>
          ))}
        </div>
        <label className={s.filterSearch}>
          <Search aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Имя, телефон или текст" aria-label="Поиск по диалогам" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X /></button>}
        </label>
      </div>

      <div className={`${s.listScroll} scrollbar-thin`}>
        <ConversationList />
      </div>

      <footer className={s.footer}>
        {unsent > 0 && (
          <button type="button" className={s.offline} onClick={() => setScreen("logs")}>
            <Send />
            <span>{unsent === 1 ? "1 сообщение не отправлено" : `Не отправлено сообщений: ${unsent}`}</span>
            <strong>Открыть</strong>
          </button>
        )}
        {socket !== "connected" && (
          <button type="button" className={s.offline} onClick={() => reconnectSocket()} aria-live="polite">
            <WifiOff />
            <span>{socket === "connecting" ? "Подключаемся к серверу…" : "Нет связи с сервером"}</span>
            {socket !== "connecting" && <strong>Повторить</strong>}
          </button>
        )}
        <div className={s.footerRow}>
          <ProfileMenu />
          <Tooltip content="Настройки" side="top">
            <button type="button" className={s.iconButton} aria-label="Настройки" aria-current={screen === "settings" ? "page" : undefined} onClick={() => setScreen("settings")}>
              <Settings />
            </button>
          </Tooltip>
        </div>
      </footer>
    </aside>
  );
}
