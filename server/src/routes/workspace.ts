import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool} from '../db.js';
import {operatorOf,requireRole,uuid} from '../core/security.js';

const templateSchema=z.object({title:z.string().trim().min(1).max(120),shortcut:z.string().trim().min(2).max(50).regex(/^\/[\p{L}\p{N}_-]+$/u).transform(value=>value.toLowerCase()),body:z.string().min(1).max(10000),category:z.string().trim().min(1).max(80).default('Общие'),revision:z.number().int().positive().optional()});
const routingSchema=z.object({automatic:z.boolean(),escalation_minutes:z.number().int().min(1).max(60),idle_minutes:z.number().int().min(1).max(120)});
function template(row:any){return {id:row.id,title:row.title,shortcut:row.shortcut,body:row.body,category:row.category,uses:row.uses,createdAt:new Date(row.created_at).getTime(),revision:row.revision}}

export function registerWorkspaceRoutes(app:FastifyInstance) {
  const auth={preHandler:[(app as any).authenticate]};
  app.get('/api/chat-v8/templates',auth,async()=> (await pool.query('SELECT * FROM chat_v8_templates ORDER BY category,uses DESC,title')).rows.map(template));
  app.post('/api/chat-v8/templates',auth,async(request,reply)=>{
    const data=templateSchema.parse(request.body);
    try {
      const {rows}=await pool.query('INSERT INTO chat_v8_templates(title,shortcut,body,category,updated_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[data.title,data.shortcut,data.body,data.category,operatorOf(request).id]);
      (app as any).io.emit('templates_updated',{id:rows[0].id});return template(rows[0]);
    } catch(error:any){if(error.code==='23505')return reply.code(409).send({error:'Такой шорткат уже существует'});throw error}
  });
  app.put('/api/chat-v8/templates/:id',auth,async(request,reply)=>{
    const id=uuid.parse((request.params as any).id),data=templateSchema.parse(request.body);
    if(data.revision===undefined)return reply.code(400).send({error:'Обновите список перед редактированием'});
    try {
      const {rows}=await pool.query(`UPDATE chat_v8_templates SET title=$2,shortcut=$3,body=$4,category=$5,updated_by=$6,updated_at=now(),revision=revision+1
        WHERE id=$1 AND revision=$7 RETURNING *`,[id,data.title,data.shortcut,data.body,data.category,operatorOf(request).id,data.revision]);
      if(!rows[0])return reply.code(409).send({error:'Шаблон уже изменён другим оператором. Обновите список.'});
      (app as any).io.emit('templates_updated',{id});return template(rows[0]);
    } catch(error:any){if(error.code==='23505')return reply.code(409).send({error:'Такой шорткат уже существует'});throw error}
  });
  app.delete('/api/chat-v8/templates/:id',auth,async request=>{
    const id=uuid.parse((request.params as any).id);await pool.query('DELETE FROM chat_v8_templates WHERE id=$1',[id]);(app as any).io.emit('templates_updated',{id});return {ok:true};
  });
  app.post('/api/chat-v8/templates/:id/use',auth,async request=>{
    const id=uuid.parse((request.params as any).id);await pool.query('UPDATE chat_v8_templates SET uses=uses+1 WHERE id=$1',[id]);return {ok:true};
  });
  app.post('/api/chat-v8/templates/import',auth,async request=>{
    const entries=z.array(templateSchema).max(200).parse((request.body as any)?.templates);
    const imported:string[]=[],conflicts:string[]=[];
    for(const data of entries) {
      const {rows}=await pool.query(`INSERT INTO chat_v8_templates(title,shortcut,body,category,updated_by) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(shortcut) DO NOTHING RETURNING id`,[data.title,data.shortcut,data.body,data.category,operatorOf(request).id]);
      if(rows[0])imported.push(data.shortcut);
      else {
        const current=await pool.query('SELECT body FROM chat_v8_templates WHERE shortcut=$1',[data.shortcut]);
        if(current.rows[0]?.body!==data.body)conflicts.push(data.shortcut);
      }
    }
    (app as any).io.emit('templates_updated',{});return {imported,conflicts};
  });
  app.get('/api/chat-v8/routing',auth,async()=>(await pool.query('SELECT * FROM chat_v8_routing_settings WHERE id=true')).rows[0]);
  app.put('/api/chat-v8/routing',auth,async(request,reply)=>{
    if(!requireRole(request,reply,['admin','supervisor']))return;
    const data=routingSchema.parse(request.body);
    await pool.query('UPDATE chat_v8_routing_settings SET automatic=$1,escalation_minutes=$2,idle_minutes=$3,updated_at=now() WHERE id=true',[data.automatic,data.escalation_minutes,data.idle_minutes]);
    (app as any).io.emit('routing_updated',data);return data;
  });
  app.get('/api/chat-v8/stats',auth,async(request,reply)=>{
    if(!requireRole(request,reply,['admin','supervisor']))return;
    const {days}=z.object({days:z.coerce.number().int().min(1).max(90).default(7)}).parse(request.query);
    const [summary,daily,team,queue]=await Promise.all([
      pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE s.status='closed')::int AS closed,
        round(avg(EXTRACT(epoch FROM(s.first_response_at-first.created_at))) FILTER(WHERE s.first_response_at>=first.created_at))::int AS response_seconds,
        round(avg(s.rating)::numeric,2) AS rating,count(s.rating)::int AS ratings
        FROM widget_chat_sessions s LEFT JOIN LATERAL(SELECT created_at FROM widget_chat_messages WHERE session_id=s.id AND sender='visitor' ORDER BY created_at LIMIT 1) first ON true
        WHERE s.created_at>=now()-make_interval(days=>$1)`,[days]),
      pool.query(`SELECT to_char(created_at AT TIME ZONE 'Asia/Yekaterinburg','YYYY-MM-DD') AS day,count(*)::int AS chats,
        count(*) FILTER(WHERE status='closed')::int AS closed FROM widget_chat_sessions WHERE created_at>=now()-make_interval(days=>$1) GROUP BY day ORDER BY day`,[days]),
      pool.query(`SELECT o.id,o.name,o.status,o.is_online,
        (SELECT count(DISTINCT m.session_id)::int FROM widget_chat_messages m WHERE m.operator_id=o.id AND m.is_internal IS NOT TRUE AND m.created_at>=now()-make_interval(days=>$1)) AS handled,
        (SELECT count(*)::int FROM widget_chat_sessions s WHERE s.operator_id=o.id AND s.status<>'closed') AS active,
        (SELECT round(avg(s.rating)::numeric,2) FROM widget_chat_sessions s WHERE s.operator_id=o.id AND s.created_at>=now()-make_interval(days=>$1)) AS rating
        FROM chat_operators o WHERE o.is_active ORDER BY handled DESC,o.name`,[days]),
      pool.query(`SELECT count(*)::int AS waiting,COALESCE(max(EXTRACT(epoch FROM(now()-COALESCE(queued_at,created_at)))),0)::int AS longest_wait_seconds
        FROM widget_chat_sessions WHERE operator_id IS NULL AND status='waiting_operator'`),
    ]);
    return {days,summary:summary.rows[0],daily:daily.rows,operators:team.rows,queue:queue.rows[0]};
  });
}
