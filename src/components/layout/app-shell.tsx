import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigationStore } from "@/store/navigation.store";
import { useInboxStore } from "@/store/inbox.store";
import { useInbox } from "@/features/inbox/use-inbox";
import { useInboxRealtime } from "@/features/inbox/use-inbox-realtime";
import { useVisitorsRealtime } from "@/features/visitors/use-visitors-realtime";
import { WorkspaceScreen } from "@/components/screens/workspace-screen";
import { ErrorBoundary } from "@/app/error-boundary";
import { Modal } from "@/components/ui";
import { useIsMobile } from "@/lib/platform";
import { ChatDetails } from "./chat-details";
import { ChatMain } from "./chat-main";
import { CommandPalette } from "./command-palette";
import { InboxHome } from "./inbox-home";
import { MobileAppShell } from "./mobile-app-shell";
import { NotificationBanner } from "./notification-banner";
import { WebPushPrompt } from "./web-push-prompt";
import { Sidebar, SidebarRail } from "./sidebar";
import s from "./AppShell.module.css";

// Карточка клиента встаёт колонкой только там, где переписке хватает ширины.
const WIDE = "(min-width: 1280px)";
const wideNow = () => window.matchMedia(WIDE).matches;
const subscribeWide = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

export function AppShell() {
  useInbox(); useInboxRealtime(); useVisitorsRealtime();
  const mobile = useIsMobile();
  const wide = useSyncExternalStore(subscribeWide, wideNow, () => true);
  const screen = useNavigationStore(state => state.screen);
  const detailsOpen = useNavigationStore(state => state.isDetailsOpen);
  const collapsed = useNavigationStore(state => state.sidebarCollapsed);
  const sessionId = useInboxStore(state => state.activeSession?.id);
  const unread = useInboxStore(state => state.sessions.reduce((sum, session) => sum + (session.unread_count || 0), 0));
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    document.title = unread ? `(${unread}) Живая Сказка — Оператор` : "Живая Сказка — Оператор";
    void import("@/lib/tauri-bridge").then(module => module.setBadgeCount(unread)).catch(() => undefined);
  }, [unread]);

  // При сужении окна колонка не превращается сама во всплывающее окно.
  useEffect(() => { if (!wide) useNavigationStore.getState().setDetailsOpen(false); }, [wide]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "k" || key === "л") { event.preventDefault(); setPaletteOpen(open => !open); }
      else if (key === "b" || key === "и") { event.preventDefault(); useNavigationStore.getState().toggleSidebar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (mobile) return <MobileAppShell />;

  const inbox = screen === "inbox";
  const inlineDetails = inbox && !!sessionId && wide && detailsOpen;
  const columns = `${collapsed ? "52px" : "var(--sidebar-width)"} minmax(0,1fr)${inlineDetails ? " var(--details-width)" : ""}`;

  return (
    <div className={s.shell} style={{ gridTemplateColumns: columns }}>
      {collapsed ? <SidebarRail onOpenPalette={() => setPaletteOpen(true)} /> : <Sidebar onOpenPalette={() => setPaletteOpen(true)} />}
      <main className={s.main}>
        <NotificationBanner />
        <WebPushPrompt />
        <ErrorBoundary key={inbox ? "inbox" : screen}>
          {inbox ? (sessionId ? <ChatMain /> : <InboxHome />) : <div className={`${s.workspace} scrollbar-thin`}><WorkspaceScreen /></div>}
        </ErrorBoundary>
      </main>
      {inlineDetails && (
        <aside className={s.details} aria-label="Карточка клиента">
          <ErrorBoundary><ChatDetails key={sessionId} /></ErrorBoundary>
        </aside>
      )}
      <Modal open={inbox && !!sessionId && !wide && detailsOpen} onClose={() => useNavigationStore.getState().setDetailsOpen(false)} title="Карточка клиента" width={480}>
        <div className={s.drawer}><ChatDetails key={sessionId} /></div>
      </Modal>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
