import type {PoolClient} from 'pg';
import type {OperatorClaims} from '../core/security.js';
import {pool,transaction} from '../db.js';
const fail=(statusCode:number,message:string)=>Object.assign(new Error(message),{statusCode});

export async function lockOperator(client:PoolClient,id:string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['chat-routing:'+id]);
}
export async function operatorCapacity(client:PoolClient,id:string,sessionId:string) {
  const {rows}=await client.query(`SELECT o.id,o.name,o.max_concurrent_chats,
    (SELECT count(*)::int FROM widget_chat_sessions s WHERE s.operator_id=o.id AND s.status<>'closed' AND s.id<>$2) AS load
    FROM chat_operators o WHERE o.id=$1 AND o.is_active`,[id,sessionId]);
  if(!rows[0])throw fail(404,'Оператор недоступен');
  if(rows[0].load>=Math.max(1,rows[0].max_concurrent_chats||5))throw fail(409,'У оператора достигнут лимит диалогов');
  return rows[0];
}
export async function assignInTransaction(client:PoolClient,id:string,targetId:string,actor:OperatorClaims,mode:'claim'|'transfer'='claim',comment='') {
  if(mode==='claim'&&targetId!==actor.id&&actor.role==='operator')throw fail(403,'Нельзя назначать диалоги другому оператору');
  await lockOperator(client,targetId);
  const {rows}=await client.query('SELECT * FROM widget_chat_sessions WHERE id=$1 FOR UPDATE',[id]);
  const session=rows[0];
  if(!session)throw fail(404,'Диалог не найден');
  if(mode==='claim'&&session.operator_id&&session.operator_id!==targetId)throw fail(409,'Диалог уже принят другим оператором');
  if(mode==='transfer'&&actor.role==='operator'&&session.operator_id!==actor.id)throw fail(403,'Передать можно только свой диалог');
  if(session.operator_id===targetId&&session.status==='with_operator')return {session,changed:false};
  const target=await operatorCapacity(client,targetId,id);
  const {rows:updated}=await client.query(`UPDATE widget_chat_sessions SET operator_id=$2,status='with_operator',operator_joined_at=now(),closed_at=NULL,queued_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`,[id,targetId]);
  const text=mode==='transfer'?`Диалог передан оператору ${target.name}`:`${target.name} принял диалог`;
  await client.query("INSERT INTO widget_chat_messages(session_id,sender,message) VALUES($1,'system',$2)",[id,text]);
  if(comment.trim())await client.query("INSERT INTO widget_chat_messages(session_id,sender,operator_id,message,is_internal) VALUES($1,'operator',$2,$3,true)",[id,actor.id,comment.trim()]);
  await client.query('INSERT INTO operator_activity_logs(operator_id,action,session_id,meta) VALUES($1,$2,$3,$4)',[actor.id,mode==='transfer'?'transfer':'assign',id,JSON.stringify({to_operator_id:targetId,to_name:target.name})]);
  await client.query("INSERT INTO chat_v8_events(session_id,kind,payload) VALUES($1,'assignment',$2)",[id,JSON.stringify({title:'Вам назначен диалог',body:'Откройте переписку с клиентом'})]);
  return {session:updated[0],changed:true};
}
export function assignSession(id:string,targetId:string,actor:OperatorClaims,mode:'claim'|'transfer'='claim',comment='') {
  return transaction(client=>assignInTransaction(client,id,targetId,actor,mode,comment));
}
export async function mutateInTransaction(client:PoolClient,id:string,actor:OperatorClaims,action:'close'|'leave'|'read'|'unread'|'priority'|'status',values:any={}) {
  const {rows}=await client.query('SELECT * FROM widget_chat_sessions WHERE id=$1 FOR UPDATE',[id]);
  const session=rows[0];
  if(!session)throw fail(404,'Диалог не найден');
  if(actor.role==='operator'&&session.operator_id&&session.operator_id!==actor.id)throw fail(403,'Диалог ведёт другой оператор');
  if(action==='close') {
    if(session.status==='closed')return {session,changed:false};
    await client.query("UPDATE widget_chat_sessions SET status='closed',closed_at=now(),updated_at=now(),unread_count=0 WHERE id=$1",[id]);
    await client.query("INSERT INTO widget_chat_messages(session_id,sender,message) VALUES($1,'system','Диалог завершён')",[id]);
  } else if(action==='leave') {
    if(!session.operator_id)return {session,changed:false};
    await client.query("UPDATE widget_chat_sessions SET operator_id=NULL,status='waiting_operator',queued_at=now(),updated_at=now() WHERE id=$1",[id]);
    await client.query("INSERT INTO widget_chat_messages(session_id,sender,message) VALUES($1,'system','Диалог возвращён в очередь')",[id]);
  } else if(action==='read') {
    await client.query('UPDATE widget_chat_sessions SET unread_count=0,updated_at=now() WHERE id=$1',[id]);
    await client.query("UPDATE widget_chat_messages SET is_read=true,status='read',read_at=COALESCE(read_at,now()) WHERE session_id=$1 AND sender='visitor' AND is_read IS NOT TRUE",[id]);
  } else if(action==='unread') {
    await client.query('UPDATE widget_chat_sessions SET unread_count=GREATEST(unread_count,1),updated_at=now() WHERE id=$1',[id]);
  } else if(action==='priority') {
    await client.query('UPDATE widget_chat_sessions SET priority=COALESCE($2,priority),is_vip=COALESCE($3,is_vip),updated_at=now() WHERE id=$1',[id,values.priority||(values.is_vip?'urgent':null),values.is_vip??null]);
  } else {
    await client.query("UPDATE widget_chat_sessions SET status=$2,operator_id=NULL,queued_at=CASE WHEN $2='waiting_operator' THEN now() ELSE NULL END,closed_at=NULL,updated_at=now() WHERE id=$1",[id,values.status]);
  }
  if(!['read','unread'].includes(action))await client.query('INSERT INTO operator_activity_logs(operator_id,action,session_id,meta) VALUES($1,$2,$3,$4)',[actor.id,action,id,JSON.stringify(values)]);
  return {session:(await client.query('SELECT * FROM widget_chat_sessions WHERE id=$1',[id])).rows[0],changed:true};
}
export function mutateSession(id:string,actor:OperatorClaims,action:Parameters<typeof mutateInTransaction>[3],values:any={}) {
  return transaction(client=>mutateInTransaction(client,id,actor,action,values));
}

