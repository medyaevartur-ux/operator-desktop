import { lockOperator } from "../services/routing.js";
import type { FastifyInstance } from "fastify";
import { pool, transaction } from "../db.js";
import { z } from "zod";
import { uuid } from "../core/security.js";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

const UPLOAD_DIR = path.resolve("uploads/avatars");

const operatorFields = z.object({
  email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(128), role: z.enum(['admin','supervisor','operator']),
  max_concurrent_chats: z.number().int().min(1).max(100), is_active: z.boolean(),
});
async function invalidateOperator(client: any, id: string) {
  await client.query('UPDATE chat_v8_auth_sessions SET revoked_at=now(),rotation_envelope=NULL WHERE operator_id=$1 AND revoked_at IS NULL',[id]);
  await client.query('UPDATE chat_v8_devices SET enabled=false WHERE operator_id=$1',[id]);
}
async function preserveLastAdmin(client: any, id: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('chat_v8_admin_membership'))");
  const {rows}=await client.query("SELECT id FROM chat_operators WHERE role='admin' AND is_active=true ORDER BY id");
  if(rows.length===1 && rows[0].id===id) throw Object.assign(new Error('В команде должен остаться хотя бы один администратор'),{statusCode:409});
}
async function returnChatsToQueue(client: any,id: string) {
  await lockOperator(client,id);
  const {rows}=await client.query("UPDATE widget_chat_sessions SET operator_id=NULL,status='waiting_operator',queued_at=now(),updated_at=now() WHERE operator_id=$1 AND status<>'closed' RETURNING id",[id]);
  await client.query("UPDATE chat_operators SET is_online=false,status='offline',current_chats_count=0 WHERE id=$1",[id]);
  for(const session of rows) await client.query("INSERT INTO chat_v8_events(session_id,kind,dedupe_key,payload) VALUES($1,'assignment',$2,$3)",[session.id,'operator-disabled:'+randomUUID(),JSON.stringify({title:'Диалог возвращён в очередь',body:'Назначенный сотрудник отключён'})]);
}
function requireAdmin(request: any, reply: any): boolean {
  const role = request.user?.role;
  if (role !== "admin") {
    reply.code(403).send({ error: "Forbidden: admin role required" });
    return false;
  }
  return true;
}

