import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, transaction } from '../db.js';
import { operatorOf, uuid } from '../core/security.js';
const contact=z.object({visitor_name:z.string().trim().max(200).nullable(),visitor_email:z.string().trim().email().max(254).nullable(),visitor_phone:z.string().trim().max(50).nullable(),contact_revision:z.number().int().positive()});
export function registerContactRoutes(app:FastifyInstance) {
  const auth={preHandler:[(app as any).authenticate]};
  app.get('/api/sessions/:id',auth,async(request,reply)=>{
    const id=uuid.parse((request.params as any).id);
    const {rows}=await pool.query('SELECT s.*,o.name AS operator_name FROM widget_chat_sessions s LEFT JOIN chat_operators o ON o.id=s.operator_id WHERE s.id=$1',[id]);
    return rows[0]||reply.code(404).send({error:'Диалог не найден'});
  });
  app.patch('/api/sessions/:id/contact',auth,async request=>{
    const id=uuid.parse((request.params as any).id),data=contact.parse(request.body),actor=operatorOf(request);
    const result=await transaction(async client=>{
      const {rows}=await client.query('SELECT operator_id,contact_revision FROM widget_chat_sessions WHERE id=$1 FOR UPDATE',[id]);
      if(!rows[0])throw Object.assign(new Error('Диалог не найден'),{statusCode:404});
      if(rows[0].operator_id&&rows[0].operator_id!==actor.id&&!['admin','supervisor'].includes(actor.role))throw Object.assign(new Error('Карточку изменяет назначенный оператор или руководитель'),{statusCode:403});
      if(rows[0].contact_revision!==data.contact_revision)throw Object.assign(new Error('Контакты уже изменены коллегой. Обновите карточку.'),{statusCode:409});
      const updated=await client.query(`UPDATE widget_chat_sessions SET visitor_name=$2,visitor_email=$3,visitor_phone=$4,contact_revision=contact_revision+1,updated_at=now() WHERE id=$1 RETURNING *`,[id,data.visitor_name,data.visitor_email,data.visitor_phone]);
      return updated.rows[0];
    });
    (app as any).io.emit('session_updated',{session_id:id});return result;
  });
}
