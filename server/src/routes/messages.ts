import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { assertActor, operatorOf, uuid } from '../core/security.js';
import { createMessage, enrichMessages } from '../services/messages.js';

const cursorSchema=z.object({time:z.string().datetime(),id:uuid});
function decodeCursor(value?:string) {
  if (!value) return null;
  if (value.length>512) throw Object.assign(new Error('Неверный курсор'),{statusCode:400});
  try { return cursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8'))); }
  catch { throw Object.assign(new Error('Неверный курсор'),{statusCode:400}); }
}
export function registerMessageRoutes(app: FastifyInstance) {
  app.get('/api/sessions/:id/messages',{preHandler:[(app as any).authenticate]},async request=>{
    const id=uuid.parse((request.params as any).id);
    const query=z.object({cursor:z.string().optional(),limit:z.coerce.number().int().min(1).max(200).default(100),paged:z.string().optional(),around:uuid.optional()}).parse(request.query);
    const cursor=decodeCursor(query.cursor);
    const {rows}=await pool.query(
      `SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM widget_chat_messages WHERE session_id=$1
       AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
       AND ($5::uuid IS NULL OR (created_at,id)<=(SELECT created_at,id FROM widget_chat_messages WHERE id=$5 AND session_id=$1))
       ORDER BY created_at DESC,id DESC LIMIT $4`,
      [id,cursor?.time||null,cursor?.id||null,query.limit+1,query.around||null],
    );
    const hasMore=rows.length>query.limit;
    const selected=rows.slice(0,query.limit);
    const oldest=selected.at(-1);
    const messages=await enrichMessages(selected.reverse().map(({cursor_time,...message})=>message));
    const nextCursor=hasMore&&oldest?Buffer.from(JSON.stringify({time:oldest.cursor_time,id:oldest.id})).toString('base64url'):null;
    return query.paged==='1'?{messages,next_cursor:nextCursor}:messages;
  });
  app.post('/api/sessions/:id/messages',{preHandler:[(app as any).authenticate]},async request=>{
    const id=uuid.parse((request.params as any).id);
    const body=z.object({
      message:z.string().min(1).max(10000),operator_id:uuid.optional(),reply_to_id:uuid.nullable().optional(),
      client_message_id:uuid.optional(),is_internal:z.boolean().optional(),
    }).parse(request.body);
    assertActor(request,body.operator_id);
    const result=await createMessage(id,body,{operator:operatorOf(request)});
    if(result.created)(app as any).io.emit('session_updated',{session_id:id});
    return result.message;
  });
  app.get('/api/messages/search',{preHandler:[(app as any).authenticate]},async request=>{
    const query=z.object({
      q:z.string().max(500).optional(),session_id:uuid.optional(),sender:z.enum(['visitor','operator','ai','system']).optional(),
      from_date:z.string().datetime().optional(),to_date:z.string().datetime().optional(),
      page:z.coerce.number().int().min(1).max(100000).default(1),
    }).parse(request.query);
    if(!query.q?.trim()&&!query.session_id)return {messages:[],total:0,page:query.page,pages:0};
    const values:any[]=[],conditions=['m.is_deleted IS NOT TRUE'];
    const add=(expression:string,value:any)=>{values.push(value);conditions.push(expression.replace('?',`$${values.length}`))};
    if(query.q?.trim())add('m.message ILIKE ?',`%${query.q.trim()}%`);
    if(query.session_id)add('m.session_id=?',query.session_id);
    if(query.sender)add('m.sender=?',query.sender);
    if(query.from_date)add('m.created_at>=?',query.from_date);
    if(query.to_date)add('m.created_at<=?',query.to_date);
    const where=conditions.join(' AND ');
    const [found,count]=await Promise.all([
      pool.query(`SELECT m.*,s.visitor_name,s.visitor_id FROM widget_chat_messages m LEFT JOIN widget_chat_sessions s ON s.id=m.session_id WHERE ${where} ORDER BY m.created_at DESC,m.id DESC LIMIT 50 OFFSET ${(query.page-1)*50}`,values),
      pool.query(`SELECT count(*)::int AS total FROM widget_chat_messages m WHERE ${where}`,values),
    ]);
    return {messages:await enrichMessages(found.rows),total:count.rows[0].total,page:query.page,pages:Math.ceil(count.rows[0].total/50)};
  });
}

