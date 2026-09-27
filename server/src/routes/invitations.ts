import type { FastifyInstance } from "fastify";
import { pool, transaction } from "../db.js";
import { z } from "zod";
import { operatorOf, uuid } from "../core/security.js";
import { requestVisitor } from "../services/visitor-auth.js";

export function registerInvitationRoutes(app: FastifyInstance) {

  // POST /api/invitations — оператор отправляет приглашение
  app.post("/api/invitations", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const {visitor_id,message}=z.object({visitor_id:z.string().min(1).max(100),message:z.string().trim().min(1).max(1000).optional()}).parse(request.body);
    const operator_id=operatorOf(request).id,text=message||'Здравствуйте! Могу я вам помочь?';
    const invitation=await transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['widget-visitor:'+visitor_id]);
      const visitor=await client.query("SELECT 1 FROM site_visitors sv WHERE visitor_id=$1 AND is_online AND last_seen_at>now()-interval '120 seconds' AND NOT EXISTS(SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=sv.visitor_id)",[visitor_id]);
      if(!visitor.rowCount)throw Object.assign(new Error('Посетитель уже покинул сайт'),{statusCode:409});
      const existing=await client.query("SELECT 1 FROM proactive_invitations WHERE visitor_id=$1 AND status='sent' AND created_at>now()-interval '10 minutes'",[visitor_id]);
      if(existing.rowCount)throw Object.assign(new Error('Приглашение уже отправлено'),{statusCode:409});
      // Отказ посетителя уважаем: повторно не предлагаем в течение получаса.
      const declined=await client.query("SELECT 1 FROM proactive_invitations WHERE visitor_id=$1 AND status='declined' AND declined_at>now()-interval '30 minutes'",[visitor_id]);
      if(declined.rowCount)throw Object.assign(new Error('Посетитель недавно отказался от приглашения. Предложите помощь позже.'),{statusCode:409});
      return (await client.query('INSERT INTO proactive_invitations(visitor_id,operator_id,message) VALUES($1,$2,$3) RETURNING *',[visitor_id,operator_id,text])).rows[0];
    });

    // Получаем имя оператора
    const { rows: opRows } = await pool.query(
      `SELECT name, avatar_url FROM chat_operators WHERE id = $1`,
      [operator_id]
    );
    const operatorName = opRows[0]?.name || "Оператор";
    const operatorAvatar = opRows[0]?.avatar_url || null;

    // Отправляем посетителю через сокет
    const io = (app as any).io;
    io.emit("invitation_sent", {
      id: invitation.id,
      visitor_id,
      operator_name: operatorName,
      operator_avatar: operatorAvatar,
      message: text,
      auto: false,
    });

    // Уведомляем всех операторов
    io.emit("invitation_updated", { invitation_id: invitation.id, status: "sent", visitor_id });

    // Логируем
    await pool.query(
      `INSERT INTO operator_activity_logs (operator_id, action, meta)
       VALUES ($1, 'send_invitation', $2)`,
      [operator_id, JSON.stringify({ visitor_id, invitation_id: invitation.id })]
    );

    return { ok: true, invitation };
  });

  // GET /api/invitations — список приглашений
  app.get("/api/invitations", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { status, limit } = z.object({status:z.enum(["sent","accepted","declined"]).optional(),limit:z.coerce.number().int().min(1).max(200).default(50)}).parse(request.query);

    let where = "1=1";
    const values: any[] = [];
    let idx = 1;

    if (status) {
      where += ` AND i.status = $${idx}`;
      values.push(status);
      idx++;
    }

    const lim = limit;
    values.push(lim);

    const { rows } = await pool.query(
      `SELECT i.*, o.name as operator_name, o.avatar_url as operator_avatar
       FROM proactive_invitations i
       LEFT JOIN chat_operators o ON o.id = i.operator_id
       WHERE ${where}
       ORDER BY i.created_at DESC
       LIMIT $${idx}`,
      values
    );

    return rows;
  });

  // Visitor actions have their own signed identity and never accept an operator JWT.
  for (const action of ['accept', 'decline'] as const) {
    app.patch('/api/widget/invitations/:id/' + action, async (request, reply) => {
      let visitorId:string;
      try { visitorId=requestVisitor(app,request); }
      catch { return reply.code(403).send({error:'visitor_auth_required'}); }
      const id=uuid.parse((request.params as any).id),status=action==='accept'?'accepted':'declined';
      await transaction(async client=>{
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['widget-visitor:'+visitorId]);
        if((await client.query('SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1',[visitorId])).rowCount)throw Object.assign(new Error('Посетитель заблокирован'),{statusCode:403});
        const found=(await client.query('SELECT status,created_at FROM proactive_invitations WHERE id=$1 AND visitor_id=$2 FOR UPDATE',[id,visitorId])).rows[0];
        if(!found)throw Object.assign(new Error('Приглашение не найдено'),{statusCode:404});
        if(found.status===status)return;
        if(found.status!=='sent'||Date.now()-new Date(found.created_at).getTime()>600000)throw Object.assign(new Error('Приглашение уже завершено'),{statusCode:409});
        const timestamp=action==='accept'?'accepted_at':'declined_at';
        await client.query(`UPDATE proactive_invitations SET status=$2,${timestamp}=now() WHERE id=$1`,[id,status]);
      });
      (app as any).io.emit('invitation_updated',{invitation_id:id,status,visitor_id:visitorId});
      return {ok:true};
    });
  }
}
