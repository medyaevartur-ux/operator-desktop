import type { ChatSession } from "@/types/chat";
import type { InboxFilter } from "./inbox.utils";

/** Одна функция отбора и группировки диалогов для компьютера и телефона. */
export interface ConversationGroup { key: string; label: string; items: ChatSession[] }

export const LIST_FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "all", label: "Входящие" },
  { key: "with_operator", label: "Мои" },
  { key: "closed", label: "Все" },
];

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() || 0 : 0);
const activity = (session: ChatSession) => time(session.last_message_at) || time(session.created_at);
const newestFirst = (a: ChatSession, b: ChatSession) => activity(b) - activity(a);

export const isClosed = (session: ChatSession) => session.status === "closed";

/** Ждёт ответа человека: последнее слово за посетителем или он явно позвал оператора. */
export function isAwaitingReply(session: ChatSession) {
  if (isClosed(session)) return false;
  return session.status === "waiting_operator" || session.last_message_sender === "visitor";
}

/** Сколько минут посетитель ждёт ответа; null, если ответа не ждут. */
export function waitingMinutes(session: ChatSession, now = Date.now()): number | null {
  if (!isAwaitingReply(session)) return null;
  const since = time(session.last_message_at) || time(session.queued_at) || time(session.created_at);
  return since ? Math.max(0, Math.floor((now - since) / 60_000)) : null;
}

function matches(session: ChatSession, query: string) {
  const haystack = [
    session.visitor_name, session.visitor_email, session.visitor_phone, session.visitor_id,
    session.current_page, session.current_page_title, session.city, session.last_message_text,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

function dayGroups(items: ChatSession[], now: number): ConversationGroup[] {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const startToday = today.getTime(), startYesterday = startToday - 86_400_000, startWeek = startToday - 6 * 86_400_000;
  const buckets: ConversationGroup[] = [
    { key: "today", label: "Сегодня", items: [] },
    { key: "yesterday", label: "Вчера", items: [] },
    { key: "week", label: "На этой неделе", items: [] },
    { key: "older", label: "Ранее", items: [] },
  ];
  for (const session of [...items].sort(newestFirst)) {
    const at = activity(session);
    buckets[at >= startToday ? 0 : at >= startYesterday ? 1 : at >= startWeek ? 2 : 3].items.push(session);
  }
  return buckets.filter(group => group.items.length);
}

export function groupConversations(
  sessions: ChatSession[],
  { filter, query = "", me, now = Date.now() }: { filter: InboxFilter; query?: string; me?: string | null; now?: number },
): ConversationGroup[] {
  const text = query.trim().toLowerCase();
  if (text) {
    const found = sessions.filter(session => matches(session, text)).sort(newestFirst);
    return found.length ? [{ key: "search", label: "Найдено", items: found }] : [];
  }
  if (filter === "closed") return dayGroups(sessions, now);
  if (filter === "with_operator") {
    const mine = sessions.filter(session => !!me && session.operator_id === me && !isClosed(session)).sort(newestFirst);
    return mine.length ? [{ key: "mine", label: "В работе", items: mine }] : [];
  }
  // «Входящие»: всё, что требует внимания и не взято коллегой.
  const waiting: ChatSession[] = [], mine: ChatSession[] = [], bot: ChatSession[] = [];
  for (const session of sessions) {
    if (isClosed(session)) continue;
    if (session.operator_id && session.operator_id !== me) continue;
    if (session.operator_id && session.operator_id === me) mine.push(session);
    else if (isAwaitingReply(session)) waiting.push(session);
    else if (session.status === "ai") bot.push(session);
    else waiting.push(session);
  }
  const longestWaitFirst = (a: ChatSession, b: ChatSession) => (waitingMinutes(b, now) ?? -1) - (waitingMinutes(a, now) ?? -1) || newestFirst(a, b);
  return [
    { key: "waiting", label: "Ждут ответа", items: waiting.sort(longestWaitFirst) },
    { key: "mine", label: "Мои", items: mine.sort(newestFirst) },
    { key: "bot", label: "У бота", items: bot.sort(newestFirst) },
  ].filter(group => group.items.length);
}

/** Очередь: открытые диалоги без ответственного. */
export const queueCount = (sessions: ChatSession[]) => sessions.filter(session => !session.operator_id && !isClosed(session) && session.status !== "ai").length;

/** Короткое время для списка: «сейчас», «5 мин», «14:20», «вчера», «12.09». */
export function shortTime(value: string | null | undefined, now = Date.now()) {
  const at = time(value);
  if (!at) return "";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  const date = new Date(at), today = new Date(now);
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return "вчера";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

/** «ждёт 7 мин» / «ждёт 2 ч» */
export function waitingLabel(minutes: number) {
  if (minutes < 60) return `ждёт ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `ждёт ${hours} ч` : `ждёт ${Math.floor(hours / 24)} дн`;
}
