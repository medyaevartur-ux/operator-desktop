import type { Server } from 'socket.io';
import { pool, transaction } from '../db.js';
import { enrichMessages } from './messages.js';
import { notificationDecision, retryDelay } from './notification-policy.js';
import { distributeQueue } from './routing.js';

export type NotificationPayload = { event_id: string; delivery_id: string; session_id: string; message_id?: string; title: string; body: string; kind: string };
const MAX_SENDS = 5;                              // отправок одного уведомления без подтверждения
const OFFLINE_GIVE_UP_MS = 24 * 60 * 60 * 1000;  // сколько ждём закрытое приложение на компьютере
export type DeliveryTransport = (device: any, payload: NotificationPayload) => Promise<string>;

export async function captureEscalations() {
  await pool.query(`INSERT INTO chat_v8_events(session_id,kind,dedupe_key,payload)
    SELECT s.id,'escalation','escalation:'||last.id::text,jsonb_build_object('message_id',last.id)
    FROM widget_chat_sessions s
    JOIN LATERAL (SELECT id,sender,created_at FROM widget_chat_messages m WHERE m.session_id=s.id AND m.is_internal IS NOT TRUE AND m.is_deleted IS NOT TRUE ORDER BY m.created_at DESC,m.id DESC LIMIT 1) last ON true
    CROSS JOIN chat_v8_routing_settings config
    WHERE s.status<>'closed' AND last.sender='visitor' AND last.created_at<now()-make_interval(mins=>config.escalation_minutes)
    ON CONFLICT(dedupe_key) DO NOTHING`);
}

async function eventAudience(sessionId: string, kind: string) {
  const { rows } = await pool.query(`SELECT d.*,o.status AS operator_status,COALESCE(to_jsonb(p),'{}'::jsonb) AS preferences
    FROM chat_v8_devices d JOIN chat_operators o ON o.id=d.operator_id
    LEFT JOIN chat_v8_notification_preferences p ON p.operator_id=o.id
    WHERE d.enabled AND o.is_active AND d.last_seen_at>now()-interval '30 days' AND (
      ($2='escalation' AND o.role IN ('admin','supervisor')) OR
      o.id=(SELECT operator_id FROM widget_chat_sessions WHERE id=$1) OR
      (NOT EXISTS(SELECT 1 FROM widget_chat_sessions s JOIN chat_operators assigned ON assigned.id=s.operator_id WHERE s.id=$1 AND assigned.is_active)
        AND (o.is_online OR NOT EXISTS(SELECT 1 FROM chat_operators online WHERE online.is_active AND online.is_online AND online.status='online')))
    )`, [sessionId, kind]);
  return rows;
}

