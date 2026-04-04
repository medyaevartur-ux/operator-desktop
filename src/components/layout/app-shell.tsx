import { useNavigationStore } from "@/store/navigation.store";
import { useInbox } from "@/features/inbox/use-inbox";
import { useInboxRealtime } from "@/features/inbox/use-inbox-realtime";
import { ChatDetails } from "@/components/layout/chat-details";
import { ChatMain } from "@/components/layout/chat-main";
import { ChatSidebar } from "@/components/layout/chat-sidebar";
import { InboxRail } from "@/components/layout/inbox-rail";
import { OperatorsScreen } from "@/components/screens/operators-screen";
import { SettingsScreen } from "@/components/screens/settings-screen";
import { QueueScreen } from "@/components/screens/queue-screen";
import { VisitorsScreen } from "@/components/screens/visitors-screen";
import { WidgetSettingsScreen } from "@/components/screens/widget-settings-screen";
import LogsPage from "@/pages/LogsPage";
import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { isMobile } from "@/lib/platform";
import { AnimatePresence, motion } from "framer-motion";
import s from "./AppShell.module.css";

const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

const pageTransition = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1] as const,
};
const detailsVariants = {
  initial: { opacity: 0, x: 360 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 360 },
};

const detailsTransition = {
  duration: 0.3,
  ease: [0.16, 1, 0.3, 1] as const,
};

export function AppShell() {
  // На мобиле — мобильная версия
  if (isMobile()) {
    return <MobileAppShell />;
  }

  return <DesktopAppShell />;
}

function DesktopAppShell() {
  useInbox();
  useInboxRealtime();

  const screen = useNavigationStore((s) => s.screen);
  const isDetailsOpen = useNavigationStore((s) => s.isDetailsOpen);

  const columns = isDetailsOpen
    ? "68px 340px minmax(0,1fr) 340px"
    : "68px 340px minmax(0,1fr)";

  if (screen !== "inbox") {
    return (
      <div
        className={s.shell}
        style={{ "--shell-columns": "68px minmax(0,1fr)" } as React.CSSProperties}
      >
        <InboxRail />
        <AnimatePresence mode="wait">
          {screen === "operators" && (
            <motion.div
              key="operators"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              style={{ overflow: "auto" }}
            >
              <OperatorsScreen />
            </motion.div>
          )}
          {screen === "settings" && (
            <motion.div
              key="settings"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              style={{ overflow: "auto" }}
            >
              <SettingsScreen />
            </motion.div>
          )}
          {screen === "queue" && (
            <motion.div
              key="queue"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              style={{ overflow: "auto" }}
            >
              <QueueScreen />
            </motion.div>
          )}
          {screen === "visitors" && (
            <motion.div
              key="visitors"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              style={{ overflow: "auto" }}
            >
              <VisitorsScreen />
            </motion.div>
          )}
          {screen === "widget_settings" && (
            <motion.div
              key="widget_settings"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              style={{ overflow: "auto" }}
            >
              <WidgetSettingsScreen />
            </motion.div>
          )}
          {screen === "logs" && (
            <motion.div
              key="logs"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              style={{ overflow: "auto", height: "100%" }}
            >
              <LogsPage />
            </motion.div>
          )}          
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div
      className={s.shell}
      style={{ "--shell-columns": columns } as React.CSSProperties}
    >
      <InboxRail />
      <ChatSidebar />
      <ChatMain />
      <AnimatePresence>
        {isDetailsOpen && (
          <motion.div
            key="details"
            className={s.detailsPanel}
            variants={detailsVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={detailsTransition}
          >
            <ChatDetails />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}