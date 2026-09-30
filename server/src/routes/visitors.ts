import { z } from "zod";
import { operatorOf } from "../core/security.js";
import type { FastifyInstance } from "fastify";
import { pool, transaction } from "../db.js";
import { lockOperator, activeOperator } from "../services/routing.js";
import { randomUUID } from "node:crypto";

export function registerVisitorRoutes(app: FastifyInstance) {

  // GET /api/visitors — онлайн и недавние посетители
  app.get("/api/visitors", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const query=z.object({has_chat:z.enum(['true','false']).optional(),online:z.enum(['true','false']).optional(),country:z.string().max(100).optional(),search:z.string().max(250).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),limit:z.coerce.number().int().min(1).max(500).default(100),offset:z.coerce.number().int().min(0).max(500000).default(0)}).parse(request.query);
    const online="(sv.is_online AND sv.last_seen_at>now()-interval '120 seconds')";
    const conditions=['NOT EXISTS(SELECT 1 FROM widget_blocked_visitors b WHERE b.visitor_id=sv.visitor_id)'],params:any[]=[];
    const add=(sql:string,value:any)=>{params.push(value);conditions.push(sql.replaceAll('?',`$${params.length}`))};
    if(query.has_chat)add('sv.has_chat=?',query.has_chat==='true');
    if(query.online)conditions.push(query.online==='true'?online:`NOT ${online}`);
    if(query.country)add('sv.country=?',query.country);
    if(query.search)add('(sv.visitor_id ILIKE ? OR sv.current_page ILIKE ? OR sv.city ILIKE ? OR EXISTS(SELECT 1 FROM widget_chat_sessions s WHERE s.visitor_id=sv.visitor_id AND (s.visitor_name ILIKE ? OR s.visitor_email ILIKE ? OR s.visitor_phone ILIKE ?)))',`%${query.search}%`);
    if(query.date)add("sv.last_seen_at>=(?::date::timestamp AT TIME ZONE 'Asia/Yekaterinburg') AND sv.last_seen_at<((?::date+1)::timestamp AT TIME ZONE 'Asia/Yekaterinburg')",query.date);
    const where=conditions.join(' AND ');
    const [found,count,stats]=await Promise.all([
      pool.query(`SELECT sv.id,sv.visitor_id,sv.current_page,sv.current_page_title,sv.referrer,sv.country,sv.city,sv.browser,sv.os,sv.screen_resolution,sv.language,sv.session_count,sv.first_seen_at,sv.last_seen_at,${online} AS is_online,sv.has_chat,sv.chat_session_id,
        (SELECT visitor_name FROM widget_chat_sessions s WHERE s.visitor_id=sv.visitor_id ORDER BY created_at DESC LIMIT 1) AS visitor_name
        FROM site_visitors sv WHERE ${where} ORDER BY ${online} DESC,sv.last_seen_at DESC,sv.id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,query.limit+1,query.offset]),
      pool.query(`SELECT count(*)::int AS total FROM site_visitors sv WHERE ${where}`,params),
      pool.query(`SELECT count(*) FILTER(WHERE ${online})::int AS online_total,count(*) FILTER(WHERE sv.has_chat)::int AS with_chat_total FROM site_visitors sv WHERE NOT EXISTS(SELECT 1 FROM widget_blocked_visitors b WHERE b.visitor_id=sv.visitor_id)`),
    ]);
    return {items:found.rows.slice(0,query.limit),has_more:found.rows.length>query.limit,total:count.rows[0].total,...stats.rows[0]};
  });

  // GET /api/visitors/:visitor_id/history — история страниц из сессий
  app.get("/api/visitors/:visitor_id/history", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { visitor_id } = request.params as { visitor_id: string };

    // Собираем историю из widget_chat_sessions
    const { rows } = await pool.query(
      `SELECT current_page as page, current_page_title as title, updated_at as visited_at
       FROM widget_chat_sessions
       WHERE visitor_id = $1 AND current_page IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 50`,
      [visitor_id]
    );

    return rows;
  });

  // GET /api/visitors/:visitor_id/sessions — все чат-сессии посетителя
  app.get("/api/visitors/:visitor_id/sessions", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { visitor_id } = request.params as { visitor_id: string };

    const { rows } = await pool.query(
      `SELECT s.*, o.name as operator_name
       FROM widget_chat_sessions s
       LEFT JOIN chat_operators o ON o.id = s.operator_id
       WHERE s.visitor_id = $1
       ORDER BY s.created_at DESC`,
      [visitor_id]
    );

    return {
      sessions: rows,
      total_sessions: rows.length,
      first_seen: rows.length > 0 ? rows[rows.length - 1].created_at : null,
      last_seen: rows.length > 0 ? rows[0].created_at : null,
    };
  });

  // GET /api/visitors/:visitor_id/summary — сводка
  app.get("/api/visitors/:visitor_id/summary", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { visitor_id } = request.params as { visitor_id: string };

    const sessionsRes = await pool.query(
      `SELECT id, status, operator_id FROM widget_chat_sessions WHERE visitor_id = $1`,
      [visitor_id]
    );

    const sessionIds = sessionsRes.rows.map((r: any) => r.id);
    let totalMessages = 0;
    if (sessionIds.length > 0) {
      const msgRes = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM widget_chat_messages WHERE session_id = ANY($1)`,
        [sessionIds]
      );
      totalMessages = msgRes.rows[0].cnt;
    }

    const operatorIds = [...new Set(sessionsRes.rows.map((r: any) => r.operator_id).filter(Boolean))];
    let operators: any[] = [];
    if (operatorIds.length > 0) {
      const opRes = await pool.query(
        `SELECT id, name FROM chat_operators WHERE id = ANY($1)`,
        [operatorIds]
      );
      operators = opRes.rows;
    }

    return {
      total_sessions: sessionsRes.rows.length,
      total_messages: totalMessages,
      avg_rating: null,
      operators,
    };
  });

  // POST /api/visitors/:visitor_id/start-chat — начать чат с посетителем
  app.post("/api/visitors/:visitor_id/start-chat",{preHandler:[(app as any).authenticate]},async request=>{
    const id=z.string().min(1).max(100).parse((request.params as any).visitor_id),actor=operatorOf(request);
    const result=await transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['widget-visitor:'+id]);
      if((await client.query('SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1',[id])).rowCount)throw Object.assign(new Error('Посетитель заблокирован'),{statusCode:409});
      const existing=await client.query("SELECT id FROM widget_chat_sessions WHERE visitor_id=$1 AND status<>'closed' ORDER BY created_at DESC LIMIT 1",[id]);
      if(existing.rows[0])return existing.rows[0].id;
      const visitor=(await client.query('SELECT * FROM site_visitors WHERE visitor_id=$1',[id])).rows[0];
      if(!visitor)throw Object.assign(new Error('Посетитель не найден'),{statusCode:404});
      const sessionId=randomUUID();await lockOperator(client,actor.id);await activeOperator(client,actor.id);
      await client.query("INSERT INTO widget_chat_sessions(id,visitor_id,operator_id,status,current_page,operator_joined_at) VALUES($1,$2,$3,'with_operator',$4,now())",[sessionId,id,actor.id,visitor.current_page]);
      await client.query('UPDATE site_visitors SET has_chat=true,chat_session_id=$2 WHERE visitor_id=$1',[id,sessionId]);return sessionId;
    });
    (app as any).io.emit('session_updated',{session_id:result});return {session_id:result};
  });

  // ── Блокировка посетителя («В спам») ──
  app.post("/api/visitors/:visitor_id/block", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { visitor_id } = request.params as { visitor_id: string };
    const operatorId = operatorOf(request).id;
    if(!['admin','supervisor'].includes(operatorOf(request).role) && (await pool.query("SELECT 1 FROM widget_chat_sessions WHERE visitor_id=$1 AND operator_id IS NOT NULL AND operator_id<>$2 AND status<>'closed'",[visitor_id,operatorId])).rowCount)throw Object.assign(new Error('Посетитель уже общается с другим оператором'),{statusCode:403});
    await pool.query(
      `INSERT INTO widget_blocked_visitors (visitor_id, blocked_by) VALUES ($1, $2)
       ON CONFLICT (visitor_id) DO NOTHING`,
      [visitor_id, operatorId]
    );
    await pool.query(
      `UPDATE widget_chat_sessions SET status = 'closed', updated_at = NOW()
       WHERE visitor_id = $1 AND status != 'closed'`,
      [visitor_id]
    );
    const io = (app as any).io;
    io.in(`visitor:${visitor_id}`).disconnectSockets(true);
    io.emit("session_updated", { visitor_id, blocked: true });
    return { ok: true };
  });

  // ── Снять блокировку ──
  app.delete("/api/visitors/:visitor_id/block", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { visitor_id } = request.params as { visitor_id: string };
    await pool.query(`DELETE FROM widget_blocked_visitors WHERE visitor_id = $1`, [visitor_id]);
    return { ok: true };
  });

  // Полная карта пути посетителя (переходы по страницам), новейшие сверху
  app.get("/api/visitors/:visitor_id/path", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { visitor_id } = request.params as { visitor_id: string };
    const { limit } = request.query as { limit?: string };
    const lim = Math.min(parseInt(limit || "50", 10) || 50, 200);
    const { rows } = await pool.query(
      `SELECT url AS page, title, referrer, occurred_at AS visited_at
       FROM visitor_page_views
       WHERE visitor_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [visitor_id, lim]
    );
    return rows;
  });
}