import { pool, transaction } from "../db.js";
import type { Server } from "socket.io";
import { currentWidgetConfig, decideAutoInvite, readAutoInvitePolicy } from "./auto-invite.js";

interface OnlineVisitor {
  visitor_id: string;
  socket_id: string;
  current_page: string;
  current_page_title: string;
  referrer: string;
  country: string;
  city: string;
  browser: string;
  os: string;
  language: string;
  screen_resolution: string;
  last_ping: number;
  has_chat: boolean;
  chat_session_id: string | null;
  first_seen_at: string;
  session_count: number;
  session_started_at: number; // fix #12: track current session start
}

const onlineVisitors = new Map<string, OnlineVisitor>();
// Начало визита живёт дольше вкладки: переход на другую страницу не обнуляет время на сайте.
const visitStarts = new Map<string, { startedAt: number; lastSeen: number }>();
const VISIT_IDLE_MS = 30 * 60_000;
let ioRef: Server | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function initVisitorTracker(io: Server) {
  ioRef = io;

  // На старте сервиса in-memory map пуст — сбрасываем «зависший» online в БД,
  // чтобы не было ghost-посетителей после рестарта.
  pool.query(`UPDATE site_visitors SET is_online = false WHERE is_online = true`).catch(() => {});

  // Fix #11: clear previous interval on reinit
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  // TTL 60с (виджет пингует ~25-30с → запас на 2 пропущенных пинга),
  // sweep каждые 15с — offline появляется предсказуемо, без «через раз».
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const timeout = 60_000;

    for (const [visitorId, v] of onlineVisitors) {
      if (now - v.last_ping > timeout) {
        onlineVisitors.delete(visitorId);

        pool.query(
          `UPDATE site_visitors SET is_online = false, last_seen_at = NOW() WHERE visitor_id = $1`,
          [visitorId]
        ).catch(() => {});

        io.emit("visitor_offline", { visitor_id: visitorId });
      }
    }
    for (const [visitorId, visit] of visitStarts) if (now - visit.lastSeen > VISIT_IDLE_MS) visitStarts.delete(visitorId);
  }, 15_000);
}

export function destroyVisitorTracker() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  onlineVisitors.clear();
  visitStarts.clear();
  ioRef = null;
}

export function getOnlineCount(): number {
  return onlineVisitors.size;
}

export function getOnlineVisitors(): OnlineVisitor[] {
  return Array.from(onlineVisitors.values());
}

export async function handleVisitorPing(socketId: string, data: {
  visitor_id: string;
  page: string;
  title: string;
  referrer?: string;
  browser?: string;
  os?: string;
  language?: string;
  screen?: string;
}) {
  if (!data.visitor_id || !ioRef) return;

  const existing = onlineVisitors.get(data.visitor_id);
  const pageChanged = existing && (existing.current_page !== data.page);

  let hasChatResult = { has_chat: false, chat_session_id: null as string | null };
  try {
    const { rows } = await pool.query(
      `SELECT id FROM widget_chat_sessions WHERE visitor_id = $1 AND status != 'closed' ORDER BY created_at DESC LIMIT 1`,
      [data.visitor_id]
    );
    if (rows.length > 0) {
      hasChatResult = { has_chat: true, chat_session_id: rows[0].id };
    }
  } catch {}

  // Upsert to DB
  const { rows } = await pool.query(
    `INSERT INTO site_visitors (visitor_id, current_page, current_page_title, referrer, browser, os, language, screen_resolution, is_online, last_seen_at, has_chat, chat_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), $9, $10)
     ON CONFLICT (visitor_id) DO UPDATE SET
       current_page = EXCLUDED.current_page,
       current_page_title = EXCLUDED.current_page_title,
       referrer = COALESCE(EXCLUDED.referrer, site_visitors.referrer),
       browser = COALESCE(EXCLUDED.browser, site_visitors.browser),
       os = COALESCE(EXCLUDED.os, site_visitors.os),
       language = COALESCE(EXCLUDED.language, site_visitors.language),
       screen_resolution = COALESCE(EXCLUDED.screen_resolution, site_visitors.screen_resolution),
       is_online = true,
       last_seen_at = NOW(),
       has_chat = $9,
       chat_session_id = $10,
       session_count = CASE WHEN site_visitors.last_seen_at < NOW() - INTERVAL '30 minutes' THEN site_visitors.session_count + 1 ELSE site_visitors.session_count END
     RETURNING *`,
    [
      data.visitor_id,
      data.page || null,
      data.title || null,
      data.referrer || null,
      data.browser || null,
      data.os || null,
      data.language || null,
      data.screen || null,
      hasChatResult.has_chat,
      hasChatResult.chat_session_id,
    ]
  );

  const dbRow = rows[0];
  const isNew = !existing;

  // Карта пути: пишем переход ТОЛЬКО при смене страницы или для нового визитёра
  // (не на каждый heartbeat — без перегруза сервера)
  if ((pageChanged || isNew) && data.page) {
    pool.query(
      `INSERT INTO visitor_page_views (visitor_id, url, title, referrer) VALUES ($1, $2, $3, $4)`,
      [data.visitor_id, data.page, data.title || null, data.referrer || null]
    ).catch(() => {});
  }

  // Начало визита: общее для всех страниц и вкладок, пока посетитель не пропал на 30 минут.
  const now = Date.now();
  const visit = visitStarts.get(data.visitor_id) ?? { startedAt: now, lastSeen: now };
  visit.lastSeen = now;
  visitStarts.set(data.visitor_id, visit);
  const sessionStartedAt = visit.startedAt;

  // Update in-memory
  onlineVisitors.set(data.visitor_id, {
    visitor_id: data.visitor_id,
    socket_id: socketId,
    current_page: data.page || "",
    current_page_title: data.title || "",
    referrer: data.referrer || existing?.referrer || "",
    country: dbRow.country || "",
    city: dbRow.city || "",
    browser: data.browser || existing?.browser || "",
    os: data.os || existing?.os || "",
    language: data.language || existing?.language || "",
    screen_resolution: data.screen || existing?.screen_resolution || "",
    last_ping: Date.now(),
    has_chat: hasChatResult.has_chat,
    chat_session_id: hasChatResult.chat_session_id,
    first_seen_at: dbRow.first_seen_at,
    session_count: dbRow.session_count,
    session_started_at: sessionStartedAt,
  });

  // Emit events
  const visitorPayload = {
    id: dbRow.id,
    visitor_id: data.visitor_id,
    current_page: data.page || "",
    current_page_title: data.title || "",
    referrer: dbRow.referrer || "",
    country: dbRow.country || "",
    city: dbRow.city || "",
    browser: dbRow.browser || "",
    os: dbRow.os || "",
    session_count: dbRow.session_count || 1,
    first_seen_at: dbRow.first_seen_at,
    last_seen_at: dbRow.last_seen_at,
    is_online: true,
    has_chat: hasChatResult.has_chat,
    chat_session_id: hasChatResult.chat_session_id,
  };

  // Автоматическое приглашение — только по явной настройке владельца (по умолчанию выключено).
  if (!hasChatResult.has_chat) {
    await maybeAutoInvite(data.visitor_id, now - sessionStartedAt).catch((error) => {
      console.warn("[auto-invite] skipped:", (error as { code?: string })?.code || "error");
    });
  }

  if (isNew) {
    ioRef.emit("visitor_online", visitorPayload);
  } else if (pageChanged) {
    ioRef.emit("visitor_page_changed", {
      visitor_id: data.visitor_id,
      page: data.page,
      title: data.title,
    });
  }
  // Live-шаг карты пути (для открытой карточки посетителя)
  if ((pageChanged || isNew) && data.page) {
    ioRef.emit("visitor_path_step", {
      visitor_id: data.visitor_id,
      page: data.page,
      title: data.title || "",
      visited_at: new Date().toISOString(),
      is_current: true,
    });
  }
}

