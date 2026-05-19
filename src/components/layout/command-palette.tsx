import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search, MessageSquareText, Users, Settings, Eye, ListOrdered, Palette,
  ScrollText, Sun, Moon, Sparkles, LogOut, CheckCircle2,
} from "lucide-react";
import { useNavigationStore } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { useThemeStore } from "@/store/theme.store";
import s from "./CommandPalette.module.css";

interface PaletteAction {
  id: string;
  section: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  run: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const setScreen = useNavigationStore((st) => st.setScreen);
  const sessions = useInboxStore((st) => st.sessions);
  const setActiveSession = useInboxStore((st) => st.setActiveSession);
  const logout = useAuthStore((st) => st.logout);
  const setTheme = useThemeStore((st) => st.setTheme);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const close = () => onOpenChange(false);

  const actions = useMemo<PaletteAction[]>(() => {
    const base: PaletteAction[] = [
      { id: "nav-inbox", section: "Навигация", label: "Чаты", icon: MessageSquareText, run: () => { setScreen("inbox"); close(); } },
      { id: "nav-queue", section: "Навигация", label: "Очередь", icon: ListOrdered, run: () => { setScreen("queue"); close(); } },
      { id: "nav-visitors", section: "Навигация", label: "Посетители", icon: Eye, run: () => { setScreen("visitors"); close(); } },
      { id: "nav-operators", section: "Навигация", label: "Операторы", icon: Users, run: () => { setScreen("operators"); close(); } },
      { id: "nav-templates", section: "Навигация", label: "Шаблоны ответов", icon: ScrollText, run: () => { setScreen("templates"); close(); } },
      { id: "nav-widget", section: "Навигация", label: "Виджет", icon: Palette, run: () => { setScreen("widget_settings"); close(); } },
      { id: "nav-settings", section: "Навигация", label: "Настройки", icon: Settings, run: () => { setScreen("settings"); close(); } },
      { id: "nav-logs", section: "Навигация", label: "Логи", icon: ScrollText, run: () => { setScreen("logs"); close(); } },

      { id: "theme-fairytale", section: "Тема", label: "Сказочная", icon: Sparkles, run: () => { setTheme("fairytale"); close(); } },
      { id: "theme-light", section: "Тема", label: "Светлая", icon: Sun, run: () => { setTheme("light"); close(); } },
      { id: "theme-dark", section: "Тема", label: "Тёмная", icon: Moon, run: () => { setTheme("dark"); close(); } },

      { id: "action-logout", section: "Действия", label: "Выйти", icon: LogOut, run: () => { void logout(); close(); } },
    ];

    const chatItems: PaletteAction[] = sessions.slice(0, 50).map((session) => ({
      id: `chat-${session.id}`,
      section: "Чаты",
      label: session.visitor_name?.trim() || `Гость ${session.id.slice(-6)}`,
      hint: session.last_message_text ?? undefined,
      icon: CheckCircle2,
      run: () => { setActiveSession(session); setScreen("inbox"); close(); },
    }));

    return [...chatItems, ...base];
  }, [sessions, setScreen, setActiveSession, setTheme, logout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) =>
      a.label.toLowerCase().includes(q) ||
      a.section.toLowerCase().includes(q) ||
      a.hint?.toLowerCase().includes(q)
    );
  }, [query, actions]);

  const grouped = useMemo(() => {
    const map = new Map<string, PaletteAction[]>();
    filtered.forEach((a) => {
      const arr = map.get(a.section) ?? [];
      arr.push(a);
      map.set(a.section, arr);
    });
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered, activeIdx]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[activeIdx]?.run();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content} aria-describedby={undefined}>
          <Dialog.Title style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", border: 0 }}>
            Командная палитра
          </Dialog.Title>

          <div className={s.searchBox}>
            <Search style={{ width: 18, height: 18, color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Поиск чатов, команд, экранов…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              autoFocus
            />
          </div>

          <div className={s.list}>
            {filtered.length === 0 ? (
              <div className={s.empty}>Ничего не найдено</div>
            ) : (
              grouped.map(([section, items]) => (
                <div key={section}>
                  <div className={s.section}>{section}</div>
                  {items.map((a) => {
                    const globalIdx = filtered.indexOf(a);
                    const Icon = a.icon;
                    return (
                      <div
                        key={a.id}
                        className={`${s.item} ${globalIdx === activeIdx ? s.itemActive : ""}`}
                        onClick={a.run}
                        onMouseEnter={() => setActiveIdx(globalIdx)}
                      >
                        <div className={s.itemIcon}><Icon style={{ width: 14, height: 14 }} /></div>
                        <div className={s.itemLabel}>{a.label}</div>
                        {a.hint && <div className={s.itemHint}>{a.hint.slice(0, 32)}</div>}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className={s.footer}>
            <span><kbd>↑↓</kbd>навигация</span>
            <span><kbd>↵</kbd>выбрать</span>
            <span><kbd>Esc</kbd>закрыть</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
