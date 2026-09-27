import { api } from "@/lib/api";
import type { ChatMessage, ChatSession } from "@/types/chat";
import type { ClientNote } from "@/types/note";
import type { ChatTag, ChatSessionTag } from "@/types/tag";

// === Sessions ===

export async function getChatSessions(): Promise<ChatSession[]> {
  return api<ChatSession[]>("/api/sessions");
}

export async function assignOperatorToSession(sessionId: string, operatorId: string) {
  return api(`/api/sessions/${sessionId}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ operator_id: operatorId }),
  });
}

export const assignSession = assignOperatorToSession;

/** Уйти из диалога — снять с себя, вернуть в очередь. */
export async function leaveChatSession(sessionId: string) {
  return api(`/api/sessions/${sessionId}/leave`, { method: "PATCH" });
}

/** Заблокировать посетителя («В спам») — он больше не сможет писать. */
export async function blockVisitorBySession(visitorId: string) {
  return api(`/api/visitors/${visitorId}/block`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function transferOperatorToSession(sessionId: string, operatorId: string, fromOperatorId?: string, comment?: string) {
  return api(`/api/sessions/${sessionId}/transfer`, {
    method: "PATCH",
    body: JSON.stringify({ operator_id: operatorId, from_operator_id: fromOperatorId, comment }),
  });
}

export async function closeChatSession(sessionId: string, operatorId?: string) {
  return api(`/api/sessions/${sessionId}/close`, {
    method: "PATCH",
    body: JSON.stringify({ operator_id: operatorId }),
  });
}

export async function markChatSessionRead(sessionId: string) {
  return api(`/api/sessions/${sessionId}/read`, { method: "PATCH" });
}

export async function markChatSessionUnread(sessionId: string) {
  return api(`/api/sessions/${sessionId}/unread`, { method: "PATCH" });
}

// === Messages ===

export async function getChatMessages(sessionId: string): Promise<ChatMessage[]> {
  return api<ChatMessage[]>(`/api/sessions/${sessionId}/messages`);
}
export interface MessagePage { messages: ChatMessage[]; next_cursor: string | null }
export async function getMessagePage(sessionId: string, cursor?: string | null, around?: string): Promise<MessagePage> {
  return api(`/api/sessions/${sessionId}/messages?paged=1&limit=80${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${around ? `&around=${encodeURIComponent(around)}` : ""}`);
}

export async function sendOperatorMessage(params: {
  sessionId: string;
  operatorId: string;
  message: string;
  replyToId?: string;
  clientId: string;
  isInternal?: boolean;
}): Promise<ChatMessage> {
  return api<ChatMessage>(`/api/sessions/${params.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      operator_id: params.operatorId,
      message: params.message,
      reply_to_id: params.replyToId || undefined,
      client_message_id: params.clientId,
      is_internal: !!params.isInternal,
    }),
  });
}

export async function searchMessages(query: string): Promise<ChatMessage[]> {
  const result = await searchMessagePage(query);
  return result.messages;
}
export const searchMessagePage = (query: string, page = 1) =>
  api<{ messages: ChatMessage[]; total: number; page: number; pages: number }>(`/api/messages/search?q=${encodeURIComponent(query)}&page=${page}`);

// === Notes ===

export async function getClientNotes(sessionId: string): Promise<ClientNote[]> {
  return api<ClientNote[]>(`/api/sessions/${sessionId}/notes`);
}

export async function createClientNote(params: {
  sessionId: string;
  operatorId: string;
  noteText: string;
}): Promise<ClientNote> {
  return api<ClientNote>(`/api/sessions/${params.sessionId}/notes`, {
    method: "POST",
    body: JSON.stringify({
      operator_id: params.operatorId,
      note: params.noteText,
    }),
  });
}

export async function updateClientNote(noteId: string, note: string) {
  return api(`/api/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify({ note }),
  });
}

export async function deleteClientNote(noteId: string) {
  return api(`/api/notes/${noteId}`, { method: "DELETE" });
}

// === Tags ===

export async function getAllChatTags(): Promise<ChatTag[]> {
  return api<ChatTag[]>("/api/tags");
}

export async function createChatTag(params: { name: string; color: string }): Promise<ChatTag> {
  return api<ChatTag>("/api/tags", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getSessionTags(sessionId: string): Promise<ChatSessionTag[]> {
  return api<ChatSessionTag[]>(`/api/sessions/${sessionId}/tags`);
}

export async function attachTagToSession(params: { sessionId: string; tagId: string }) {
  return api(`/api/sessions/${params.sessionId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tag_id: params.tagId }),
  });
}

export async function detachTagFromSession(sessionId: string, tagId: string) {
  return api(`/api/sessions/${sessionId}/tags/${tagId}`, { method: "DELETE" });
}

// === Status ===

