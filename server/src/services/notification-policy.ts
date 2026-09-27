export type NotificationPreferences = { enabled?: boolean; new_messages?: boolean; escalation?: boolean; show_preview?: boolean; dnd_start?: string | null; dnd_end?: string | null; timezone?: string };
export function inQuietHours(preferences: NotificationPreferences, now = new Date()): boolean {
  if (!preferences.dnd_start || !preferences.dnd_end) return false;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: preferences.timezone || 'Asia/Yekaterinburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const { dnd_start: start, dnd_end: end } = preferences;
  return start < end ? time >= start && time < end : time >= start || time < end;
}
export function notificationDecision(preferences: NotificationPreferences, status: string, kind: string, now = new Date()) {
  if (preferences.enabled === false) return 'disabled';
  if (status === 'dnd' || inQuietHours(preferences, now)) return 'dnd';
  if (kind === 'escalation' && preferences.escalation === false) return 'event_disabled';
  if (kind !== 'escalation' && preferences.new_messages === false) return 'event_disabled';
  return null;
}
export function retryDelay(attempt: number) { return Math.min(15 * 60, 15 * 2 ** Math.max(0, attempt - 1)); }

export function publicPushPayload(payload:{event_id:string;delivery_id:string;session_id:string;message_id?:string}):Record<string,string> {
  const data:Record<string,string>={event_id:payload.event_id,delivery_id:payload.delivery_id,session_id:payload.session_id,title:'Живая Сказка',body:'Новое сообщение'};
  if(payload.message_id)data.message_id=payload.message_id;
  return data;
}
