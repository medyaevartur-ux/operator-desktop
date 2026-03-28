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
export async function transferOperatorToSession(sessionId: string, operatorId: string, fromOperatorId?: string) {
  return api(`/api/sessions/${sessionId}/transfer`, {
    method: "PATCH",
    body: JSON.stringify({ operator_id: operatorId, from_operator_id: fromOperatorId }),
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

export async function sendOperatorMessage(params: {
  sessionId: string;
  operatorId: string;
  message: string;
  replyToId?: string;
}): Promise<ChatMessage> {
  return api<ChatMessage>(`/api/sessions/${params.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      operator_id: params.operatorId,
      message: params.message,
      reply_to_id: params.replyToId || undefined,
    }),
  });
}

export async function searchMessages(query: string): Promise<ChatMessage[]> {
  return api<ChatMessage[]>(`/api/messages/search?q=${encodeURIComponent(query)}`);
}

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
  file: File
): Promise<any> {
  const formData = new FormData();
  formData.append("operator_id", operatorId);
  formData.append("file", file);

  const token = localStorage.getItem("chat_token");
  const base = import.meta.env.VITE_API_URL || "http://localhost:3010";

  const res = await fetch(`${base}/api/sessions/${sessionId}/messages/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }

  return res.json();
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

export async function setSessionPriority(sessionId: string, priority: string, isVip?: boolean, operatorId?: string) {
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