/**
 * Решение и запись приглашения выполняются под блокировкой посетителя,
 * поэтому две вкладки или параллельные пинги не создадут два приглашения.
 */
export async function maybeAutoInvite(visitorId: string, onSiteMs: number, now = Date.now()) {
  const config = await currentWidgetConfig();
  const policy = readAutoInvitePolicy(config);
  if (!policy.enabled || onSiteMs < policy.delayMs) return null;
  const invitation = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["widget-visitor:" + visitorId]);
    const hasChat = (await client.query("SELECT 1 FROM widget_chat_sessions WHERE visitor_id=$1 AND status<>'closed' LIMIT 1", [visitorId])).rowCount! > 0;
    const blocked = (await client.query("SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1", [visitorId])).rowCount! > 0;
    const operators = (await client.query("SELECT count(*)::int AS n FROM chat_operators WHERE is_active AND is_online AND status='online'")).rows[0].n as number;
    const last = (await client.query("SELECT max(created_at) AS at FROM proactive_invitations WHERE visitor_id=$1", [visitorId])).rows[0].at as Date | null;
    const decision = decideAutoInvite({ policy, hasChat, blocked, onSiteMs, operatorsOnline: operators, lastInvitationAt: last ? new Date(last).getTime() : null, now });
    if (decision !== "invite") return null;
    return (await client.query(
      "INSERT INTO proactive_invitations(visitor_id,message,auto_generated) VALUES($1,$2,true) RETURNING id,message",
      [visitorId, policy.message],
    )).rows[0] as { id: string; message: string };
  });
  if (!invitation || !ioRef) return invitation;
  // Приглашение подписано командой, а не выдуманным «консультантом».
  const sender = String(config.header_title || config.team_label || "Команда поддержки").slice(0, 100);
  ioRef.emit("invitation_sent", { id: invitation.id, visitor_id: visitorId, operator_name: sender, operator_avatar: null, message: invitation.message, auto: true });
  ioRef.emit("invitation_updated", { invitation_id: invitation.id, status: "sent", visitor_id: visitorId });
  return invitation;
}

export function handleVisitorLeave(visitorId: string) {
  if (!visitorId) return;
  onlineVisitors.delete(visitorId);

  pool.query(
    `UPDATE site_visitors SET is_online = false, last_seen_at = NOW() WHERE visitor_id = $1`,
    [visitorId]
  ).catch(() => {});

  ioRef?.emit("visitor_offline", { visitor_id: visitorId });
}

export function handleVisitorDisconnect(socketId: string) {
  for (const [visitorId, v] of onlineVisitors) {
    if (v.socket_id === socketId) {
      onlineVisitors.delete(visitorId);

      pool.query(
        `UPDATE site_visitors SET is_online = false, last_seen_at = NOW() WHERE visitor_id = $1`,
        [visitorId]
      ).catch(() => {});

      ioRef?.emit("visitor_offline", { visitor_id: visitorId });
      break;
    }
  }
} 