import { useEffect } from "react";
import { useInboxStore } from "@/store/inbox.store";
import { useAuthStore } from "@/store/auth.store";
import { closeConversation, pickConversation } from "@/lib/open-conversation";
import { groupConversations } from "./conversation-list";

/** Alt+W — завершить (с отменой), Alt+A — взять, Alt+R — прочитано, Alt+↑/↓ — соседний диалог в видимом порядке. */
export function useInboxHotkeys() {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const inbox = useInboxStore.getState();
      const session = inbox.activeSession;
      const key = event.key.toLowerCase();
      if ((key === "w" || key === "ц") && session) { event.preventDefault(); void closeConversation(session); return; }
      if ((key === "a" || key === "ф") && session) { event.preventDefault(); void inbox.assignActiveSession().catch(() => undefined); return; }
      if ((key === "r" || key === "к") && session) { event.preventDefault(); void inbox.markActiveSessionRead().catch(() => undefined); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      event.preventDefault();
      const ordered = groupConversations(inbox.sessions, { filter: inbox.filter, query: inbox.searchQuery, me: useAuthStore.getState().operator?.id }).flatMap(group => group.items);
      if (!ordered.length) return;
      const index = ordered.findIndex(item => item.id === session?.id);
      const next = ordered[(index + (event.key === "ArrowDown" ? 1 : -1) + ordered.length) % ordered.length];
      if (next) pickConversation(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