export async function changeSessionStatus(sessionId: string, status: string, operatorId?: string) {
  return api(`/api/sessions/${sessionId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, operator_id: operatorId }),
  });
}

// === Activity Logs ===

export async function getSessionActivityLogs(sessionId: string) {
  return api(`/api/sessions/${sessionId}/activity`);
}

// ─── Upload image ───
export async function uploadMessageImage(
  sessionId: string,
  operatorId: string,
  file: File,
  clientId: string = crypto.randomUUID(),
  isInternal = false,
): Promise<any> {
  const formData = new FormData();
  formData.append("operator_id", operatorId);
  formData.append("is_internal", String(isInternal));
  formData.append("file", file);

  return api<ChatMessage>(`/api/sessions/${sessionId}/messages/upload`, { method: "POST", headers: { "X-Client-Message-Id": clientId }, body: formData });
}

// === Reactions ===

export async function toggleReaction(messageId: string, operatorId: string, emoji: string) {
  return api(`/api/messages/${messageId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji, operator_id: operatorId }),
  });
}

export async function getReactions(messageId: string) {
  return api<Array<{ id: string; message_id: string; operator_id: string; emoji: string; operator_name: string }>>(`/api/messages/${messageId}/reactions`);
}

// === Edit / Delete ===

export async function editMessage(messageId: string, message: string, operatorId: string) {
  return api(`/api/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ message, operator_id: operatorId }),
  });
}

export async function deleteMessage(messageId: string, operatorId: string) {
  return api(`/api/messages/${messageId}`, {
    method: "DELETE",
    body: JSON.stringify({ operator_id: operatorId }),
  });
}

// === Visitor History ===

export interface VisitorSessionsResponse {
  sessions: ChatSession[];
  total_sessions: number;
  first_seen: string | null;
  last_seen: string | null;
}

export interface VisitorSummaryResponse {
  total_sessions: number;
  total_messages: number;
  avg_rating: number | null;
  operators: Array<{ id: string; name: string }>;
}

export async function getVisitorSessions(visitorId: string): Promise<VisitorSessionsResponse> {
  return api<VisitorSessionsResponse>(`/api/visitors/${encodeURIComponent(visitorId)}/sessions`);
}

export async function getVisitorSummary(visitorId: string): Promise<VisitorSummaryResponse> {
  return api<VisitorSummaryResponse>(`/api/visitors/${encodeURIComponent(visitorId)}/summary`);
}

// === Priority ===

export async function setSessionPriority(sessionId: string, priority?: string, isVip?: boolean, operatorId?: string) {
  return api(`/api/sessions/${sessionId}/priority`, {
    method: "PATCH",
    body: JSON.stringify({ priority, is_vip: isVip, operator_id: operatorId }),
  });
}

// === Queue ===

export async function getQueueSessions(): Promise<ChatSession[]> {
  return api<ChatSession[]>("/api/sessions/queue");
}

// === Auto-responses ===

export interface AutoResponseRule {
  id: string;
  trigger_type: string;
  delay_seconds: number;
  message: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function getAutoResponses(): Promise<AutoResponseRule[]> {
  return api<AutoResponseRule[]>("/api/auto-responses");
}

export async function createAutoResponse(data: {
  trigger_type: string;
  delay_seconds: number;
  message: string;
  is_active?: boolean;
}): Promise<AutoResponseRule> {
  return api<AutoResponseRule>("/api/auto-responses", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAutoResponse(id: string, data: Partial<{
  trigger_type: string;
  delay_seconds: number;
  message: string;
  is_active: boolean;
}>): Promise<AutoResponseRule> {
  return api<AutoResponseRule>(`/api/auto-responses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteAutoResponse(id: string): Promise<void> {
  await api(`/api/auto-responses/${id}`, { method: "DELETE" });
}

// === Proactive Invitations ===

export interface ProactiveInvitation {
  id: string;
  visitor_id: string;
  operator_id: string | null;
  operator_name?: string;
  operator_avatar?: string;
  message: string;
  status: "sent" | "accepted" | "declined";
  created_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  auto_generated: boolean;
}

export async function sendInvitation(params: {
  visitorId: string;
  operatorId: string;
  message?: string;
}): Promise<{ ok: boolean; invitation?: ProactiveInvitation; error?: string }> {
  return api(`/api/invitations`, {
    method: "POST",
    body: JSON.stringify({
      visitor_id: params.visitorId,
      operator_id: params.operatorId,
      message: params.message,
    }),
  });
}

export async function getInvitations(status?: string): Promise<ProactiveInvitation[]> {
  const query = status ? `?status=${status}` : "";
  return api<ProactiveInvitation[]>(`/api/invitations${query}`);
}

export async function acceptInvitation(id: string) {
  return api(`/api/invitations/${id}/accept`, { method: "PATCH" });
}

export async function declineInvitation(id: string) {
  return api(`/api/invitations/${id}/decline`, { method: "PATCH" });
}

export async function updateContact(sessionId: string, contact: {visitor_name:string|null;visitor_email:string|null;visitor_phone:string|null;contact_revision:number}) {
  return api<ChatSession>(`/api/sessions/${sessionId}/contact`,{method:"PATCH",body:JSON.stringify(contact)});
}
export const getChatSession = (id: string) => api<ChatSession>(`/api/sessions/${id}`);
