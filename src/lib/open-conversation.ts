import { changeSessionStatus, closeChatSession, getChatSession, markChatSessionRead } from "@/features/inbox/inbox.api";
import { useInboxStore } from "@/store/inbox.store";
import { useNavigationStore } from "@/store/navigation.store";
import { useAuthStore } from "@/store/auth.store";
import { authEpoch } from "@/lib/auth-session";
import { isMobile } from "@/lib/platform";
import { toast } from "@/components/ui";
import { getSessionDisplayName } from "@/utils/avatar";
import type { ChatSession } from "@/types/chat";

function patchSession(id: string, patch: Partial<ChatSession>) {
  useInboxStore.setState(state => ({
    sessions: state.sessions.map(item => item.id === id ? { ...item, ...patch } : item),
    activeSession: state.activeSession?.id === id ? { ...state.activeSession, ...patch } : state.activeSession,
  }));
}

/** Вернуть завершённый диалог в работу по его ID (в том числе из уведомления «Отменить»). */
export async function reopenConversation(id: string) {
  try {
    await changeSessionStatus(id, "waiting_operator", useAuthStore.getState().operator?.id);
    patchSession(id, { status: "waiting_operator", closed_at: null });
    void useInboxStore.getState().loadSessions();
  } catch {
    toast.error("Не удалось открыть диалог снова", "Проверьте связь и повторите.");
  }
}

/** Завершить диалог без лишнего окна подтверждения: сразу предлагаем отмену. Черновик сохраняется. */
export async function closeConversation(session: ChatSession) {
  if (session.status === "closed") return;
  try {
    await closeChatSession(session.id, useAuthStore.getState().operator?.id);
    patchSession(session.id, { status: "closed", closed_at: new Date().toISOString() });
    void useInboxStore.getState().loadSessions();
    toast.success("Диалог завершён", getSessionDisplayName(session.visitor_name, session.visitor_id), {
      label: "Открыть снова",
      run: () => void reopenConversation(session.id),
    });
  } catch (error) {
    toast.error("Не удалось завершить диалог", error instanceof Error ? error.message : "Повторите попытку.");
  }
}

/** Открыть диалог из списка, палитры или очереди: просмотр не присваивает чат. */
export function pickConversation(session: ChatSession) {
  const inbox = useInboxStore.getState();
  inbox.openSession(session);
  useNavigationStore.setState({ screen: "inbox", ...(isMobile() ? { mobileView: "chat-conversation" as const } : {}) });
  void inbox.loadMessages(session.id);
  if (session.unread_count) {
    useInboxStore.setState(state => ({ sessions: state.sessions.map(item => item.id === session.id ? { ...item, unread_count: 0 } : item) }));
    void markChatSessionRead(session.id).catch(() => undefined);
  }
}

let openRequest = 0;
export async function openConversationFromNotification(id: string, isCurrent = () => true): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return false;
  const request = ++openRequest, epoch = authEpoch();
  try {
    const session = useInboxStore.getState().sessions.find(item => item.id === id) || await getChatSession(id);
    if (request !== openRequest || epoch !== authEpoch() || !isCurrent()) return false;
    const inbox = useInboxStore.getState();
    inbox.upsertSession(session);
    inbox.openSession(session);
    useNavigationStore.setState({ screen: "inbox", ...(isMobile() ? { mobileView: "chat-conversation" as const } : {}) });
    void inbox.loadMessages(id);
    return true;
  } catch {
    if (epoch === authEpoch() && isCurrent()) toast.error("Не удалось открыть диалог из уведомления. Повторите после восстановления связи.");
    return false;
  }
}
