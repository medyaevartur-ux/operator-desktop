import type { ChatMessage, ChatSession } from "@/types/chat";

export type InboxFilter = "all" | "ai" | "with_operator" | "closed";

/* ═══ SLA: чаты без ответа оператора ═══ */

export type SlaState = "none" | "warning" | "overdue";

/**
 * Сколько минут диалог ждёт ответа оператора. Возвращает null, если ответ не ждётся
 * (чат закрыт, либо последнее сообщение НЕ от посетителя).
 */
export function getSlaMinutes(session: ChatSession | null, now: number = Date.now()): number | null {
  if (!session) return null;
  if (session.status === "closed") return null;
  if (session.last_message_sender !== "visitor") return null;
  const ts = session.last_message_at ? new Date(session.last_message_at).getTime() : NaN;
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((now - ts) / 60000));
}

export function getSlaState(minutes: number | null, warnMin: number, overdueMin: number): SlaState {
  if (minutes == null) return "none";
  if (minutes >= overdueMin) return "overdue";
  if (minutes >= warnMin) return "warning";
  return "none";
}

/** Компактная подпись длительности ожидания: 45м / 3ч / 8д. */
export function formatSlaLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}м`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}ч`;
  return `${Math.floor(h / 24)}д`;
}

export function formatChatTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function getSessionDisplayName(name: string | null, visitorId: string) {
  if (name?.trim()) {
    return name.trim();
  }

  return visitorId;
}

export function getSessionStatusLabel(status: string) {
  if (status === "with_operator") {
    return "С оператором";
  }

  if (status === "ai") {
    return "AI";
  }

  if (status === "closed") {
    return "Закрыт";
  }

  return status;
}

/** Автосообщение сайта: имя, от которого его видел посетитель; для остальных сообщений — null. */
export function autoMessageSender(message: Pick<ChatMessage, "sender" | "metadata">): string | null {
  if (message.sender !== "ai") return null;
  let meta = message.metadata;
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { return null; } }
  return meta && typeof meta === "object" && meta.kind === "auto_message" ? meta.sender_name?.trim() || "Команда" : null;
}

export function getSenderLabel(sender: string) {
  if (sender === "visitor") {
    return "Клиент";
  }

  if (sender === "operator") {
    return "Оператор";
  }

  if (sender === "ai") {
    return "AI";
  }

  if (sender === "system") {
    return "Система";
  }

  return sender;
}