import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { z } from 'zod';
import { pool } from '../db.js';
import { validateAccess } from '../services/auth-sessions.js';
import { verifyVisitor } from '../services/visitor-auth.js';
import { handleVisitorDisconnect, handleVisitorLeave, handleVisitorPing } from '../services/visitor-tracker.js';

const idSchema = z.string().uuid();
const visitorSchema = z.string().min(5).max(100);
const pingSchema = z.object({
  visitor_id: visitorSchema,
  page: z.string().max(2000).default(''), title: z.string().max(500).default(''),
  referrer: z.string().max(2000).optional(), browser: z.string().max(100).optional(),
  os: z.string().max(100).optional(), language: z.string().max(50).optional(), screen: z.string().max(50).optional(),
});

export function createSocketServer(app: FastifyInstance) {
  const io = new Server(app.server, { path: '/ws', cors: { origin: true }, maxHttpBufferSize: 32000 });
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      // Visitors are admitted to an empty socket. Every room/action below
      // separately verifies ownership; there is no anonymous operator room.
      if (socket.handshake.auth?.visitor_token) {
        try {
          socket.data.visitorId=verifyVisitor(app,socket.handshake.auth.visitor_token);
          socket.data.visitorExpiry=app.jwt.decode<any>(socket.handshake.auth.visitor_token)?.exp;
          if ((await pool.query('SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1',[socket.data.visitorId])).rowCount) throw new Error('blocked');
        }
        catch { next(new Error('Unauthorized')); return; }
      }
      next(); return;
    }
    if (typeof token !== 'string' || token.length > 8192) { next(new Error('Unauthorized')); return; }
    try {
      socket.data.operator = await validateAccess(app, token);
      const { rows } = await pool.query('SELECT family_id FROM chat_v8_auth_sessions WHERE id=$1', [socket.data.operator.sid]);
      socket.data.familyId = rows[0].family_id;
      next();
    } catch { next(new Error('Unauthorized')); }
  });

  io.on('connection', socket => {
    let expiry: ReturnType<typeof setTimeout> | undefined;
    if (socket.data.operator) {
      const operator = socket.data.operator;
      void socket.join(['operators', `operator:${operator.id}`, `auth-family:${socket.data.familyId}`, `installation:${operator.installation_id}`]);
      expiry = setTimeout(() => { socket.emit('auth_expired'); socket.disconnect(true); }, Math.max(0, operator.exp * 1000 - Date.now()));
    }
    if (socket.data.visitorId) {
      void socket.join(`visitor:${socket.data.visitorId}`);
      expiry = setTimeout(() => { socket.emit('visitor_auth_expired'); socket.disconnect(true); }, Math.max(0,Math.min(86400000,socket.data.visitorExpiry * 1000 - Date.now())));
    }
    let budget = 50, lastRefill = Date.now();
    socket.use((_packet, next) => {
      const now = Date.now(); budget = Math.min(50, budget + (now - lastRefill) / 100); lastRefill = now;
      if (budget < 1) { socket.disconnect(true); return; }
      budget--; next();
    });
    socket.on('join_session', async (payload, acknowledge) => {
      const answer = (ok: boolean) => { if (typeof acknowledge === 'function') acknowledge({ ok }); };
      try {
        const id = idSchema.safeParse(typeof payload === 'string' ? payload : payload?.sessionId);
        if (!id.success || socket.rooms.size > 32) { answer(false); return; }
        const { rows } = await pool.query('SELECT visitor_id FROM widget_chat_sessions WHERE id=$1', [id.data]);
        if (!rows[0]) { answer(false); return; }
        if (!socket.data.operator) {
          const visitor = visitorSchema.safeParse(payload?.visitorId);
          if (!visitor.success || rows[0].visitor_id !== visitor.data || socket.data.visitorId !== visitor.data) { answer(false); return; }
          await socket.join(`visitor:${visitor.data}`);
        }
        await socket.join(`session:${id.data}`);
        answer(true);
      } catch { answer(false); }
    });
    socket.on('leave_session', id => { if (idSchema.safeParse(id).success) void socket.leave(`session:${id}`); });
    socket.on('typing', data => {
      if (!idSchema.safeParse(data?.sessionId).success || !socket.rooms.has(`session:${data.sessionId}`)) return;
      socket.to(`session:${data.sessionId}`).emit('typing', { sessionId: data.sessionId, sender: socket.data.operator ? 'operator' : 'visitor' });
    });
    let lastTyping = 0;
    socket.on('typing_content', data => {
      if (socket.data.operator || !idSchema.safeParse(data?.sessionId).success || !socket.rooms.has(`session:${data.sessionId}`)) return;
      if (typeof data.text !== 'string' || data.text.length > 10000 || typeof data.isTyping !== 'boolean') return;
      if (data.isTyping && Date.now() - lastTyping < 250) return;
      lastTyping = Date.now();
      io.to('operators').emit('typing_content', { sessionId: data.sessionId, text: data.text, isTyping: data.isTyping });
    });
    socket.on('visitor_ping', async data => {
      if (socket.data.operator) return;
      const parsed = pingSchema.safeParse(data);
      if (!parsed.success || socket.data.visitorId !== parsed.data.visitor_id) return;
      await socket.join(`visitor:${parsed.data.visitor_id}`);
      await handleVisitorPing(socket.id, parsed.data).catch(() => {});
    });
    socket.on('visitor_leave', data => {
      const id = typeof data === 'string' ? data : data?.visitor_id;
      if (id && id === socket.data.visitorId) handleVisitorLeave(id);
    });
    socket.on('disconnect', () => {
      clearTimeout(expiry);
      if (!socket.data.operator) handleVisitorDisconnect(socket.id);
    });
  });
  return io;
}

/** Adapts existing routes to private broadcasts. Message inserts are delivered
 * by the durable outbox trigger, so a crash after COMMIT cannot lose the event. */
export function scopedBroadcaster(io: Server): Server {
  const protect = (operator: any) => new Proxy(operator, {
    get(target, key) {
      if (key === 'emit') return (event: string, payload: any) => {
        if (['new_message','message_updated','message_deleted','reaction_updated','message_status_changed'].includes(event)) return true;
        return target.emit(event, payload);
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(io, {
    get(target, key) {
      if (key === 'emit') return (event: string, payload: any) => {
        if (['new_message','message_updated','message_deleted','reaction_updated','message_status_changed'].includes(event)) return true;
        if (event === 'invitation_sent' && payload?.visitor_id) {
          target.to(`visitor:${payload.visitor_id}`).emit(event, payload);
        }
        if (event === 'operator_status_changed') target.except('operators').emit(event, {});
        return target.to('operators').emit(event, payload);
      };
      if (key === 'to') return (room: string | string[]) => protect(target.to(room));
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
