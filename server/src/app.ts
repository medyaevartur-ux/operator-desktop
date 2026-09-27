import { registerContactRoutes } from "./routes/contacts.js";
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { createReadStream,readFileSync } from 'node:fs';
const APP_VERSION=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
import { ZodError } from 'zod';
import { pool } from './db.js';
import { validateAccess } from './services/auth-sessions.js';
import { assertActor, operatorOf, requireRole } from './core/security.js';
import { createSocketServer, scopedBroadcaster } from './realtime/socket-server.js';
import { isOperatorOrigin, isPublicWidgetPath } from './core/origins.js';
import { startDeliveryWorker, type DeliveryTransport } from './services/delivery.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerOperatorRoutes } from './routes/operators.js';
import { registerNoteRoutes } from './routes/notes.js';
import { registerTagRoutes } from './routes/tags.js';
import { registerWidgetRoutes } from './routes/widget.js';
import { registerWidgetBotRoutes } from './routes/widget-bot.js';
import { registerVisitorRoutes } from './routes/visitors.js';
import { registerUpdaterRoutes } from './routes/updater.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerAutoResponseRoutes } from './routes/auto-responses.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerInvitationRoutes } from './routes/invitations.js';
import { registerPushRoutes } from './routes/push.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerVisitorIdentity } from './services/visitor-auth.js';
import { startAutoResponseCron, setIoRef } from './auto-response-cron.js';
import { initVisitorTracker, destroyVisitorTracker } from './services/visitor-tracker.js';

export async function buildApp(options: { backgroundJobs?: boolean; transport?: DeliveryTransport } = {}) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  const app = Fastify({ trustProxy: '127.0.0.1', bodyLimit: 65536, requestTimeout: 30000 });
  app.addHook('onRequest', async (request, reply) => {
    if (!isPublicWidgetPath(request.url.split('?')[0]) && !isOperatorOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Недопустимый источник запроса' });
  });
  await app.register(cors, {
    delegator: (request, callback) => {
      const widget = isPublicWidgetPath(request.url.split('?')[0]);
      callback(null, { origin: widget ? true : isOperatorOrigin(request.headers.origin), credentials: !widget,
        methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
        allowedHeaders: ['Content-Type','Authorization','X-Visitor-Id','X-Visitor-Token','X-Chat-Client','X-Client-Message-Id'] });
    },
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8 } });
  await mkdir(path.resolve('uploads'), { recursive: true });
  app.get('/uploads/avatars/:file', async (request, reply) => {
    const name = String((request.params as any).file);
    if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/.test(name)) return reply.code(404).send();
    const filename = path.resolve('uploads/avatars', name);
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile()) return reply.code(404).send();
    const extension = path.extname(name).slice(1);
    reply.type(`image/${extension === 'jpg' ? 'jpeg' : extension}`);
    return reply.send(createReadStream(filename));
  });
  await app.register(rateLimit, { global: false, max: 120, timeWindow: '1 minute', keyGenerator: request => request.ip });
  app.setErrorHandler((error: any, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Проверьте введённые данные', fields: error.issues.map(issue => issue.path.join('.')) });
    const code = Number(error.statusCode) >= 400 && Number(error.statusCode) < 500 ? Number(error.statusCode) : 500;
    if (code === 500) console.error('[api] Internal failure:', String(error.code || 'internal_error'));
    return reply.code(code).send({ error: code === 500 ? 'Ошибка сервера. Попробуйте ещё раз.' : error.message });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control','no-store');
    return payload;
  });
  app.decorate('authenticate', async (request: any, reply: any) => {
    if (request.chatAuthenticated) return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i,'');
    if (!token) return reply.code(401).send({ error: 'Войдите в аккаунт' });
    try { request.user = await validateAccess(app, token); request.chatAuthenticated = true; }
    catch { return reply.code(401).send({ error: 'Сеанс завершён. Войдите снова.' }); }
  });
  app.addHook('preHandler', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
    const configuration = /^\/api\/(settings\/|widget-settings\/|auto-responses)/.test(pathname);
    const presence = /^\/api\/operators\/([^/]+)\/(status|online|heartbeat|avatar)$/.exec(pathname);
    const authored = /^\/api\/(messages\/|sessions\/[^/]+\/(notes|messages)|invitations)/.test(pathname);
    if (!configuration && !presence && !authored) return;
    await (app as any).authenticate(request, reply);
    if (reply.sent) return;
    if (configuration && !requireRole(request, reply, ['admin','supervisor'])) return;
    if (presence && presence[1] !== operatorOf(request).id && !requireRole(request, reply, ['admin'])) return;
    if (authored && request.body && typeof request.body === 'object' && !request.isMultipart()) assertActor(request, (request.body as any).operator_id);
  });
  const rawIo = createSocketServer(app);
  const io = scopedBroadcaster(rawIo);
  app.decorate('io', io);
  registerVisitorIdentity(app);
  registerAuthRoutes(app); registerSessionRoutes(app); registerMessageRoutes(app);
  registerOperatorRoutes(app); registerNoteRoutes(app); registerTagRoutes(app);
  registerWidgetRoutes(app); registerWidgetBotRoutes(app); registerVisitorRoutes(app);
  registerUpdaterRoutes(app); registerUploadRoutes(app); registerAutoResponseRoutes(app);
  registerSettingsRoutes(app); registerInvitationRoutes(app); registerPushRoutes(app);
  registerDeviceRoutes(app);
  registerWorkspaceRoutes(app);
  registerContactRoutes(app);
  app.get('/api/chat-v8/meta', async () => ({ version:APP_VERSION, socket_auth_required:true, min_client_version:'8.0.0-beta.1', vapid_public_key:process.env.WEB_PUSH_PUBLIC_KEY || null }));
  app.get('/health', async () => { await pool.query('SELECT 1'); return { ok:true, service:'zhivaya-chat-v8',version:APP_VERSION }; });
  const stops: Array<() => void | Promise<void>> = [];
  if (options.backgroundJobs) {
    setIoRef(io); initVisitorTracker(io);
    stops.push(startAutoResponseCron());
    if (options.transport) stops.push(startDeliveryWorker(rawIo, options.transport));
  }
  app.addHook('preClose', async () => {
    await Promise.all(stops.map(stop => stop()));
    if (options.backgroundJobs) destroyVisitorTracker();
    await new Promise<void>(resolve => rawIo.close(() => resolve()));
  });
  return { app, io: rawIo };
}