export async function publishPendingEvents(io: Server) {
  const events = await transaction(async client => {
    const { rows } = await client.query(`SELECT * FROM chat_v8_events WHERE (socket_published_at IS NULL OR notifications_enqueued_at IS NULL)
      AND (locked_until IS NULL OR locked_until<now()) ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`);
    if (rows.length) await client.query("UPDATE chat_v8_events SET locked_until=now()+interval '1 minute' WHERE id=ANY($1)", [rows.map(row => row.id)]);
    return rows;
  });
  for (const event of events) {
    try {
      const { rows } = await pool.query('SELECT * FROM widget_chat_messages WHERE id=$1', [event.message_id || event.payload?.message_id]);
      const message = rows[0];
      if (!event.socket_published_at) {
        if (message) {
          const audience = message.is_internal ? io.to('operators') : io.to('operators').to(`session:${event.session_id}`);
          if (event.kind === 'message.created') {
            const [enriched] = await enrichMessages([message]);
            audience.emit('new_message', enriched);
          } else if (event.kind === 'message.updated') {
            audience.emit(message.is_deleted ? 'message_deleted' : 'message_updated', { message_id: message.id, session_id: message.session_id });
          } else if (event.kind === 'reaction.updated') {
            audience.emit('reaction_updated', { message_id: message.id, session_id: message.session_id });
          } else if (event.kind === 'message.status') {
            audience.emit('message_status_changed', { session_id: message.session_id, messages: [{ id: message.id, status: message.is_read ? 'read' : message.status, delivered_at: message.delivered_at, read_at: message.read_at }] });
          }
          io.to('operators').emit('session_updated', { session_id: event.session_id });
        }
        if(event.kind==='assignment')io.to('operators').emit('session_updated',{session_id:event.session_id});
        await pool.query('UPDATE chat_v8_events SET socket_published_at=now() WHERE id=$1', [event.id]);
      }
      if (!event.notifications_enqueued_at) {
        if ((event.kind === 'message.created' && message?.sender === 'visitor' && !message.is_internal && !message.is_deleted) || ['escalation','operator.request','assignment'].includes(event.kind)) {
          for (const device of await eventAudience(event.session_id, event.kind)) {
            const reason = notificationDecision(device.preferences, device.operator_status, event.kind);
            await pool.query(`INSERT INTO chat_v8_deliveries(event_id,device_id,operator_id,status,error_code)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,device_id) DO NOTHING`,
              [event.id, device.id, device.operator_id, reason ? 'cancelled' : 'pending', reason]);
          }
        }
        await pool.query('UPDATE chat_v8_events SET notifications_enqueued_at=now() WHERE id=$1', [event.id]);
      }
      await pool.query('UPDATE chat_v8_events SET locked_until=NULL WHERE id=$1', [event.id]);
    } catch { await pool.query("UPDATE chat_v8_events SET locked_until=now()+interval '15 seconds' WHERE id=$1", [event.id]); }
  }
}