export function registerOperatorRoutes(app: FastifyInstance) {
  // Список операторов
  app.get("/api/operators", {
    preHandler: [(app as any).authenticate],
  }, async () => {
    const { rows } = await pool.query(
      `SELECT id, email, name, avatar_url, role, status, is_online, is_active,
              last_seen_at, max_concurrent_chats, (SELECT count(*)::int FROM widget_chat_sessions s WHERE s.operator_id=chat_operators.id AND s.status<>'closed') AS current_chats_count,
              total_chats, total_messages, avg_rating, avg_response_time,
              created_at, updated_at
       FROM chat_operators ORDER BY name ASC`
    );
    return rows;
  });

  // Получить одного оператора
  app.get("/api/operators/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `SELECT id, email, name, avatar_url, role, status, is_online, is_active,
              last_seen_at, max_concurrent_chats, (SELECT count(*)::int FROM widget_chat_sessions s WHERE s.operator_id=chat_operators.id AND s.status<>'closed') AS current_chats_count,
              total_chats, total_messages, avg_rating, avg_response_time,
              created_at, updated_at
       FROM chat_operators WHERE id = $1`,
      [id]
    );
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return rows[0];
  });

  // Создать оператора (только admin)
  app.post("/api/operators", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { email, name, password, role, max_concurrent_chats } = operatorFields.omit({is_active:true}).partial({role:true,max_concurrent_chats:true}).parse(request.body);
    const existing = await pool.query('SELECT id FROM chat_operators WHERE lower(email)=$1',[email]);
    if(existing.rowCount) return reply.code(409).send({error:'Такая почта уже зарегистрирована'});

    const password_hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO chat_operators (email, name, password_hash, role, max_concurrent_chats, status, is_active)
       VALUES ($1, $2, $3, $4, $5, 'offline', true)
       RETURNING id, email, name, avatar_url, role, status, is_online, is_active, created_at`,
      [email.trim(), name.trim(), password_hash, role || "operator", max_concurrent_chats || 5]
    );

    return rows[0];
  });

  // Обновить оператора
  app.patch("/api/operators/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    uuid.parse(id);
    const { name, email, role, is_active, max_concurrent_chats, password } = operatorFields.partial().strict().parse(request.body);

    // ═══ Авторизация ═══
    // Привилегированные поля (роль/активность/email/лимит чатов) — только admin.
    // Своё имя/пароль оператор меняет сам (self). Чужую запись non-admin не трогает вообще.
    const isSelf = (request as any).user?.id === id;
    const touchesPrivileged =
      role !== undefined || is_active !== undefined ||
      email !== undefined || max_concurrent_chats !== undefined;

    if (touchesPrivileged) {
      // Смена роли/активности/email/лимита — строго админ (в т.ч. чтобы non-admin не повышал себе роль).
      if (!requireAdmin(request, reply)) return;
    } else if (!isSelf) {
      // Не админ и не своя запись — даже имя/пароль чужой записи менять нельзя.
      if (!requireAdmin(request, reply)) return;
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }
    if (max_concurrent_chats !== undefined) { fields.push(`max_concurrent_chats = $${idx++}`); values.push(max_concurrent_chats); }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (fields.length === 0) return { ok: true };

    fields.push(`updated_at = NOW()`);
    values.push(id);

    let revoke = false;
    await transaction(async client => {
      if(role !== undefined && role !== 'admin' || is_active === false) await preserveLastAdmin(client,id);
      const before=await client.query('SELECT email,role FROM chat_operators WHERE id=$1 FOR UPDATE',[id]);
      revoke=password!==undefined || is_active===false || (role!==undefined&&role!==before.rows[0]?.role) || (email!==undefined&&email!==before.rows[0]?.email);
      await client.query(`UPDATE chat_operators SET ${fields.join(", ")} WHERE id = $${idx}`,values);
      if(is_active===false) await returnChatsToQueue(client,id);
      if(revoke) await invalidateOperator(client,id);
    });
    if(revoke) (app as any).io.in(`operator:${id}`).disconnectSockets(true);
    (app as any).io.emit("operator_updated",{operator_id:id});
    if(is_active===false)(app as any).io.emit("queue_updated",{});

    return { ok: true };
  });

  // Загрузить аватарку
  app.post("/api/operators/:id/avatar", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    uuid.parse(id);

    const data = await (request as any).file();
    if (!data) return reply.code(400).send({ error: "No file" });

    const ext = path.extname(data.filename || ".png").toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    if (!allowed.includes(ext)) {
      return reply.code(400).send({ error: "Only jpg/png/webp" });
    }

    const filename = `${id}-${randomUUID()}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filepath);
    await data.file.pipe(writeStream);

    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const avatar_url = `/uploads/avatars/${filename}`;

    await pool.query(
      `UPDATE chat_operators SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
      [avatar_url, id]
    );

    return { avatar_url };
  });

  // Удалить оператора (soft delete) — только admin
  app.delete("/api/operators/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };

    uuid.parse(id);
    await transaction(async client => {
      await preserveLastAdmin(client,id);
      await client.query("UPDATE chat_operators SET is_active=false,is_online=false,status='offline',updated_at=now() WHERE id=$1",[id]);
      await returnChatsToQueue(client,id);
      await invalidateOperator(client,id);
    });
    (app as any).io.emit("operator_updated",{operator_id:id});
    (app as any).io.emit("queue_updated",{});
    (app as any).io.in(`operator:${id}`).disconnectSockets(true);

    return { ok: true };
  });

  // Смена статуса (online/away/dnd/offline)
  app.patch("/api/operators/:id/status", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    const allowed = ["online", "away", "dnd", "offline"];
    if (!allowed.includes(status)) throw Object.assign(new Error("Недопустимый статус"), { statusCode: 400 });

    const isOnline = status !== "offline";

    await pool.query(
      `UPDATE chat_operators SET status = $1, is_online = $2, last_seen_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [status, isOnline, id]
    );

    const io = (app as any).io;
    io.emit("operator_status_changed", { operator_id: id, status, is_online: isOnline });

    return { ok: true };
  });

  // Legacy endpoint remains authenticated while clients migrate to device heartbeats.
  app.patch("/api/operators/:id/online", {preHandler:[(app as any).authenticate]}, async(request)=>{
    const id=uuid.parse((request.params as any).id);
    const {is_online}=z.object({is_online:z.boolean()}).parse(request.body);
    const status=is_online?'online':'offline';
    await pool.query('UPDATE chat_operators SET is_online=$1,status=$2,last_seen_at=now(),updated_at=now() WHERE id=$3',[is_online,status,id]);
    (app as any).io.emit('operator_status_changed',{operator_id:id,status,is_online});
    return {ok:true};
  });

  // Heartbeat
  app.patch("/api/operators/:id/heartbeat", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    await pool.query(`UPDATE chat_operators SET last_seen_at = NOW() WHERE id = $1`, [id]);
    return { ok: true };
  });

  // === Activity log ===
  app.get("/api/operators/:id/activity", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { from, to } = request.query as { from?: string; to?: string };

    const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to || new Date().toISOString();

    const statsResult = await pool.query(
      `SELECT
        COUNT(DISTINCT wcm.session_id) as chats_handled,
        COUNT(wcm.id) as messages_sent,
        AVG(EXTRACT(EPOCH FROM (wcm.created_at - wcs.created_at))) as avg_first_response_sec
      FROM widget_chat_messages wcm
      LEFT JOIN widget_chat_sessions wcs ON wcs.id = wcm.session_id
      WHERE wcm.operator_id = $1
        AND wcm.created_at BETWEEN $2 AND $3
        AND wcm.sender = 'operator'`,
      [id, fromDate, toDate]
    );

    const dailyResult = await pool.query(
      `SELECT
        DATE(created_at) as date,
        COUNT(DISTINCT session_id) as chats,
        COUNT(id) as messages
      FROM widget_chat_messages
      WHERE operator_id = $1
        AND created_at BETWEEN $2 AND $3
        AND sender = 'operator'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30`,
      [id, fromDate, toDate]
    );

    const sessionsResult = await pool.query(
      `SELECT
        wcs.id,
        wcs.visitor_name,
        wcs.status,
        wcs.created_at,
        wcs.closed_at,
        COUNT(wcm.id) as operator_messages
      FROM widget_chat_sessions wcs
      LEFT JOIN widget_chat_messages wcm ON wcm.session_id = wcs.id AND wcm.sender = 'operator'
      WHERE wcs.operator_id = $1
        AND wcs.created_at BETWEEN $2 AND $3
      GROUP BY wcs.id
      ORDER BY wcs.created_at DESC
      LIMIT 50`,
      [id, fromDate, toDate]
    );

    const stats = statsResult.rows[0] || {};

    return {
      operator_id: id,
      period: { from: fromDate, to: toDate },
      summary: {
        chats_handled: parseInt(stats.chats_handled) || 0,
        messages_sent: parseInt(stats.messages_sent) || 0,
        avg_first_response_sec: Math.round(parseFloat(stats.avg_first_response_sec) || 0),
      },
      daily: dailyResult.rows,
      recent_sessions: sessionsResult.rows,
    };
  });
}
