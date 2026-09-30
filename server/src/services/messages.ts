import { z } from 'zod';
import { pool, transaction } from '../db.js';
import type { OperatorClaims } from '../core/security.js';
import { hydrateAttachments } from './private-files.js';
import { lockOperator, activeOperator } from './routing.js';

const messageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
  client_message_id: z.string().uuid().optional(),
  reply_to_id: z.string().uuid().nullable().optional(),
  is_internal: z.boolean().default(false),
});
export type MessageActor = { operator: OperatorClaims } | { visitorId: string };
export type MessageInput = z.input<typeof messageSchema>;
export type MessageMedia = { type: 'image' | 'file' | 'audio'; attachments: unknown[]; sha256: string };
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export async function createMessage(sessionId: string, input: MessageInput, actor: MessageActor, media?: MessageMedia) {
  const body = messageSchema.parse(input);
  const operator = 'operator' in actor ? actor.operator : null;
  const sender = operator ? 'operator' : 'visitor';
  if (!operator && body.is_internal) throw fail(403, 'Посетитель не может создавать внутренние заметки');
  return transaction(async client => {
    if (operator && !body.is_internal) await lockOperator(client, operator.id);
    const { rows: sessions } = await client.query('SELECT id, visitor_id, operator_id, status FROM widget_chat_sessions WHERE id=$1 FOR UPDATE', [sessionId]);
    const session = sessions[0];
    if (!session) throw fail(404, 'Диалог не найден');
    if (!operator && (!('visitorId' in actor) || actor.visitorId !== session.visitor_id)) throw fail(403, 'Нет доступа к диалогу');
    if (body.client_message_id) {
      const { rows } = await client.query('SELECT * FROM widget_chat_messages WHERE session_id=$1 AND client_message_id=$2', [sessionId, body.client_message_id]);
      const existing = rows[0];
      if (existing) {
        if (existing.sender !== sender || (operator && existing.operator_id !== operator.id) || existing.message !== body.message ||
            !!existing.is_internal !== body.is_internal || (existing.reply_to_id || null) !== (body.reply_to_id || null) ||
            (media && existing.metadata?.sha256 !== media.sha256)) throw fail(409, 'Этот идентификатор уже использован другим сообщением');
        return { message: existing, created: false };
      }
    }
    if (session.status === 'closed' && !body.is_internal) throw fail(409, 'Диалог завершён. Откройте его снова перед ответом.');
    if (operator && operator.role === 'operator' && session.operator_id && session.operator_id !== operator.id) throw fail(403, 'Диалог ведёт другой оператор');
    if (operator && !body.is_internal && !session.operator_id) {
      await activeOperator(client,operator.id);
      await client.query("UPDATE widget_chat_sessions SET operator_id=$2,status='with_operator',queued_at=NULL,operator_joined_at=now() WHERE id=$1",[sessionId,operator.id]);
    }
    if (!operator) {
      const blocked = await client.query('SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1', [session.visitor_id]);
      if (blocked.rowCount) throw fail(403, 'Отправка сообщений ограничена');
    }
    if (body.reply_to_id) {
      const { rows } = await client.query('SELECT session_id,is_internal,is_deleted FROM widget_chat_messages WHERE id=$1', [body.reply_to_id]);
      if (!rows[0] || rows[0].session_id !== sessionId || rows[0].is_deleted || (!body.is_internal && rows[0].is_internal)) throw fail(400, 'Нельзя процитировать это сообщение');
    }
    const { rows } = await client.query(
      `INSERT INTO widget_chat_messages(session_id,sender,operator_id,message,message_type,status,reply_to_id,is_internal,client_message_id,attachments,metadata)
       VALUES($1,$2,$3,$4,$5,'sent',$6,$7,$8,$9,$10) RETURNING *`,
      [sessionId, sender, operator?.id || null, body.message, media?.type || 'text', body.reply_to_id || null, body.is_internal, body.client_message_id || null,
        media ? JSON.stringify(media.attachments) : null, media ? JSON.stringify({ sha256: media.sha256 }) : null],
    );
    if (!body.is_internal) {
      await client.query(
        `UPDATE widget_chat_sessions SET last_message_at=now(),updated_at=now(),messages_count=COALESCE(messages_count,0)+1,
         unread_count=CASE WHEN $2='visitor' THEN COALESCE(unread_count,0)+1 ELSE unread_count END,
         operator_messages_count=COALESCE(operator_messages_count,0)+CASE WHEN $2='operator' THEN 1 ELSE 0 END,
         first_response_at=CASE WHEN $2='operator' THEN COALESCE(first_response_at,now()) ELSE first_response_at END WHERE id=$1`,
        [sessionId, sender],
      );
    }
    if (operator) await client.query('INSERT INTO operator_activity_logs(operator_id,action,session_id,meta) VALUES($1,$2,$3,$4)', [operator.id, body.is_internal ? 'internal_note' : 'send_message', sessionId, JSON.stringify({ message_id: rows[0].id })]);
    return { message: rows[0], created: true };
  });
}

export async function enrichMessages(messages: any[]) {
  if (!messages.length) return [];
  const ids = messages.map(message => message.id);
  const [reactions, replies] = await Promise.all([
    pool.query('SELECT r.*,o.name AS operator_name FROM message_reactions r LEFT JOIN chat_operators o ON o.id=r.operator_id WHERE r.message_id=ANY($1)', [ids]),
    pool.query('SELECT id,message,sender,operator_id,is_internal,is_deleted FROM widget_chat_messages WHERE id=ANY($1)', [messages.map(message => message.reply_to_id).filter(Boolean)]),
  ]);
  return messages.map(message => {
    const reply = replies.rows.find(row => row.id === message.reply_to_id);
    return { ...hydrateAttachments(message), reactions: reactions.rows.filter(row => row.message_id === message.id),
      reply_to_message: reply && !reply.is_deleted && (message.is_internal || !reply.is_internal) ? reply.message : null,
      reply_to_sender: reply?.sender || null };
  });
}
