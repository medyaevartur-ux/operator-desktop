import { useNavigationStore } from "@/store/navigation.store";
import { useInbox } from "@/features/inbox/use-inbox";
import { useInboxRealtime } from "@/features/inbox/use-inbox-realtime";
import { useSla } from "@/features/inbox/use-sla";
import { MobileChatList } from "@/components/layout/mobile-chat-list";
import { MobileChatView } from "@/components/layout/mobile-chat-view";
import LogsPage from "@/pages/LogsPage";

export function MobileAppShell() {
  useInbox();
  useInboxRealtime();
  useSla();

  const mobileView = useNavigationStore((s) => s.mobileView);

  if (mobileView === "logs") {
    return <LogsPage />;
  }

  if (mobileView === "chat-conversation") {
    return <MobileChatView />;
  }

  return <MobileChatList />;
}