export async function distributeQueue() {
  if(!(await pool.query('SELECT automatic FROM chat_v8_routing_settings WHERE id=true')).rows[0]?.automatic)return;
  const {rows:queue}=await pool.query("SELECT id FROM widget_chat_sessions WHERE operator_id IS NULL AND status='waiting_operator' ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,queued_at NULLS LAST LIMIT 20");
  for(const item of queue) {
    const {rows}=await pool.query(`SELECT o.id,
      (SELECT count(*) FROM widget_chat_sessions s WHERE s.operator_id=o.id AND s.status<>'closed') AS load,
      (SELECT max(operator_joined_at) FROM widget_chat_sessions s WHERE s.operator_id=o.id) AS last_assignment
      FROM chat_operators o WHERE o.is_active AND o.is_online AND o.status='online' AND o.last_seen_at>now()-interval '90 seconds'
      AND (SELECT count(*) FROM widget_chat_sessions s WHERE s.operator_id=o.id AND s.status<>'closed')<o.max_concurrent_chats
      ORDER BY load,last_assignment NULLS FIRST,o.id LIMIT 1`);
    if(!rows[0])break;
    // Automatic assignment is a server action attributed to its recipient.
    const actor={id:rows[0].id,role:'operator'} as OperatorClaims;
    await assignSession(item.id,rows[0].id,actor).catch(()=>{});
  }
}
