import type { FastifyInstance } from "fastify";
import { pool, transaction } from "../db.js";
import { z } from "zod";
import { operatorOf, assertActor, uuid } from "../core/security.js";
import { assignSession, assignInTransaction, mutateSession, mutateInTransaction } from "../services/routing.js";

export function registerSessionRoutes(app: FastifyInstance) {
  app.get("/api/sessions", {
    preHandler: [(app as any).authenticate],
  }, async () => {
    const { rows } = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM widget_chat_sessions s2 WHERE s2.visitor_id = s.visitor_id) as total_visitor_sessions,
              (SELECT m.message FROM widget_chat_messages m WHERE m.session_id = s.id AND m.is_deleted IS NOT TRUE AND m.is_internal IS NOT TRUE ORDER BY m.created_at DESC LIMIT 1) as last_message_text,
              (SELECT m.sender FROM widget_chat_messages m WHERE m.session_id = s.id AND m.is_deleted IS NOT TRUE AND m.is_internal IS NOT TRUE ORDER BY m.created_at DESC LIMIT 1) as last_message_sender
       FROM widget_chat_sessions s
       ORDER BY
         CASE s.priority
           WHEN 'urgent' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           WHEN 'low' THEN 3
           ELSE 2
         END ASC,
         s.last_message_at DESC NULLS LAST`
    );
    return rows;
  });

  // ═══ Очередь: неназначенные сессии, sorted by priority + queued_at ═══
  app.get("/api/sessions/queue", {
    preHandler: [(app as any).authenticate],
  }, async () => {
    const { rows } = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM widget_chat_sessions s2 WHERE s2.visitor_id = s.visitor_id) as total_visitor_sessions,
              (SELECT m.message FROM widget_chat_messages m WHERE m.session_id = s.id AND m.is_deleted IS NOT TRUE AND m.is_internal IS NOT TRUE ORDER BY m.created_at DESC LIMIT 1) as last_message_text,
              (SELECT m.sender FROM widget_chat_messages m WHERE m.session_id = s.id AND m.is_deleted IS NOT TRUE AND m.is_internal IS NOT TRUE ORDER BY m.created_at DESC LIMIT 1) as last_message_sender
       FROM widget_chat_sessions s
       WHERE s.status IN ('waiting_operator')
         AND s.operator_id IS NULL
       ORDER BY
         CASE s.priority
           WHEN 'urgent' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           WHEN 'low' THEN 3
           ELSE 2
         END ASC,
         s.queued_at ASC NULLS LAST`
    );
    return rows;
  });

  const auth = { preHandler: [(app as any).authenticate] };
  const updated = (id: string) => { (app as any).io.emit("session_updated", { session_id: id }); (app as any).io.emit("queue_updated", { session_id: id }); };
  app.patch("/api/sessions/:id/assign", auth, async request => {
    const id=uuid.parse((request.params as any).id),body=z.object({operator_id:uuid.optional()}).parse(request.body||{});
    const result=await assignSession(id,body.operator_id||operatorOf(request).id,operatorOf(request));
    updated(id);return {ok:true,...result};
  });
  app.patch("/api/sessions/:id/transfer", auth, async request => {
    const id=uuid.parse((request.params as any).id),body=z.object({operator_id:uuid,from_operator_id:uuid.optional(),comment:z.string().max(10000).default("")}).parse(request.body);
    assertActor(request,body.from_operator_id);
    const result=await assignSession(id,body.operator_id,operatorOf(request),"transfer",body.comment);
    updated(id);return {ok:true,...result};
  });
  for(const action of ["close","leave","read","unread"] as const) {
    app.patch("/api/sessions/:id/"+action,auth,async request=>{
      const id=uuid.parse((request.params as any).id);
      assertActor(request,(request.body as any)?.operator_id);
      const result=await mutateSession(id,operatorOf(request),action);
      updated(id);return {ok:true,...result};
    });
  }
  app.patch("/api/sessions/:id/priority",auth,async request=>{
    const id=uuid.parse((request.params as any).id),body=z.object({priority:z.enum(["urgent","high","normal","low"]).optional(),is_vip:z.boolean().optional(),operator_id:uuid.optional()}).parse(request.body);
    assertActor(request,body.operator_id);
    const result=await mutateSession(id,operatorOf(request),"priority",body);updated(id);return {ok:true,...result};
  });
  app.patch("/api/sessions/:id/status",auth,async request=>{
    const id=uuid.parse((request.params as any).id),body=z.object({status:z.enum(["ai","waiting_operator","with_operator","closed","resolved"]),operator_id:uuid.optional()}).parse(request.body);
    assertActor(request,body.operator_id);
    const actor=operatorOf(request);
    const result=body.status==="with_operator"?await assignSession(id,actor.id,actor)
      :await mutateSession(id,actor,["closed","resolved"].includes(body.status)?"close":"status",{status:body.status});
    updated(id);return {ok:true,...result};
  });

  // === Reactions ===
  app.post("/api/messages/:id/reactions", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { emoji, operator_id } = request.body as { emoji: string; operator_id: string };

    // Проверяем, нет ли уже такой реакции
    const existing = await pool.query(
      `SELECT id FROM message_reactions WHERE message_id = $1 AND operator_id = $2 AND emoji = $3`,
      [id, operator_id, emoji]
    );

    if (existing.rows.length > 0) {
      // Удаляем (toggle)
      await pool.query(`DELETE FROM message_reactions WHERE id = $1`, [existing.rows[0].id]);
      const io = (app as any).io;
      const msg = await pool.query(`SELECT session_id FROM widget_chat_messages WHERE id = $1`, [id]);
      if (msg.rows[0]) {
        io.to(`session:${msg.rows[0].session_id}`).emit("reaction_updated", { message_id: id });
      }
      return { ok: true, action: "removed" };
    }

    await pool.query(
      `INSERT INTO message_reactions (message_id, operator_id, emoji) VALUES ($1, $2, $3)`,
      [id, operator_id, emoji]
    );

    const io = (app as any).io;
    const msg = await pool.query(`SELECT session_id FROM widget_chat_messages WHERE id = $1`, [id]);
    if (msg.rows[0]) {
      io.to(`session:${msg.rows[0].session_id}`).emit("reaction_updated", { message_id: id });
    }

    return { ok: true, action: "added" };
  });

  // Получить реакции сообщения
  app.get("/api/messages/:id/reactions", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `SELECT r.*, o.name as operator_name
       FROM message_reactions r
       LEFT JOIN chat_operators o ON o.id = r.operator_id
       WHERE r.message_id = $1
       ORDER BY r.created_at ASC`,
      [id]
    );
    return rows;
  });

  // === Edit message (только свои, в течение 5 мин) ===
  app.patch("/api/messages/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message, operator_id } = request.body as { message: string; operator_id: string };

    const { rows } = await pool.query(
      `SELECT * FROM widget_chat_messages WHERE id = $1`, [id]
    );

    if (!rows.length) return reply.code(404).send({ error: "Not found" });

    const msg = rows[0];

    if (msg.sender !== "operator" || msg.operator_id !== operator_id) {
      return reply.code(403).send({ error: "Can only edit own messages" });
    }

    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    if (ageMs > 5 * 60 * 1000) {
      return reply.code(403).send({ error: "Can only edit within 5 minutes" });
    }

    await pool.query(
      `UPDATE widget_chat_messages SET message = $1, updated_at = NOW(), is_edited = true WHERE id = $2`,
      [message, id]
    );

    const io = (app as any).io;
    io.to(`session:${msg.session_id}`).emit("message_updated", { message_id: id, message, is_edited: true });

    return { ok: true };
  });

  // === Delete message (только свои, в течение 5 мин) ===
  app.delete("/api/messages/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { operator_id } = request.body as { operator_id: string };

    const { rows } = await pool.query(
      `SELECT * FROM widget_chat_messages WHERE id = $1`, [id]
    );

    if (!rows.length) return reply.code(404).send({ error: "Not found" });

    const msg = rows[0];

    if (msg.sender !== "operator" || msg.operator_id !== operator_id) {
      return reply.code(403).send({ error: "Can only delete own messages" });
    }

    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    if (ageMs > 5 * 60 * 1000) {
      return reply.code(403).send({ error: "Can only delete within 5 minutes" });
    }

    await pool.query(
      `UPDATE widget_chat_messages SET message = 'Сообщение удалено', is_deleted = true, updated_at = NOW() WHERE id = $1`,
      [id]
    );

    const io = (app as any).io;
    io.to(`session:${msg.session_id}`).emit("message_deleted", { message_id: id });

    return { ok: true };
  });

  // ═══ Пункт 17: Экспорт чата в текст ═══
  app.get("/api/sessions/:id/export", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { rows: sessionRows } = await pool.query(
      `SELECT s.*, o.name as operator_name
       FROM widget_chat_sessions s
       LEFT JOIN chat_operators o ON o.id = s.operator_id
       WHERE s.id = $1`,
      [id]
    );
    if (!sessionRows.length) return reply.code(404).send({ error: "Session not found" });

    const session = sessionRows[0];

    const { rows: messages } = await pool.query(
      `SELECT m.*, o.name as operator_name
       FROM widget_chat_messages m
       LEFT JOIN chat_operators o ON o.id = m.operator_id
       WHERE m.session_id = $1 AND (m.is_deleted IS NULL OR m.is_deleted = false)
       ORDER BY m.created_at ASC`,
      [id]
    );

    const { rows: notes } = await pool.query(
      `SELECT n.*, o.name as operator_name
       FROM session_notes n
       LEFT JOIN chat_operators o ON o.id = n.operator_id
       WHERE n.session_id = $1
       ORDER BY n.created_at ASC`,
      [id]
    );

    const { format } = request.query as { format?: string };

    if (format === "json") {
      return { session, messages, notes };
    }

    // Plain text export
    const lines: string[] = [];
    lines.push("═══════════════════════════════════════");
    lines.push(`Чат #${session.id}`);
    lines.push("═══════════════════════════════════════");
    lines.push(`Посетитель: ${session.visitor_name || session.visitor_id}`);
    if (session.visitor_email) lines.push(`Email: ${session.visitor_email}`);
    if (session.visitor_phone) lines.push(`Телефон: ${session.visitor_phone}`);
    lines.push(`Оператор: ${session.operator_name || "—"}`);
    lines.push(`Статус: ${session.status}`);
    lines.push(`Приоритет: ${session.priority || "normal"}`);
    if (session.rating) lines.push(`Оценка: ${"★".repeat(session.rating)}${"☆".repeat(5 - session.rating)}`);
    lines.push(`Создан: ${new Date(session.created_at).toLocaleString("ru-RU")}`);
    if (session.closed_at) lines.push(`Закрыт: ${new Date(session.closed_at).toLocaleString("ru-RU")}`);
    lines.push(`Страница: ${session.current_page || "—"}`);
    lines.push("");
    lines.push("───────── Сообщения ─────────");
    lines.push("");

    for (const m of messages) {
      const time = new Date(m.created_at).toLocaleString("ru-RU");
      let sender = "Система";
      if (m.sender === "visitor") sender = session.visitor_name || "Посетитель";
      else if (m.sender === "operator") sender = m.operator_name || "Оператор";
      else if (m.sender === "ai") sender = "AI-бот";

      lines.push(`[${time}] ${sender}:`);
      lines.push(`  ${m.message}`);
      lines.push("");
    }

    if (notes.length > 0) {
      lines.push("───────── Заметки ─────────");
      lines.push("");
      for (const n of notes) {
        const time = new Date(n.created_at).toLocaleString("ru-RU");
        lines.push(`[${time}] ${n.operator_name || "Оператор"}:`);
        lines.push(`  ${n.content}`);
        lines.push("");
      }
    }

    lines.push("═══════════════════════════════════════");
    lines.push(`Экспортировано: ${new Date().toLocaleString("ru-RU")}`);

    const text = lines.join("\n");

    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="chat-${id.slice(0, 8)}.txt"`);
    return reply.send(text);
  });

  // ═══ Пункт 18: Bulk actions ═══
  app.post("/api/sessions/bulk/close",auth,async request=>{
    const body=z.object({session_ids:z.array(uuid).min(1).max(100),operator_id:uuid.optional()}).parse(request.body);
    assertActor(request,body.operator_id);
    const ids=[...new Set(body.session_ids)].sort();
    const closed=await transaction(async client=>{
      let count=0;
      for(const id of ids) { const result=await mutateInTransaction(client,id,operatorOf(request),"close");if(result.changed)count++; }
      return count;
    });
    ids.forEach(updated);return {ok:true,closed};
  });
  app.post("/api/sessions/bulk/assign",auth,async request=>{
    const body=z.object({session_ids:z.array(uuid).min(1).max(100),operator_id:uuid}).parse(request.body);
    const ids=[...new Set(body.session_ids)].sort();
    const assigned=await transaction(async client=>{
      let count=0;
      for(const id of ids) { const result=await assignInTransaction(client,id,body.operator_id,operatorOf(request));if(result.changed)count++; }
      return count;
    });
    ids.forEach(updated);return {ok:true,assigned};
  });

  // ═══ Пункт 20: Статистика оператора ═══
  app.get("/api/operators/:id/stats", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { period } = request.query as { period?: string };

    // Default: last 30 days
    let intervalSql = "30 days";
    if (period === "7d") intervalSql = "7 days";
    else if (period === "24h") intervalSql = "1 day";
    else if (period === "90d") intervalSql = "90 days";

    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int as total_chats,
         COUNT(*) FILTER (WHERE status = 'closed')::int as closed_chats,
         COUNT(*) FILTER (WHERE status != 'closed')::int as active_chats,
         COALESCE(AVG(rating) FILTER (WHERE rating IS NOT NULL), 0)::numeric(3,2) as avg_rating,
         COUNT(*) FILTER (WHERE rating IS NOT NULL)::int as rated_chats,
         COALESCE(SUM(messages_count), 0)::int as total_messages,
         COALESCE(SUM(operator_messages_count), 0)::int as operator_messages,
         COALESCE(
           AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60)
           FILTER (WHERE first_response_at IS NOT NULL),
           0
         )::numeric(6,1) as avg_first_response_min,
         COALESCE(
           AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 60)
           FILTER (WHERE closed_at IS NOT NULL),
           0
         )::numeric(6,1) as avg_resolution_min,
         COUNT(*) FILTER (WHERE is_vip = true)::int as vip_chats
       FROM widget_chat_sessions
       WHERE operator_id = $1
         AND created_at >= NOW() - INTERVAL '${intervalSql}'`,
      [id]
    );

    // Daily breakdown
    const { rows: daily } = await pool.query(
      `SELECT
         DATE(created_at) as date,
         COUNT(*)::int as chats,
         COUNT(*) FILTER (WHERE status = 'closed')::int as closed,
         COALESCE(AVG(rating) FILTER (WHERE rating IS NOT NULL), 0)::numeric(3,2) as avg_rating
       FROM widget_chat_sessions
       WHERE operator_id = $1
         AND created_at >= NOW() - INTERVAL '${intervalSql}'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [id]
    );

    // Busiest hours
    const { rows: hourly } = await pool.query(
      `SELECT
         EXTRACT(HOUR FROM created_at)::int as hour,
         COUNT(*)::int as chats
       FROM widget_chat_sessions
       WHERE operator_id = $1
         AND created_at >= NOW() - INTERVAL '${intervalSql}'
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY hour ASC`,
      [id]
    );

    return {
      ...rows[0],
      period: period || "30d",
      daily,
      hourly,
    };
  });

  // ═══ Общая статистика (для дашборда) ═══
  app.get("/api/stats/overview", {
    preHandler: [(app as any).authenticate],
  }, async () => {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int as total_sessions,
         COUNT(*) FILTER (WHERE status != 'closed')::int as active_sessions,
         COUNT(*) FILTER (WHERE status = 'waiting_operator')::int as waiting_sessions,
         COUNT(*) FILTER (WHERE status = 'closed' AND closed_at >= NOW() - INTERVAL '24 hours')::int as closed_today,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int as new_today,
         COALESCE(AVG(rating) FILTER (WHERE rating IS NOT NULL AND rated_at >= NOW() - INTERVAL '30 days'), 0)::numeric(3,2) as avg_rating_30d,
         COALESCE(
           AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60)
           FILTER (WHERE first_response_at IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days'),
           0
         )::numeric(6,1) as avg_first_response_min_30d,
         COUNT(DISTINCT visitor_id) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int as unique_visitors_30d
       FROM widget_chat_sessions`
    );

    return rows[0];
  });
  
  // Activity logs для сессии
  app.get("/api/sessions/:id/activity", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const { rows } = await pool.query(
      `SELECT l.*, o.name as operator_name
       FROM operator_activity_logs l
       LEFT JOIN chat_operators o ON o.id = l.operator_id
       WHERE l.session_id = $1
       ORDER BY l.created_at DESC
       LIMIT 50`,
      [id]
    );

    return rows;
  });
}