export async function deliverPendingNotifications(io: Server, deliverPush: DeliveryTransport) {
  const jobs = await transaction(async client => {
    const { rows } = await client.query(`SELECT * FROM chat_v8_deliveries WHERE status IN ('pending','sent')
      AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now()) AND acknowledged_at IS NULL
      ORDER BY next_attempt_at LIMIT 30 FOR UPDATE SKIP LOCKED`);
    if (rows.length) await client.query("UPDATE chat_v8_deliveries SET locked_until=now()+interval '2 minutes' WHERE id=ANY($1)", [rows.map(row => row.id)]);
    return rows;
  });
  for (const job of jobs) {
    // Все отправки сделаны, а подтверждения за окно ожидания так и не пришло — только теперь это ошибка.
    if (job.status === 'sent' && job.attempts >= MAX_SENDS) {
      await pool.query("UPDATE chat_v8_deliveries SET status='failed',error_code='not_acknowledged',locked_until=NULL WHERE id=$1 AND acknowledged_at IS NULL", [job.id]);
      continue;
    }
    const { rows } = await pool.query(`SELECT d.*,o.status AS operator_status,o.is_active,e.kind,e.session_id,e.message_id,e.payload,
      s.visitor_name,s.status AS session_status,m.message,m.is_internal,m.is_deleted,m.is_read,
      (SELECT sender FROM widget_chat_messages latest WHERE latest.session_id=s.id AND latest.is_internal IS NOT TRUE AND latest.is_deleted IS NOT TRUE ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) AS latest_sender,
      COALESCE(to_jsonb(p),'{}'::jsonb) AS preferences
      FROM chat_v8_devices d JOIN chat_operators o ON o.id=d.operator_id
      JOIN chat_v8_events e ON e.id=$2 JOIN widget_chat_sessions s ON s.id=e.session_id
      LEFT JOIN widget_chat_messages m ON m.id=COALESCE(e.message_id,(e.payload->>'message_id')::uuid)
      LEFT JOIN chat_v8_notification_preferences p ON p.operator_id=o.id
      WHERE d.id=$1 AND d.operator_id=$3`, [job.device_id, job.event_id, job.operator_id]);
    const device = rows[0];
    const cancellation = !device || !device.enabled || !device.is_active ? 'device_inactive'
      : device.session_status === 'closed' || device.is_deleted || device.is_internal || device.is_read || (device.kind === 'escalation' && device.latest_sender !== 'visitor') ? 'no_longer_actionable'
      : notificationDecision(device.preferences, device.operator_status, device.kind);
    if (cancellation) {
      await pool.query("UPDATE chat_v8_deliveries SET status='cancelled',error_code=$2,locked_until=NULL WHERE id=$1", [job.id, cancellation]);
      continue;
    }
    const payload: NotificationPayload = {
      event_id: job.event_id, delivery_id: job.id, session_id: device.session_id,
      message_id: device.message_id || undefined, kind: device.kind,
      title: device.kind === 'escalation' ? 'Клиент ждёт ответа' : (device.payload?.title || device.visitor_name || 'Новое обращение'),
      body: device.preferences.show_preview === false ? 'Новое сообщение в Живой Сказке' : String(device.message || device.payload?.body || 'Проверьте очередь диалогов').slice(0, 300),
    };
    let error: string | null = null, providerId: string | null = null;
    const installationRoom = `installation:${device.installation_id}`;
    if (device.provider !== 'socket' && !job.sent_at && io.sockets.adapter.rooms.get(installationRoom)?.size) {
      // Give the foreground client a chance to display/ack before waking the
      // external push transport. A lost socket still falls back after 5 seconds.
      io.to(installationRoom).emit('notification_event', payload);
      await pool.query("UPDATE chat_v8_deliveries SET status='sent',sent_at=now(),last_attempt_at=now(),channel='socket',next_attempt_at=now()+interval '5 seconds',locked_until=NULL WHERE id=$1 AND acknowledged_at IS NULL", [job.id]);
      continue;
    }
    try {
      if (device.provider === 'socket') {
        const room = `installation:${device.installation_id}`;
        if (!io.sockets.adapter.rooms.get(room)?.size) throw Object.assign(new Error(), { code: 'device_offline' });
        io.to(room).emit('notification_event', payload);
      } else {
        providerId = await deliverPush(device, payload);
      }
    } catch (failure: any) { error = String(failure.code || 'provider_unavailable').slice(0, 120); }
    // Приложение, закрытое больше суток, не ждём бесконечно: задание снимается с понятной причиной.
    if (error === 'device_offline' && Date.now() - new Date(job.created_at).getTime() > OFFLINE_GIVE_UP_MS) {
      await pool.query("UPDATE chat_v8_deliveries SET status='cancelled',error_code='device_offline',last_attempt_at=now(),channel='socket',locked_until=NULL WHERE id=$1 AND acknowledged_at IS NULL", [job.id]);
      continue;
    }
    const terminal = !!error && /not-registered|invalid-registration|invalid-subscription|not_configured/.test(error);
    const attempts = job.attempts + (error === 'device_offline' ? 0 : 1);
    const failed = terminal || (!!error && attempts >= MAX_SENDS);
    await pool.query(`UPDATE chat_v8_deliveries SET status=$2,attempts=$3,provider_message_id=$4::text,error_code=$5::text,
      sent_at=CASE WHEN $5::text IS NULL THEN now() ELSE sent_at END,last_attempt_at=now(),channel=$7,
      next_attempt_at=now()+make_interval(secs=>$6),locked_until=NULL WHERE id=$1 AND acknowledged_at IS NULL`,
      [job.id, failed ? 'failed' : error ? 'pending' : 'sent', attempts, providerId, error, error ? retryDelay(attempts) : device.provider === 'socket' ? 30 : 120, device.provider]);
    if (terminal && !/not_configured/.test(error!)) await pool.query('UPDATE chat_v8_devices SET enabled=false WHERE id=$1', [device.id]);
  }
}

export function startDeliveryWorker(io: Server, transport: DeliveryTransport) {
  let running = false, stopped = false, ticks = 0;
  let active: Promise<void> = Promise.resolve();
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      if (ticks++ % 15 === 0) await captureEscalations();
      if (ticks % 3 === 0) await distributeQueue();
      await publishPendingEvents(io);
      await deliverPendingNotifications(io, transport);
    } catch { console.error('[delivery] Worker iteration deferred'); }
    finally { running = false; }
  };
  const run = () => { if (!running && !stopped) active = tick(); };
  const timer = setInterval(run, 1000);
  run();
  return async () => { stopped = true; clearInterval(timer); await active; };
}
