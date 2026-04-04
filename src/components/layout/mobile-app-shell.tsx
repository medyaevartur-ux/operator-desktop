import { useNavigationStore } from "@/store/navigation.store";
import { useInbox } from "@/features/inbox/use-inbox";
import { useInboxRealtime } from "@/features/inbox/use-inbox-realtime";
import { MobileChatList } from "@/components/layout/mobile-chat-list";
import { MobileChatView } from "@/components/layout/mobile-chat-view";
import LogsPage from "@/pages/LogsPage";

export function MobileAppShell() {
  useInbox();
  useInboxRealtime();

  const mobileView = useNavigationStore((s) => s.mobileView);

  if (mobileView === "logs") {
    return <LogsPage />;
  }

  if (mobileView === "chat-conversation") {
    return <MobileChatView />;
  }

  return <MobileChatList />;
}