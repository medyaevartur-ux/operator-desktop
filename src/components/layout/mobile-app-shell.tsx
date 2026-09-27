import { useMemo } from "react";
import { ArrowLeft, Hourglass, Menu, MessagesSquare, WifiOff, Zap } from "lucide-react";
import { WorkspaceScreen } from "@/components/screens/workspace-screen";
import { useNavigationStore, type MobileView } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import { useSocketStore, reconnectSocket } from "@/lib/socket";
import { queueCount } from "@/features/inbox/conversation-list";
import { NotificationBanner } from "./notification-banner";
import { MobileChatList } from "./mobile-chat-list";
import { MobileMore } from "./mobile-more";
import { ChatMain } from "./chat-main";
import s from "./MobileAppShell.module.css";

const TITLES: Partial<Record<MobileView, string>> = {
  queue: "Очередь", templates: "Быстрые ответы", more: "Ещё", settings: "Настройки", logs: "Диагностика",
};

export function MobileAppShell() {
  const view = useNavigationStore(state => state.mobileView);
  const screen = useNavigationStore(state => state.screen);
  const setView = useNavigationStore(state => state.setMobileView);
  const connection = useSocketStore(state => state.status);
  const sessions = useInboxStore(state => state.sessions);
  const badges = useMemo(() => ({
    unread: sessions.reduce((sum, item) => sum + (item.unread_count ?? 0), 0),
    queue: queueCount(sessions),
  }), [sessions]);

  const conversation = view === "chat-conversation";
  const nested = view === "workspace" || view === "settings" || view === "logs";
  const tabs: Array<{ view: MobileView; label: string; icon: typeof Zap; badge?: number; active: boolean }> = [
    { view: "chat-list", label: "Диалоги", icon: MessagesSquare, badge: badges.unread, active: view === "chat-list" },
    { view: "queue", label: "Очередь", icon: Hourglass, badge: badges.queue, active: view === "queue" },
    { view: "templates", label: "Ответы", icon: Zap, active: view === "templates" },
    { view: "more", label: "Ещё", icon: Menu, active: view === "more" || nested },
  ];

  if (conversation) {
    return (
      <div className={s.shell}>
        <NotificationBanner />
        <div className={s.conversation}><ChatMain mobile /></div>
      </div>
    );
  }

  return (
    <div className={s.shell}>
      <header className={s.appBar}>
        {nested ? (
          <button type="button" className={s.back} aria-label="Назад" onClick={() => setView("more")}><ArrowLeft /></button>
        ) : view === "chat-list" ? (
          <img src="/book-mark.svg" alt="" className={s.logo} />
        ) : null}
        <h1 className={s.title}>{view === "chat-list" ? "Живая Сказка" : TITLES[view] ?? SCREEN_TITLES[screen] ?? "Раздел"}</h1>
        {connection !== "connected" && (
          <button type="button" className={s.offline} onClick={() => reconnectSocket()}>
            <WifiOff />{connection === "connecting" ? "Подключаемся" : "Нет связи"}
          </button>
        )}
      </header>
      <NotificationBanner />
      <main className={s.content}>
        {view === "chat-list" && <MobileChatList />}
        {view === "queue" && <WorkspaceScreen screen="queue" />}
        {view === "templates" && <WorkspaceScreen screen="templates" />}
        {view === "more" && <MobileMore />}
        {view === "settings" && <WorkspaceScreen screen="settings" />}
        {view === "logs" && <WorkspaceScreen screen="logs" />}
        {view === "workspace" && <WorkspaceScreen />}
      </main>
      <nav className={s.tabs} aria-label="Разделы приложения">
        {tabs.map(tab => (
          <button key={tab.view} type="button" aria-current={tab.active ? "page" : undefined} onClick={() => setView(tab.view)}>
            <span className={s.tabIcon}>
              <tab.icon />
              {!!tab.badge && <span className={s.tabBadge} data-kind={tab.view}>{tab.badge > 99 ? "99+" : tab.badge}</span>}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const SCREEN_TITLES: Record<string, string> = {
  visitors: "Посетители", operators: "Команда", dashboard: "Статистика", widget_settings: "Виджет на сайте",
  settings: "Настройки", logs: "Диагностика", queue: "Очередь", templates: "Быстрые ответы",
};
