import { notificationDecision } from "../services/notification-policy.js";
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, transaction } from '../db.js';
import { operatorOf, requireRole, uuid } from '../core/security.js';
import { permittedPushEndpoint } from '../services/push.js';

const subscriptionSchema=z.object({endpoint:z.string().url().max(2000).refine(permittedPushEndpoint),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().min(16).max(256),auth:z.string().min(8).max(256)})});
const registrationSchema=z.object({installation_id:uuid,platform:z.enum(['windows','android','web']),provider:z.enum(['socket','fcm','webpush']),token:z.string().min(16).max(4096).optional(),subscription:subscriptionSchema.optional(),app_version:z.string().max(64).default(''),name:z.string().max(100).default('')});
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
// Сведения, которые знает только само устройство. Без текста переписки и без персональных данных.
const diagnosticsSchema=z.object({
  permission:z.enum(['granted','denied','default','unknown']).optional(),
  channel_enabled:z.boolean().nullable().optional(),
  battery_optimized:z.boolean().nullable().optional(),
  background_restricted:z.boolean().nullable().optional(),
  quiet_mode:z.string().max(40).nullable().optional(),
  toast_setting:z.string().max(40).nullable().optional(),
  push_registered:z.boolean().nullable().optional(),
  activation_ready:z.boolean().optional(),
  queued_actions:z.number().int().min(0).max(100000).optional(),
  app_version:z.string().max(64).optional(),
}).strict();

const ACK_RANK:Record<string,number>={displayed:1,opened:2,read:3};
/** Итог подтверждения только растёт; неуспех не перекрывает уже подтверждённую доставку. */
export function nextAck(current:{status:string;ack_outcome:string|null},outcome:string){
  if(ACK_RANK[outcome]){
    const keep=(ACK_RANK[current.ack_outcome||'']||0)>=ACK_RANK[outcome];
    return {status:'acked',ack_outcome:keep?current.ack_outcome:outcome,error_code:null};
  }
  if(current.status==='acked')return null;
  return outcome==='blocked'
    ? {status:'failed',ack_outcome:'blocked',error_code:'notification_permission_denied'}
    : {status:'cancelled',ack_outcome:'suppressed',error_code:'dnd'};
}
const preferenceSchema=z.object({enabled:z.boolean(),new_messages:z.boolean(),escalation:z.boolean(),show_preview:z.boolean(),dnd_start:time,dnd_end:time,timezone:z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}})}).refine(value=>!!value.dnd_start===!!value.dnd_end && (!value.dnd_start || value.dnd_start!==value.dnd_end));

export async function registerDevice(request:any,input:unknown) {
  const data=registrationSchema.parse(input),operator=operatorOf(request);
  if(data.installation_id!==operator.installation_id)throw Object.assign(new Error('Устройство не соответствует сеансу'),{statusCode:403});
  if((data.provider==='fcm'&&!data.token)||(data.provider==='webpush'&&!data.subscription))throw Object.assign(new Error('Не указан адрес доставки'),{statusCode:400});
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.installation_id]);
    const live = await client.query('SELECT 1 FROM chat_v8_auth_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()', [operator.sid]);
    if (!live.rowCount) throw Object.assign(new Error('Сеанс завершён'),{statusCode:401});
    if(data.token)await client.query('UPDATE chat_v8_devices SET enabled=false WHERE token=$1 AND installation_id<>$2 AND operator_id=$3',[data.token,data.installation_id,operator.id]);
    const {rows}=await client.query(`INSERT INTO chat_v8_devices(installation_id,operator_id,platform,provider,token,subscription,app_version,name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(installation_id) DO UPDATE SET operator_id=EXCLUDED.operator_id,platform=EXCLUDED.platform,
      provider=EXCLUDED.provider,token=EXCLUDED.token,subscription=EXCLUDED.subscription,app_version=EXCLUDED.app_version,name=EXCLUDED.name,enabled=true,last_seen_at=now()
      RETURNING id,installation_id,platform,provider,app_version,name,enabled,last_seen_at`,
      [data.installation_id,operator.id,data.platform,data.provider,data.token||null,data.subscription?JSON.stringify(data.subscription):null,data.app_version,data.name]);
    return rows[0];
  });
}

