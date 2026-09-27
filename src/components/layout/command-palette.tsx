import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChartColumn, CornerDownLeft, Eye, Hourglass, LogOut, MessageSquareQuote, MessagesSquare, Monitor, Moon, Search,
  Settings, Stethoscope, Sun, UserRound, Users, Zap,
} from "lucide-react";
import { useNavigationStore, type Screen } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useThemeStore } from "@/store/theme.store";
import { getSessionDisplayName } from "@/utils/avatar";
import { pickConversation } from "@/lib/open-conversation";
import s from "./CommandPalette.module.css";

interface PaletteAction { id: string; section: string; label: string; hint?: string; icon: typeof Search; run: () => void }
interface Props { open: boolean; onOpenChange: (open: boolean) => void }

const SCREENS: Array<{ screen: Screen; label: string; icon: typeof Search; manager?: boolean }> = [
  { screen: "inbox", label: "Диалоги", icon: MessagesSquare },
  { screen: "queue", label: "Очередь", icon: Hourglass },
  { screen: "templates", label: "Быстрые ответы", icon: Zap },
  { screen: "visitors", label: "Посетители", icon: Eye, manager: true },
  { screen: "operators", label: "Команда", icon: Users, manager: true },
  { screen: "dashboard", label: "Статистика", icon: ChartColumn, manager: true },
  { screen: "widget_settings", label: "Виджет на сайте", icon: MessageSquareQuote, manager: true },
  { screen: "settings", label: "Настройки", icon: Settings },
  { screen: "logs", label: "Диагностика", icon: Stethoscope },
];

export function CommandPalette({ open, onOpenChange }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const setScreen = useNavigationStore(state => state.setScreen);
  const sessions = useInboxStore(state => state.sessions);
  const role = useAuthStore(state => state.operator?.role);
  const logout = useAuthStore(state => state.logout);
  const setTheme = useThemeStore(state => state.setTheme);
  const manager = role === "admin" || role === "supervisor";

  useEffect(() => { if (open) { setQuery(""); setActiveIdx(0); } }, [open]);

  const actions = useMemo<PaletteAction[]>(() => {
    const close = () => onOpenChange(false);
    const chats: PaletteAction[] = sessions.slice(0, 60).map(session => ({
      id: `chat-${session.id}`,
      section: "Диалоги",
      label: getSessionDisplayName(session.visitor_name, session.visitor_id),
      hint: session.last_message_text ?? session.visitor_phone ?? session.visitor_email ?? undefined,
      icon: UserRound,
      run: () => { pickConversation(session); close(); },
    }));
    const screens: PaletteAction[] = SCREENS.filter(item => manager || !item.manager).map(item => ({
      id: `nav-${item.screen}`, section: "Разделы", label: item.label, icon: item.icon, run: () => { setScreen(item.screen); close(); },
    }));
    const other: PaletteAction[] = [
      { id: "theme-light", section: "Оформление", label: "Светлая тема", icon: Sun, run: () => { setTheme("light"); close(); } },
      { id: "theme-dark", section: "Оформление", label: "Тёмная тема", icon: Moon, run: () => { setTheme("dark"); close(); } },
      { id: "theme-system", section: "Оформление", label: "Тема как в системе", icon: Monitor, run: () => { setTheme("system"); close(); } },
      { id: "logout", section: "Аккаунт", label: "Выйти", icon: LogOut, run: () => { void logout(); close(); } },
    ];
    return [...chats, ...screens, ...other];
  }, [sessions, manager, setScreen, setTheme, logout, onOpenChange]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? actions.filter(action => `${action.label} ${action.section} ${action.hint ?? ""}`.toLowerCase().includes(q)) : actions.filter(action => action.section !== "Диалоги").concat(actions.filter(action => action.section === "Диалоги").slice(0, 8));
    return list;
  }, [query, actions]);

  const grouped = useMemo(() => {
    const map = new Map<string, PaletteAction[]>();
    for (const action of filtered) map.set(action.section, [...(map.get(action.section) ?? []), action]);
    return [...map.entries()];
  }, [filtered]);

  useEffect(() => { if (activeIdx >= filtered.length) setActiveIdx(0); }, [filtered, activeIdx]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIdx(i => Math.min(filtered.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); filtered[activeIdx]?.run(); }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content} aria-describedby={undefined}>
          <Dialog.Title className={s.srOnly}>Поиск и команды</Dialog.Title>
          <div className={s.searchBox}>
            <Search aria-hidden="true" />
            <input type="text" placeholder="Найти диалог, раздел или команду" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKey} autoFocus />
          </div>
          <div className={s.list} role="listbox">
            {filtered.length === 0 ? <div className={s.empty}>Ничего не найдено</div> : grouped.map(([section, items]) => (
              <div key={section}>
                <div className={s.section}>{section}</div>
                {items.map(action => {
                  const index = filtered.indexOf(action);
                  return (
                    <div key={action.id} role="option" aria-selected={index === activeIdx} className={s.item} data-active={index === activeIdx || undefined}
                      onClick={action.run} onMouseEnter={() => setActiveIdx(index)}>
                      <action.icon className={s.itemIcon} />
                      <span className={s.itemLabel}>{action.label}</span>
                      {action.hint && <span className={s.itemHint}>{action.hint}</span>}
                      {index === activeIdx && <CornerDownLeft className={s.itemEnter} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={s.footer}>
            <span><kbd>↑↓</kbd> выбрать</span>
            <span><kbd>Enter</kbd> открыть</span>
            <span><kbd>Esc</kbd> закрыть</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
