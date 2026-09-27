import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db.js';
import { activeOperator, createAuthSession, revokeRefresh, revokeFamily, rotateAuthSession } from '../services/auth-sessions.js';
import { operatorOf, uuid } from '../core/security.js';
import { operatorOrigins } from '../core/origins.js';

const loginSchema = z.object({
  email: z.string().email().max(254), password: z.string().min(1).max(512),
  installation_id: uuid, client_name: z.string().max(100).default('Оператор'),
});
const refreshSchema = z.object({ refresh_token: z.string().min(32).max(512).optional(), installation_id: uuid });
function noStore(reply: FastifyReply) { reply.header('Cache-Control','no-store').header('Pragma','no-cache'); }
function cookie(reply: FastifyReply, value: string, days: number) {
  reply.header('Set-Cookie', `chat_v8_refresh=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/chat-v8/auth/; Max-Age=${days * 86400}`);
}
function refreshToken(request: FastifyRequest, explicit?: string): string {
  if (explicit) return explicit;
  const origin = request.headers.origin;
  if (!origin || !operatorOrigins().has(origin)) throw Object.assign(new Error('Недопустимый источник запроса'), { statusCode: 403 });
  const match = request.headers.cookie?.match(/(?:^|;\s*)chat_v8_refresh=([A-Za-z0-9_-]+)/);
  if (!match) throw Object.assign(new Error('Сеанс завершён'), { statusCode: 401 });
  return match[1];
}
function sessionResponse(request: FastifyRequest, reply: FastifyReply, pair: any) {
  noStore(reply);
  const web = request.headers['x-chat-client'] === 'web';
  if (web) {
    cookie(reply, pair.refresh_token, Math.max(1, Math.ceil((Date.parse(pair.refresh_expires_at) - Date.now()) / 86400000)));
    const { refresh_token, ...response } = pair;
    return response;
  }
  return pair;
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const { rows } = await pool.query('SELECT id, password_hash FROM chat_operators WHERE lower(email)=lower($1) AND is_active=true', [body.email.trim()]);
    // A dummy bcrypt cost also runs for unknown users to avoid a cheap timing oracle.
    const valid = await bcrypt.compare(body.password, rows[0]?.password_hash || '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
    const operator = valid && rows[0] ? await activeOperator(rows[0].id) : null;
    if (!operator) return reply.code(401).send({ error: 'Неверная почта или пароль' });
    return sessionResponse(request, reply, await createAuthSession(app, operator, body.installation_id, body.client_name));
  });

  app.post('/api/chat-v8/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    try {
      return sessionResponse(request, reply, await rotateAuthSession(app, refreshToken(request, body.refresh_token), body.installation_id));
    } catch (error) { cookie(reply, '', 0); noStore(reply); throw error; }
  });

  app.post('/api/chat-v8/auth/logout', async (request, reply) => {
    const body = z.object({ refresh_token: z.string().max(512).optional() }).parse(request.body || {});
    const family = await revokeRefresh(refreshToken(request, body.refresh_token));
    if (family) (app as any).io.in(`auth-family:${family}`).disconnectSockets(true);
    noStore(reply); cookie(reply, '', 0);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: [(app as any).authenticate] }, async request =>
    ({ operator: await activeOperator(operatorOf(request).id) }));

  app.get('/api/chat-v8/auth/sessions', { preHandler: [(app as any).authenticate] }, async request => {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (family_id) id, installation_id, client_name, created_at, last_used_at, expires_at,
        family_id=(SELECT family_id FROM chat_v8_auth_sessions WHERE id=$2) AS current FROM chat_v8_auth_sessions WHERE operator_id=$1 AND revoked_at IS NULL
        AND replaced_by IS NULL AND expires_at>now() ORDER BY family_id, created_at DESC`,
      [operatorOf(request).id, operatorOf(request).sid],
    );
    return rows;
  });
  app.delete('/api/chat-v8/auth/sessions/:id', { preHandler: [(app as any).authenticate] }, async (request, reply) => {
    const id = uuid.parse((request.params as any).id);
    const { rows } = await pool.query('SELECT family_id, operator_id, installation_id FROM chat_v8_auth_sessions WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Сеанс не найден' });
    if (rows[0].operator_id !== operatorOf(request).id && operatorOf(request).role !== 'admin') return reply.code(403).send({ error: 'Недостаточно прав' });
    await revokeFamily(rows[0].family_id);
    (app as any).io.in(`auth-family:${rows[0].family_id}`).disconnectSockets(true);
    return { ok: true };
  });
}