export function registerDeviceRoutes(app:FastifyInstance) {
  const auth={preHandler:[(app as any).authenticate]};
  app.post('/api/chat-v8/devices/register',auth,async request=>registerDevice(request,request.body));
  // Каждое устройство с фактами доставки: последняя попытка, подтверждение, очередь и сбои за сутки.
  app.get('/api/chat-v8/devices',auth,async request=>{
    const {rows}=await pool.query(`SELECT d.id,d.installation_id,d.platform,d.provider,d.app_version,d.name,d.enabled,d.last_seen_at,d.diagnostics,d.diagnostics_at,
        (d.token IS NOT NULL OR d.subscription IS NOT NULL) AS has_address,
        last.status AS last_status,last.error_code AS last_error,last.last_attempt_at,last.channel AS last_channel,
        ack.acknowledged_at AS last_ack_at,ack.ack_outcome AS last_ack_outcome,
        (SELECT count(*)::int FROM chat_v8_deliveries q WHERE q.device_id=d.id AND q.status IN ('pending','sent') AND q.acknowledged_at IS NULL) AS pending,
        (SELECT count(*)::int FROM chat_v8_deliveries f WHERE f.device_id=d.id AND f.status='failed' AND f.created_at>now()-interval '24 hours') AS failed_24h
      FROM chat_v8_devices d
      LEFT JOIN LATERAL (SELECT status,error_code,COALESCE(last_attempt_at,sent_at) AS last_attempt_at,channel FROM chat_v8_deliveries j WHERE j.device_id=d.id ORDER BY j.created_at DESC LIMIT 1) last ON true
      LEFT JOIN LATERAL (SELECT acknowledged_at,ack_outcome FROM chat_v8_deliveries a WHERE a.device_id=d.id AND a.acknowledged_at IS NOT NULL ORDER BY a.acknowledged_at DESC LIMIT 1) ack ON true
      WHERE d.operator_id=$1 ORDER BY d.last_seen_at DESC`,[operatorOf(request).id]);
    const io=(app as any).io;
    return rows.map(row=>({...row,socket_online:!!io?.sockets?.adapter?.rooms?.get('installation:'+row.installation_id)?.size}));
  });
  app.post('/api/chat-v8/devices/unregister',auth,async request=>{
    await pool.query('UPDATE chat_v8_devices SET enabled=false WHERE installation_id=$1 AND operator_id=$2',[operatorOf(request).installation_id,operatorOf(request).id]);return {ok:true};
  });
  // Пульс устройства: заодно принимает то, что знает только само устройство (разрешение ОС, канал, экономия батареи).
  // Ответ говорит клиенту, нужно ли перерегистрироваться, если сервер отключил устройство.
  app.post('/api/chat-v8/devices/heartbeat',auth,async request=>{
    const diagnostics=diagnosticsSchema.safeParse((request.body as any)?.diagnostics);
    const {rows}=await pool.query(`UPDATE chat_v8_devices SET last_seen_at=now(),
        diagnostics=CASE WHEN $3::jsonb IS NULL THEN diagnostics ELSE $3::jsonb END,
        diagnostics_at=CASE WHEN $3::jsonb IS NULL THEN diagnostics_at ELSE now() END
      WHERE installation_id=$1 AND operator_id=$2 RETURNING enabled,provider`,
      [operatorOf(request).installation_id,operatorOf(request).id,diagnostics.success?JSON.stringify(diagnostics.data):null]);
    return {ok:true,registered:rows.length>0,enabled:rows[0]?.enabled??false,provider:rows[0]?.provider??null};
  });
  const notificationsSql=`SELECT j.id AS delivery_id,e.id AS event_id,e.session_id,e.kind,e.message_id,
    COALESCE(s.visitor_name,'Новое обращение') AS title,COALESCE(to_jsonb(p),'{}'::jsonb) AS _preferences,o.status AS _status,
    CASE WHEN p.show_preview=false THEN 'Новое сообщение' ELSE COALESCE(m.message,e.payload->>'body','Новое сообщение') END AS body,j.created_at
    FROM chat_v8_deliveries j JOIN chat_v8_devices d ON d.id=j.device_id JOIN chat_v8_events e ON e.id=j.event_id
    JOIN chat_operators o ON o.id=j.operator_id JOIN widget_chat_sessions s ON s.id=e.session_id LEFT JOIN widget_chat_messages m ON m.id=e.message_id
    LEFT JOIN chat_v8_notification_preferences p ON p.operator_id=j.operator_id
    WHERE j.operator_id=$1 AND d.operator_id=$1 AND d.installation_id=$2 AND d.enabled
    AND s.status<>'closed' AND m.is_deleted IS NOT TRUE AND m.is_internal IS NOT TRUE AND m.is_read IS NOT TRUE AND j.status<>'cancelled'`;
  const visible=(rows:any[])=>rows.filter(row=>!notificationDecision(row._preferences,row._status,row.kind)).map(({_preferences,_status,...row})=>row);
  app.get('/api/chat-v8/notifications',auth,async request=>visible((await pool.query(notificationsSql+" AND j.acknowledged_at IS NULL AND j.status IN ('pending','sent','failed') AND j.created_at>now()-interval '7 days' ORDER BY j.created_at DESC LIMIT 100",[operatorOf(request).id,operatorOf(request).installation_id])).rows));
  app.get('/api/chat-v8/notifications/:id',auth,async(request,reply)=>{
    const id=uuid.parse((request.params as any).id);
    const {rows}=await pool.query(notificationsSql+' AND j.id=$3',[operatorOf(request).id,operatorOf(request).installation_id,id]);
    return visible(rows)[0]||reply.code(404).send({error:'Уведомление недоступно'});
  });
  // Подтверждение только уточняет итог: показано → открыто → прочитано. Поздний «заблокировано»
  // или двойное подтверждение (приложение + системный код) не откатывает уже подтверждённую доставку.
  app.post('/api/chat-v8/notifications/:id/ack',auth,async request=>{
    const id=uuid.parse((request.params as any).id);
    const {outcome}=z.object({outcome:z.enum(['displayed','opened','read','blocked','suppressed']).default('displayed')}).parse(request.body||{});
    await transaction(async client=>{
      const current=(await client.query(`SELECT j.status,j.ack_outcome FROM chat_v8_deliveries j JOIN chat_v8_devices d ON d.id=j.device_id
        WHERE j.id=$1 AND j.operator_id=$2 AND d.operator_id=$2 AND d.installation_id=$3 FOR UPDATE OF j`,[id,operatorOf(request).id,operatorOf(request).installation_id])).rows[0];
      if(!current)return;
      const next=nextAck(current,outcome);
      if(!next)return;
      await client.query('UPDATE chat_v8_deliveries SET status=$2,ack_outcome=$3,error_code=$4,acknowledged_at=COALESCE(acknowledged_at,now()),locked_until=NULL WHERE id=$1',
        [id,next.status,next.ack_outcome,next.error_code]);
    });
    return {ok:true};
  });
  app.get('/api/chat-v8/notification-preferences',auth,async request=>{
    const {rows}=await pool.query('SELECT * FROM chat_v8_notification_preferences WHERE operator_id=$1',[operatorOf(request).id]);
    return rows[0]||{enabled:true,new_messages:true,escalation:true,show_preview:true,dnd_start:null,dnd_end:null,timezone:'Asia/Yekaterinburg'};
  });
  app.put('/api/chat-v8/notification-preferences',auth,async request=>{
    const p=preferenceSchema.parse(request.body);
    await pool.query(`INSERT INTO chat_v8_notification_preferences(operator_id,enabled,new_messages,escalation,show_preview,dnd_start,dnd_end,timezone)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(operator_id) DO UPDATE SET enabled=EXCLUDED.enabled,new_messages=EXCLUDED.new_messages,
      escalation=EXCLUDED.escalation,show_preview=EXCLUDED.show_preview,dnd_start=EXCLUDED.dnd_start,dnd_end=EXCLUDED.dnd_end,timezone=EXCLUDED.timezone,updated_at=now()`,
      [operatorOf(request).id,p.enabled,p.new_messages,p.escalation,p.show_preview,p.dnd_start,p.dnd_end,p.timezone]);return p;
  });
  app.get('/api/chat-v8/delivery-log',auth,async(request,reply)=>{
    if(!requireRole(request,reply,['admin','supervisor']))return;
    return (await pool.query(`SELECT j.id,j.event_id,j.status,j.attempts,j.error_code,j.created_at,j.sent_at,j.acknowledged_at,j.ack_outcome,j.channel,COALESCE(j.last_attempt_at,j.sent_at) AS last_attempt_at,
      d.platform,d.provider,d.name AS device_name,o.name AS operator_name,e.session_id FROM chat_v8_deliveries j
      JOIN chat_v8_devices d ON d.id=j.device_id JOIN chat_operators o ON o.id=j.operator_id JOIN chat_v8_events e ON e.id=j.event_id
      ORDER BY j.created_at DESC LIMIT 200`)).rows;
  });
}
