import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, transaction } from "../db.js";
import { sendPushToSession } from "../services/push.js";
import { createMessage, enrichMessages } from "../services/messages.js";
import { AUTO_INVITE_DEFAULTS, AUTO_INVITE_KEYS, forgetWidgetConfig } from "../services/auto-invite.js";

// ═══ SETTINGS KEYS ═══
const SETTINGS_KEYS = {
  WIDGET_CONFIG: "widget_config",
  PRECHAT_FORM: "prechat_form",
  BUSINESS_HOURS: "business_hours",
  ALLOWED_DOMAINS: "allowed_domains",
} as const;

// ═══ ZOD SCHEMAS ═══
const uuidArraySchema = z.object({
  message_ids: z.array(z.string().uuid()).max(200).optional(),
});

const visitorSessionSchema = z.object({
  visitor_id: z.string().min(5).max(100),
  visitor_name: z.string().max(100).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(30).optional(),
  form_data: z.record(z.string(), z.string().max(500)).optional(),
  current_page: z.string().max(2000).optional(),
  user_agent: z.string().max(500).optional(),
  auto_message_id: z.string().max(100).optional(),
  auto_message_shown_at: z.string().max(40).optional(),
});

// Публичный виджетный постинг: посетитель может слать ТОЛЬКО как 'visitor'.
// 'ai' и 'system' писать через этот эндпоинт нельзя — бот-рантайм пишет в БД напрямую
// (services/widget-bot/runtime.js), а системные сообщения генерит сервер. Это закрывает
// подделку фейковых системных/AI-сообщений со стороны посетителя.
const messageSchema = z.object({
  sender: z.literal("visitor"),
  client_message_id: z.string().uuid().optional(),
  message: z.string().min(1).max(10000),
});

const statusSchema = z.object({
  status: z.enum(["ai", "waiting_operator", "with_operator", "closed"]),
});

const pageSchema = z.object({
  url: z.string().max(2000).optional(),
  title: z.string().max(500).optional(),
});

const ratingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const colorRegex = /^#[0-9a-fA-F]{3,8}$/;
/** Число вне диапазона приводится к ближайшей границе: одно лишнее значение не должно выбрасывать всю настройку. */
const within = (min: number, max: number) => z.number().transform(value => Math.min(max, Math.max(min, Math.round(value))));

const autoMessageSchema = z.object({
  id: z.string().max(50),
  enabled: z.boolean(),
  trigger: z.enum(["first_visit", "return_visit", "on_page", "after_idle", "cart_abandon"]),
  delay_seconds: within(0, 300),
  message: z.string().max(1000),
  sender_name: z.string().max(100),
  sender_avatar: z.string().max(500).optional(),
  page_filter: z.string().max(500).optional(),
  show_once: z.boolean(),
});

const abVariantSchema = z.object({
  greeting: z.string().max(1000),
  weight: within(0, 100),
});

const triggersSchema = z.object({
  exit_intent: z.boolean().optional(),
  scroll_percent: within(1, 100).nullable().optional(),
  time_on_page: within(1, 600).nullable().optional(),
  page_url_contains: z.string().max(500).optional(),
  inactivity_seconds: within(5, 600).nullable().optional(),
}).optional();

const widgetConfigSchema = z.object({
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  color: z.string().regex(colorRegex).optional(),
  greeting: z.string().max(1000).optional(),
  header_title: z.string().max(200).optional(),
  avatar_url: z.string().max(500).nullable().optional(),
  show_operator_name: z.boolean().optional(),
  show_operator_avatar: z.boolean().optional(),
  button_icon: z.enum(["chat", "help", "custom"]).optional(),
  button_text: z.string().max(100).optional(),
  button_size: z.enum(["small", "medium", "large"]).optional(),
  button_radius: z.enum(["round", "rounded", "square"]).optional(),
  auto_open_delay: within(0, 600).optional(),
  hide_on_mobile: z.boolean().optional(),
  custom_css: z.string().max(10000).optional(),
  // 1.1 Gradient
  gradient_type: z.enum(["solid", "gradient", "glass", "animated"]).optional(),
  gradient_from: z.string().regex(colorRegex).optional(),
  gradient_to: z.string().regex(colorRegex).optional(),
  gradient_angle: within(0, 360).optional(),
  // 1.2 Theme
  theme: z.enum(["light", "dark", "auto", "custom"]).optional(),
  custom_bg: z.string().regex(colorRegex).optional(),
  custom_text: z.string().regex(colorRegex).optional(),
  custom_bubble_bg: z.string().regex(colorRegex).optional(),
  custom_border: z.string().regex(colorRegex).optional(),
  // 1.3 Animation
  open_animation: z.enum(["slide", "pop", "fade", "bounce", "flip"]).optional(),
  // 1.4 Launcher
  launcher_type: z.enum(["icon_only", "icon_text", "text_only", "card"]).optional(),
  launcher_text: z.string().max(200).optional(),
  launcher_subtext: z.string().max(200).optional(),
  launcher_show_avatar: z.boolean().optional(),
  launcher_pulse: z.boolean().optional(),
  // 1.5 Font
  font_family: z.enum(["system", "inter", "roboto", "montserrat", "onest", "custom"]).optional(),
  custom_font_url: z.string().max(500).optional(),
  // 2.1 Triggers
  triggers: triggersSchema,
  // 2.2 Quick replies
  quick_replies_enabled: z.boolean().optional(),
  quick_replies: z.array(z.string().max(200)).max(10).optional(),
  // 2.3 Response time
  response_time_enabled: z.boolean().optional(),
  response_time_label: z.string().max(200).optional(),
  // 3.1 Team
  team_mode: z.boolean().optional(),
  team_avatars_count: within(1, 10).optional(),
  team_label: z.string().max(200).optional(),
  team_online_text: z.string().max(200).optional(),
  // 4.1 Offline
  offline_mode: z.enum(["message_only", "email_capture", "callback_request", "redirect"]).optional(),
  offline_redirect_url: z.string().max(500).optional(),
  // 2.2 Auto messages
  auto_messages: z.array(autoMessageSchema).max(20).optional(),
  // 4.2 A/B testing
  ab_test_enabled: z.boolean().optional(),
  ab_variants: z.object({
    a: abVariantSchema,
    b: abVariantSchema,
  }).optional(),
  ab_metric: z.enum(["open_rate", "message_rate", "rating"]).optional(),
  // 6.1 Page rules
  page_rules: z.array(z.object({
    id: z.string().max(50),
    pattern: z.string().max(500),
    match_type: z.enum(["exact", "contains", "regex"]),
    override: z.record(z.string(), z.any()),
    enabled: z.boolean(),
  })).max(50).optional(),
  // 6.3 Identity
  identity_verification: z.boolean().optional(),
  // ═══ Layout / appearance (parity keys, ранее жили только через .passthrough()) ═══
  font_size_base: within(8, 32).optional(),
  window_width: z.enum(["narrow", "normal", "wide"]).optional(),
  edge_margin: within(0, 200).optional(),
  bubble_radius: z.enum(["sharp", "round", "soft"]).optional(),
  // Ровно те значения, которые рисует widget.js (buildCss): subtle / medium / strong.
  shadow_intensity: z.enum(["subtle", "medium", "strong"]).optional(),
  remember_open_state: z.boolean().optional(),
  greet_once: z.boolean().optional(),
  auto_minimize_after: within(0, 3600).optional(),
  hide_unread_badge: z.boolean().optional(),
  disable_sound_for_visitor: z.boolean().optional(),
  // ═══ Mobile ═══
  mobile_launcher_type: z.string().max(50).optional(),
  mobile_window_mode: z.enum(["fullscreen", "bottom_sheet", "popup"]).optional(),
  mobile_invitation_enabled: z.boolean().optional(),
  mobile_invitation_text: z.string().max(500).optional(),
  mobile_invitation_delay: within(0, 600).optional(),
  mobile_hide_unread_badge: z.boolean().optional(),
  // ═══ Display rules ═══
  display_pages: z.string().max(5000).optional(),
  display_pages_mode: z.enum(["all", "include", "exclude"]).optional(),
  // ═══ Header / footer redesign ═══
  header_style: z.enum(["light", "accent"]).optional(),
  show_powered_by: z.boolean().optional(),
  // ═══ Автоматические приглашения: одна явная настройка ═══
  auto_invite_enabled: z.boolean().optional(),
  auto_invite_delay: within(15, 3600).optional(),
  auto_invite_message: z.string().trim().min(1).max(500).optional(),
  auto_invite_cooldown_hours: within(1, 720).optional(),
  hidden_paths: z.array(z.string().max(200)).max(50).optional(),
}).passthrough();

/** Сохраняем только проверенные значения: ошибочное поле откатывается к умолчанию, остальное не теряется. */
function sanitizeWidgetConfig(body: unknown): { config: Record<string, unknown>; dropped: string[] } {
  const input = body && typeof body === "object" && !Array.isArray(body) ? { ...(body as Record<string, unknown>) } : {};
  const dropped = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    const parsed = widgetConfigSchema.safeParse(input);
    if (parsed.success) {
      const config = parsed.data as Record<string, unknown>;
      // Правила страниц не могут включать автоматические приглашения в обход общей настройки.
      if (Array.isArray(config.page_rules)) {
        config.page_rules = (config.page_rules as Array<{ override: Record<string, unknown> }>).map(rule => ({
          ...rule,
          override: Object.fromEntries(Object.entries(rule.override ?? {}).filter(([key]) => !AUTO_INVITE_KEYS.includes(key))),
        }));
      }
      return { config, dropped: [...dropped] };
    }
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key) { dropped.add(key); delete input[key]; }
    }
  }
  return { config: {}, dropped: [...dropped] };
}

const prechatFieldSchema = z.object({
  name: z.string().max(50),
  label: z.string().max(200),
  type: z.enum(["text", "email", "tel", "select", "textarea"]),
  required: z.boolean(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string().max(200)).max(50).optional(),
});

const prechatFormSchema = z.object({
  enabled: z.boolean(),
  fields: z.array(prechatFieldSchema).max(20),
});

const dayScheduleSchema = z.object({
  enabled: z.boolean(),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});

const businessHoursSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().max(100),
  offline_message: z.string().max(500),
  schedule: z.object({
    mon: dayScheduleSchema,
    tue: dayScheduleSchema,
    wed: dayScheduleSchema,
    thu: dayScheduleSchema,
    fri: dayScheduleSchema,
    sat: dayScheduleSchema,
    sun: dayScheduleSchema,
  }),
});

const domainSettingsSchema = z.object({
  enabled: z.boolean(),
  domains: z.array(z.string().max(200)).max(100),
  rate_limit: within(1, 1000),
});

// ═══ OPERATOR CACHE (fix N+1) ═══
const operatorCache = new Map<string, { name: string; avatar_url: string | null; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function enrichSession(session: any) {
  if (!session || !session.operator_id) return session;

  const cached = operatorCache.get(session.operator_id);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    session.operator_name = cached.name;
    session.operator_avatar_url = cached.avatar_url;
    return session;
  }

  const { rows } = await pool.query(
    `SELECT name, avatar_url FROM chat_operators WHERE id = $1`,
    [session.operator_id]
  );
  if (rows.length) {
    operatorCache.set(session.operator_id, {
      name: rows[0].name,
      avatar_url: rows[0].avatar_url,
      cachedAt: Date.now(),
    });
    session.operator_name = rows[0].name;
    session.operator_avatar_url = rows[0].avatar_url;
  }
  return session;
}

// ═══ DEFAULTS ═══
const DEFAULT_WIDGET_CONFIG = {
  position: "bottom-right",
  color: "#C15F3C",
  greeting: "Привет! 👋\nЧем могу помочь?",
  header_title: "Онлайн-чат",
  avatar_url: null,
  show_operator_name: true,
  show_operator_avatar: true,
  button_icon: "chat",
  button_text: "",
  button_size: "medium",
  button_radius: "round",
  auto_open_delay: 0,
  hide_on_mobile: false,
  custom_css: "",
  // 1.1 Gradient
  gradient_type: "solid",
  gradient_from: "#C15F3C",
  gradient_to: "#E0906B",
  gradient_angle: 135,
  // 1.2 Theme
  theme: "light",
  custom_bg: "#ffffff",
  custom_text: "#1f2937",
  custom_bubble_bg: "#f3f4f6",
  custom_border: "#e5e7eb",
  // 1.3 Animation
  open_animation: "slide",
  // 1.4 Launcher
  launcher_type: "icon_only",
  launcher_text: "Нужна помощь?",
  launcher_subtext: "Обычно отвечаем за 2 мин",
  launcher_show_avatar: true,
  launcher_pulse: true,
  // 1.5 Font
  font_family: "system",
  custom_font_url: "",
  // 2.1 Triggers
  triggers: {
    exit_intent: false,
    scroll_percent: null,
    time_on_page: null,
    page_url_contains: "",
    inactivity_seconds: null,
  },
  // 2.2 Quick replies
  quick_replies_enabled: false,
  quick_replies: [],
  // 2.3 Response time
  response_time_enabled: false,
  response_time_label: "Обычно отвечаем за 2 мин",
  // 3.1 Team
  team_mode: false,
  team_avatars_count: 3,
  team_label: "Команда поддержки",
  team_online_text: "{n} онлайн",
  // 4.1 Offline
  offline_mode: "message_only",
  offline_redirect_url: "",
  // 2.2 Auto messages
  auto_messages: [],
  // 4.2 A/B
  ab_test_enabled: false,
  ab_variants: {
    a: { greeting: "Привет! 👋 Чем помочь?", weight: 50 },
    b: { greeting: "Здравствуйте! Задайте вопрос 💬", weight: 50 },
  },
  ab_metric: "message_rate",
  // 6.1 Page rules
  page_rules: [],
  // 6.3 Identity
  identity_verification: false,
  // ═══ Layout / appearance ═══
  font_size_base: 14,
  window_width: "normal",
  edge_margin: 24,
  bubble_radius: "round",
  shadow_intensity: "medium",
  remember_open_state: true,
  greet_once: false,
  auto_minimize_after: 0,
  hide_unread_badge: false,
  disable_sound_for_visitor: false,
  // ═══ Mobile ═══
  mobile_launcher_type: "inherit",
  mobile_window_mode: "bottom_sheet",
  mobile_invitation_enabled: true,
  mobile_invitation_text: "Нужна помощь? Нажмите!",
  mobile_invitation_delay: 5,
  mobile_hide_unread_badge: false,
  // ═══ Display rules ═══
  display_pages: "",
  display_pages_mode: "all",
  // ═══ Header / footer redesign ═══
  header_style: "light",
  show_powered_by: true,
  // ═══ Автоматические приглашения (выключены, пока владелец не включит) ═══
  ...AUTO_INVITE_DEFAULTS,
  // Служебные страницы магазина, где виджет не нужен
  hidden_paths: ["/admin", "/upload"],
};

const DEFAULT_PRECHAT = {
  enabled: true,
  fields: [
    { name: "name", label: "Как вас зовут?", type: "text", required: true, placeholder: "Ваше имя" },
  ],
};

const DEFAULT_BUSINESS_HOURS = {
  enabled: false,
  timezone: "Europe/Moscow",
  offline_message: "Мы сейчас офлайн. Оставьте сообщение!",
  schedule: {
    mon: { enabled: true, from: "09:00", to: "18:00" },
    tue: { enabled: true, from: "09:00", to: "18:00" },
    wed: { enabled: true, from: "09:00", to: "18:00" },
    thu: { enabled: true, from: "09:00", to: "18:00" },
    fri: { enabled: true, from: "09:00", to: "18:00" },
    sat: { enabled: false, from: "10:00", to: "16:00" },
    sun: { enabled: false, from: "10:00", to: "16:00" },
  },
};

const DEFAULT_DOMAINS = { enabled: false, domains: [], rate_limit: 30 };

// ═══ AUTH preHandler ═══
async function requireAuth(request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
  }
}

// ═══ WIDGET SESSION OWNERSHIP ═══
// Виджет шлёт заголовок 'X-Visitor-Id: <visitor_id>' на всех /sessions/:id и /:id/* запросах.
// Привязываем доступ к владельцу сессии по visitor_id, чтобы посторонний посетитель не мог
// читать/писать чужую сессию по угаданному UUID.
// Контракт: новый widget.min.js (шлёт заголовок) деплоится ПЕРЕД сервером + сброс кэша,
// поэтому строгий 403 при отсутствии заголовка допустим. Логируем warn для диагностики.
// Возвращает true если доступ разрешён; иначе уже отправил 403 и вернул false.
function assertOwner(request: any, reply: any, sessionRow: any): boolean {
  // Если у сессии нет visitor_id (старые/служебные записи) — не блокируем.
  if (!sessionRow?.visitor_id) { reply.code(403).send({ error: "forbidden" }); return false; }
  const vid = request.headers["x-visitor-id"];
  if (!vid || vid !== sessionRow.visitor_id) {
    request.log?.warn?.(
      { sessionId: sessionRow.id, hasHeader: !!vid },
      "[widget] ownership check failed (403)"
    );
    reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}

// ═══ MAIN REGISTRATION ═══
export function registerWidgetRoutes(app: FastifyInstance) {

  // ────────────────────────────────────────────
  // PUBLIC WIDGET ROUTES (no auth)
  // ────────────────────────────────────────────

  // Create session
  app.post("/api/widget/sessions", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const parsed = visitorSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid data", details: parsed.error.issues });
    }
    const { visitor_id, visitor_name, email, phone, form_data, current_page } = parsed.data;

    const result=await transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['widget-visitor:'+visitor_id]);
      if((await client.query('SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1',[visitor_id])).rowCount)throw Object.assign(new Error('blocked'),{statusCode:403});
      const existing=await client.query("SELECT * FROM widget_chat_sessions WHERE visitor_id=$1 AND status<>'closed' ORDER BY created_at DESC LIMIT 1",[visitor_id]);
      if(existing.rows[0])return {session:existing.rows[0],created:false};
      const counts=await client.query('SELECT count(*)::int AS cnt,bool_or(is_vip) AS vip FROM widget_chat_sessions WHERE visitor_id=$1',[visitor_id]);
      const count=(counts.rows[0]?.cnt||0)+1,vip=counts.rows[0]?.vip===true;
      const online=await client.query("SELECT 1 FROM chat_operators WHERE is_active AND is_online AND status='online' LIMIT 1");
      const status=online.rowCount?'waiting_operator':'ai';
      const {rows}=await client.query(`INSERT INTO widget_chat_sessions(visitor_id,visitor_name,visitor_email,visitor_phone,form_data,current_page,status,priority,is_vip,visit_count,queued_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $7='waiting_operator' THEN now() ELSE NULL END) RETURNING *`,
        [visitor_id,visitor_name||null,email||null,phone||null,form_data?JSON.stringify(form_data):null,current_page||null,status,vip?'urgent':count>3?'high':'normal',vip,count]);
      await client.query("INSERT INTO site_visitors(visitor_id,current_page,has_chat,chat_session_id) VALUES($1,$2,true,$3) ON CONFLICT(visitor_id) DO UPDATE SET has_chat=true,chat_session_id=EXCLUDED.chat_session_id",[visitor_id,current_page||null,rows[0].id]);
      // Автосообщение, которое посетитель видел до первого ответа, становится началом истории —
      // текст берётся из настроек, а не из запроса.
      if (parsed.data.auto_message_id) {
        const saved = (await client.query("SELECT value FROM chat_settings WHERE key='widget_config'")).rows[0]?.value;
        const config = typeof saved === "string" ? JSON.parse(saved) : saved;
        const auto = Array.isArray(config?.auto_messages) ? config.auto_messages.find((item: { id?: unknown; enabled?: unknown }) => String(item?.id) === parsed.data.auto_message_id && item?.enabled) : null;
        if (auto && typeof auto.message === "string" && auto.message.trim()) {
          // Подпись та же, что видел посетитель: «от имени» из настроек, иначе заголовок окна.
          const senderName = (typeof auto.sender_name === "string" && auto.sender_name.trim()) || (typeof config?.header_title === "string" && config.header_title.trim()) || "Команда поддержки";
          const metadata = { kind: "auto_message", auto_message_id: String(auto.id), sender_name: senderName.slice(0, 100) };
          // Время, когда посетитель увидел сообщение, — если оно правдоподобно по часам базы: за последние сутки и раньше ответа.
          const shownAt = Date.parse(parsed.data.auto_message_shown_at || "");
          await client.query(`INSERT INTO widget_chat_messages(session_id,sender,message,message_type,status,metadata,created_at)
            VALUES($1,'ai',$2,'text','delivered',$3,CASE WHEN $4::timestamptz BETWEEN now()-interval '1 day' AND now()-interval '1 second' THEN $4::timestamptz ELSE now()-interval '1 second' END)`,
            [rows[0].id, auto.message.trim().slice(0, 1000), JSON.stringify(metadata), Number.isFinite(shownAt) ? new Date(shownAt).toISOString() : null]);
        }
      }
      return {session:rows[0],created:true};
    });
    if(result.created){(app as any).io.emit('new_session',result.session);if(result.session.status==='waiting_operator')(app as any).io.emit('queue_updated',{session_id:result.session.id,action:'added'});}
    return enrichSession(result.session);
  });

  // Get session by visitor_id
  app.get("/api/widget/sessions", async (request) => {
    const { visitor_id } = request.query as { visitor_id: string };
    if (!visitor_id) return null;

    const { rows } = await pool.query(
      `SELECT * FROM widget_chat_sessions
       WHERE visitor_id = $1 AND status != 'closed'
       ORDER BY created_at DESC LIMIT 1`,
      [visitor_id]
    );

    if (!rows[0]) return null;
    return enrichSession(rows[0]);
  });

  // Get session by id
  app.get("/api/widget/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `SELECT * FROM widget_chat_sessions WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    if (!assertOwner(request, reply, rows[0])) return;
    return enrichSession(rows[0]);
  });

  // Get messages (widget — hide internal, include reactions)
  app.get("/api/widget/sessions/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };

    // Ownership: грузим минимально сессию для проверки владельца
    const { rows: sess } = await pool.query(
      `SELECT id, visitor_id FROM widget_chat_sessions WHERE id = $1`,
      [id]
    );
    if (!sess[0]) return [];
    if (!assertOwner(request, reply, sess[0])) return;

    const { rows } = await pool.query(
      `SELECT * FROM widget_chat_messages
       WHERE session_id = $1 AND (is_internal IS NULL OR is_internal = false)
       ORDER BY created_at ASC`,
      [id]
    );

    return enrichMessages(rows);
  });

  // Visitor identity and idempotency are checked in the shared transaction.
  app.post("/api/widget/sessions/:id/messages", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request) => {
    const id = z.string().uuid().parse((request.params as any).id);
    const body = messageSchema.parse(request.body);
    const result = await createMessage(id, body, { visitorId: String(request.headers["x-visitor-id"] || "") });
    if (result.created) (app as any).io.emit("session_updated", { session_id: id });
    return result.message;
  });

  // Mark delivered (with UUID validation)
  app.patch("/api/widget/sessions/:id/messages/deliver", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = uuidArraySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid message_ids" });
    }
    const { message_ids } = parsed.data;

    // Ownership
    const { rows: sess } = await pool.query(
      `SELECT id, visitor_id FROM widget_chat_sessions WHERE id = $1`,
      [id]
    );
    if (!sess[0]) return reply.code(404).send({ error: "Session not found" });
    if (!assertOwner(request, reply, sess[0])) return;

    let result;
    if (message_ids && message_ids.length > 0) {
      result = await pool.query(
        `UPDATE widget_chat_messages
         SET status = CASE WHEN status = 'sent' THEN 'delivered' ELSE status END,
             delivered_at = COALESCE(delivered_at, NOW())
         WHERE session_id = $1 AND id = ANY($2) AND sender = 'operator' AND status = 'sent'
         RETURNING id, status, delivered_at`,
        [id, message_ids]
      );
    } else {
      result = await pool.query(
        `UPDATE widget_chat_messages
         SET status = 'delivered',
             delivered_at = COALESCE(delivered_at, NOW())
         WHERE session_id = $1 AND sender = 'operator' AND status = 'sent'
         RETURNING id, status, delivered_at`,
        [id]
      );
    }

    if (result.rows.length > 0) {
      const io = (app as any).io;
      io.to(`session:${id}`).emit("message_status_changed", {
        session_id: id,
        messages: result.rows.map((r: any) => ({ id: r.id, status: r.status, delivered_at: r.delivered_at })),
      });
    }
    return { ok: true, updated: result.rows.length };
  });

  // Mark read (with UUID validation)
  app.patch("/api/widget/sessions/:id/messages/read", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = uuidArraySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid message_ids" });
    }
    const { message_ids } = parsed.data;

    // Ownership
    const { rows: sess } = await pool.query(
      `SELECT id, visitor_id FROM widget_chat_sessions WHERE id = $1`,
      [id]
    );
    if (!sess[0]) return reply.code(404).send({ error: "Session not found" });
    if (!assertOwner(request, reply, sess[0])) return;

    let result;
    if (message_ids && message_ids.length > 0) {
      result = await pool.query(
        `UPDATE widget_chat_messages
         SET status = 'read',
             delivered_at = COALESCE(delivered_at, NOW()),
             read_at = COALESCE(read_at, NOW())
         WHERE session_id = $1 AND id = ANY($2) AND sender = 'operator' AND status != 'read'
         RETURNING id, status, read_at`,
        [id, message_ids]
      );
    } else {
      result = await pool.query(
        `UPDATE widget_chat_messages
         SET status = 'read',
             delivered_at = COALESCE(delivered_at, NOW()),
             read_at = COALESCE(read_at, NOW())
         WHERE session_id = $1 AND sender = 'operator' AND status != 'read'
         RETURNING id, status, read_at`,
        [id]
      );
    }

    if (result.rows.length > 0) {
      const io = (app as any).io;
      io.to(`session:${id}`).emit("message_status_changed", {
        session_id: id,
        messages: result.rows.map((r: any) => ({ id: r.id, status: r.status, read_at: r.read_at })),
      });
    }
    return { ok: true, updated: result.rows.length };
  });

  // Update page
  app.patch("/api/widget/sessions/:id/page", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = pageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid data" });
    }

    // Ownership
    const { rows: sess } = await pool.query(
      `SELECT id, visitor_id FROM widget_chat_sessions WHERE id = $1`,
      [id]
    );
    if (!sess[0]) return reply.code(404).send({ error: "Session not found" });
    if (!assertOwner(request, reply, sess[0])) return;

    await pool.query(
      `UPDATE widget_chat_sessions
       SET current_page = COALESCE($2, current_page),
           current_page_title = COALESCE($3, current_page_title),
           updated_at = NOW()
       WHERE id = $1`,
      [id, parsed.data.url || null, parsed.data.title || null]
    );

    const io = (app as any).io;
    io.to(`session:${id}`).emit("session_page_changed", {
      sessionId: id,
      url: parsed.data.url || null,
      title: parsed.data.title || null,
    });
    io.emit("session_updated", { session_id: id });
    return { ok: true };
  });

  // Update status
  app.patch("/api/widget/sessions/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid status" });
    }
    const { status } = parsed.data;

    // Ownership
    const { rows: sess } = await pool.query(
      `SELECT id, visitor_id FROM widget_chat_sessions WHERE id = $1`,
      [id]
    );
    if (!sess[0]) return reply.code(404).send({ error: "Session not found" });
    if (!assertOwner(request, reply, sess[0])) return;

    const extraFields: string[] = [];
    if (status === "waiting_operator") extraFields.push("queued_at = COALESCE(queued_at, NOW())");
    if (status === "closed") extraFields.push("closed_at = NOW()");
    const extraSql = extraFields.length > 0 ? ", " + extraFields.join(", ") : "";

    await pool.query(
      `UPDATE widget_chat_sessions SET status = $1, updated_at = NOW()${extraSql} WHERE id = $2`,
      [status, id]
    );

    const io = (app as any).io;
    io.emit("session_updated", { session_id: id });
    if (status === "waiting_operator") {
      io.emit("queue_updated", { session_id: id, action: "added" });

      // Push + уведомление всем операторам о запросе
      const { rows: sessRows } = await pool.query(
        `SELECT visitor_name, visitor_id FROM widget_chat_sessions WHERE id = $1`, [id]
      );
      const visitorName = sessRows[0]?.visitor_name || "Посетитель";
      io.emit("operator_requested", {
        session_id: id,
        visitor_name: visitorName,
        message: `${visitorName} запросил оператора`,
      });

      sendPushToSession(id, "Запрос оператора", `${visitorName} ожидает оператора`).catch((e: any) =>
        console.error("[push] operator_request error:", e.message)
      );
    }
    return { ok: true };
  });

  // Rating
  app.post("/api/widget/sessions/:id/rate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ratingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid rating" });
    }

    // Ownership
    const { rows: sess } = await pool.query(
      `SELECT id, visitor_id FROM widget_chat_sessions WHERE id = $1`,
      [id]
    );
    if (!sess[0]) return reply.code(404).send({ error: "Session not found" });
    if (!assertOwner(request, reply, sess[0])) return;

    const { rows } = await pool.query(
      `UPDATE widget_chat_sessions
       SET rating = $1, rating_comment = $2, rated_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING id, rating, rating_comment, rated_at`,
      [parsed.data.rating, parsed.data.comment || null, id]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: "Session not found" });
    }

    const io = (app as any).io;
    io.emit("session_updated", { session_id: id });
    return rows[0];
  });

  // ═══ 5.2 Offline leads ═══
  app.post("/api/widget/offline-leads",{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>{
    const schema=z.object({name:z.string().trim().max(200).optional(),email:z.union([z.string().email().max(200),z.literal('')]).optional(),phone:z.string().max(30).optional(),message:z.string().max(5000).optional(),preferred_time:z.string().max(200).optional(),page_url:z.string().max(2000).optional(),visitor_id:z.string().max(100),client_request_id:z.string().uuid().optional()});
    const data=schema.parse(request.body);
    const result=await transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['widget-visitor:'+data.visitor_id]);
      if((await client.query('SELECT 1 FROM widget_blocked_visitors WHERE visitor_id=$1',[data.visitor_id])).rowCount)throw Object.assign(new Error('blocked'),{statusCode:403});
      if(data.client_request_id){
        const existing=await client.query('SELECT * FROM widget_offline_leads WHERE visitor_id=$1 AND client_request_id=$2',[data.visitor_id,data.client_request_id]);
        if(existing.rows[0]){
          for(const key of ['name','email','phone','message','preferred_time'] as const)if((existing.rows[0][key]||'')!==(data[key]||''))throw Object.assign(new Error('Этот запрос уже содержит другие данные'),{statusCode:409});
          const session=await client.query('SELECT * FROM widget_chat_sessions WHERE id=$1',[existing.rows[0].session_id]);
          return {session:session.rows[0],created:false};
        }
      }
      let session=(await client.query("SELECT * FROM widget_chat_sessions WHERE visitor_id=$1 AND status<>'closed' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[data.visitor_id])).rows[0];
      if(!session)session=(await client.query("INSERT INTO widget_chat_sessions(visitor_id,visitor_name,visitor_email,visitor_phone,current_page,status,queued_at,auto_replied) VALUES($1,$2,$3,$4,$5,'waiting_operator',now(),true) RETURNING *",[data.visitor_id,data.name||null,data.email||null,data.phone||null,data.page_url||null])).rows[0];
      else session=(await client.query("UPDATE widget_chat_sessions SET visitor_name=COALESCE($2,visitor_name),visitor_email=COALESCE($3,visitor_email),visitor_phone=COALESCE($4,visitor_phone),contact_revision=contact_revision+1,updated_at=now() WHERE id=$1 RETURNING *",[session.id,data.name||null,data.email||null,data.phone||null])).rows[0];
      await client.query("INSERT INTO site_visitors(visitor_id,current_page,has_chat,chat_session_id) VALUES($1,$2,true,$3) ON CONFLICT(visitor_id) DO UPDATE SET has_chat=true,chat_session_id=EXCLUDED.chat_session_id",[data.visitor_id,data.page_url||null,session.id]);
      const lead=(await client.query('INSERT INTO widget_offline_leads(visitor_id,name,email,phone,message,preferred_time,page_url,client_request_id,session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[data.visitor_id,data.name||null,data.email||null,data.phone||null,data.message||null,data.preferred_time||null,data.page_url||null,data.client_request_id||null,session.id])).rows[0];
      await client.query("INSERT INTO widget_chat_messages(session_id,sender,message,message_type,status,is_read) VALUES($1,$2,$3,'text','sent',false)",[session.id,data.message?'visitor':'system',data.message||'Клиент оставил контакты для обратной связи.']);
      await client.query("UPDATE widget_chat_sessions SET messages_count=COALESCE(messages_count,0)+1,unread_count=COALESCE(unread_count,0)+1,last_message_at=now(),updated_at=now() WHERE id=$1",[session.id]);
      if(!data.message)await client.query("INSERT INTO chat_v8_events(session_id,kind,dedupe_key,payload) VALUES($1,'operator.request',$2,$3)",[session.id,'offline-lead:'+lead.id,JSON.stringify({title:'Новая заявка клиента',body:'Оставлены контакты для связи'})]);
      return {session,created:true};
    });
    if(result.created){(app as any).io.emit('new_offline_lead',{});(app as any).io.emit('session_updated',{session_id:result.session.id});(app as any).io.emit('queue_updated',{});}
    return {ok:true,session:result.session};
  });

  // ═══ 4.2 A/B tracking ═══
  app.post("/api/widget/ab-track", async (request, reply) => {
    const schema = z.object({
      variant: z.enum(["a", "b"]),
      event: z.enum(["opened", "messaged", "rated"]),
      visitor_id: z.string().max(100).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid data" });
    }
    const { variant, event, visitor_id } = parsed.data;
    await pool.query(
      `INSERT INTO widget_ab_results (variant, event, visitor_id, created_at) VALUES ($1, $2, $3, NOW())`,
      [variant, event, visitor_id || null]
    );
    return { ok: true };
  });

  // ═══ 4.2 A/B stats (admin) ═══
  app.get("/api/widget-settings/ab-stats", { preHandler: requireAuth }, async () => {
    const { rows } = await pool.query(
      `SELECT variant, event, COUNT(*)::int as count
       FROM widget_ab_results
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY variant, event
       ORDER BY variant, event`
    );
    return rows;
  });

  // ═══ Offline leads list (admin) ═══
  app.get("/api/widget-settings/offline-leads", { preHandler: requireAuth }, async (request) => {
    const { limit, offset } = request.query as { limit?: string; offset?: string };
    const l = Math.min(100, Math.max(1, parseInt(limit || "50")));
    const o = Math.max(0, parseInt(offset || "0"));
    const { rows } = await pool.query(
      `SELECT * FROM widget_offline_leads ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [l, o]
    );
    return rows;
  });

  // 3.1 Team operators (public — for widget header)
  app.get("/api/widget/team", async () => {
    const { rows } = await pool.query(
      `SELECT id, name, avatar_url
       FROM chat_operators
       WHERE is_online = true AND is_active = true
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT 10`
    );
    return rows;
  });

  // Public widget settings (for widget.js)
  app.get("/api/widget/settings", async () => {
    const { rows } = await pool.query(
      `SELECT key, value FROM chat_settings WHERE key IN ($1, $2, $3, $4)`,
      [SETTINGS_KEYS.WIDGET_CONFIG, SETTINGS_KEYS.PRECHAT_FORM, SETTINGS_KEYS.BUSINESS_HOURS, SETTINGS_KEYS.ALLOWED_DOMAINS]
    );

    const result: Record<string, any> = {
      widget_config: { ...DEFAULT_WIDGET_CONFIG },
      prechat_form: { ...DEFAULT_PRECHAT },
      business_hours: { ...DEFAULT_BUSINESS_HOURS },
      allowed_domains: { ...DEFAULT_DOMAINS },
    };

    for (const row of rows) {
      try {
        const parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        if (row.key === SETTINGS_KEYS.WIDGET_CONFIG) {
          const merged = { ...DEFAULT_WIDGET_CONFIG, ...parsed };
          // 4.2 A/B test: randomize greeting
          if (merged.ab_test_enabled && merged.ab_variants) {
            const roll = Math.random() * 100;
            const variant = roll < (merged.ab_variants.a?.weight || 50) ? "a" : "b";
            merged.greeting = merged.ab_variants[variant]?.greeting || merged.greeting;
            merged._ab_variant = variant;
          }
          result[row.key] = merged;
        } else {
          result[row.key] = parsed;
        }
      } catch {
        result[row.key] = row.value;
      }
    }
    return result;
  });

  // ────────────────────────────────────────────
  // ADMIN WIDGET SETTINGS (with auth preHandler)
  // ────────────────────────────────────────────

  // GET widget config
  app.get("/api/widget-settings/config", { preHandler: requireAuth }, async () => {
    const { rows } = await pool.query(
      `SELECT value FROM chat_settings WHERE key = $1`, [SETTINGS_KEYS.WIDGET_CONFIG]
    );
    if (rows.length === 0) return DEFAULT_WIDGET_CONFIG;
    const saved = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
    return { ...DEFAULT_WIDGET_CONFIG, ...saved };
  });

  // PUT widget config
  app.put("/api/widget-settings/config", { preHandler: requireAuth }, async (request) => {
    const { config, dropped } = sanitizeWidgetConfig(request.body);
    if (dropped.length) console.warn("[widget-config] dropped invalid fields:", dropped.join(","));
    await pool.query(
      `INSERT INTO chat_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SETTINGS_KEYS.WIDGET_CONFIG, JSON.stringify(config)]
    );
    forgetWidgetConfig();
    return { ok: true, config: { ...DEFAULT_WIDGET_CONFIG, ...config }, dropped };
  });

  // GET prechat
  app.get("/api/widget-settings/prechat", { preHandler: requireAuth }, async () => {
    const { rows } = await pool.query(
      `SELECT value FROM chat_settings WHERE key = $1`, [SETTINGS_KEYS.PRECHAT_FORM]
    );
    if (rows.length === 0) return DEFAULT_PRECHAT;
    return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
  });

  // PUT prechat
  app.put("/api/widget-settings/prechat", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = prechatFormSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid prechat config", details: parsed.error.issues });
    }
    await pool.query(
      `INSERT INTO chat_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SETTINGS_KEYS.PRECHAT_FORM, JSON.stringify(parsed.data)]
    );
    return { ok: true, prechat: parsed.data };
  });

  // GET business hours
  app.get("/api/widget-settings/business-hours", { preHandler: requireAuth }, async () => {
    const { rows } = await pool.query(
      `SELECT value FROM chat_settings WHERE key = $1`, [SETTINGS_KEYS.BUSINESS_HOURS]
    );
    if (rows.length === 0) return DEFAULT_BUSINESS_HOURS;
    return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
  });

  // PUT business hours
  app.put("/api/widget-settings/business-hours", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = businessHoursSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid business hours", details: parsed.error.issues });
    }
    await pool.query(
      `INSERT INTO chat_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SETTINGS_KEYS.BUSINESS_HOURS, JSON.stringify(parsed.data)]
    );
    return { ok: true, hours: parsed.data };
  });

  // GET domains
  app.get("/api/widget-settings/domains", { preHandler: requireAuth }, async () => {
    const { rows } = await pool.query(
      `SELECT value FROM chat_settings WHERE key = $1`, [SETTINGS_KEYS.ALLOWED_DOMAINS]
    );
    if (rows.length === 0) return DEFAULT_DOMAINS;
    return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
  });

  // PUT domains
  app.put("/api/widget-settings/domains", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = domainSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid domain settings", details: parsed.error.issues });
    }
    await pool.query(
      `INSERT INTO chat_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SETTINGS_KEYS.ALLOWED_DOMAINS, JSON.stringify(parsed.data)]
    );
    return { ok: true, domains: parsed.data };
  });

  // Upload avatar (async file write)
  app.post("/api/widget-settings/avatar", { preHandler: requireAuth }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file" });

    const { writeFile, mkdir } = await import("fs/promises");
    const { existsSync } = await import("fs");
    const path = await import("path");

    const uploadDir = "/var/www/widget/uploads";
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const ext = path.extname(data.filename) || ".png";
    const filename = `widget-avatar-${Date.now()}${ext}`;
    const filepath = path.join(uploadDir, filename);

    const buffer = await data.toBuffer();
    await writeFile(filepath, buffer);

    const avatarUrl = `/widget-uploads/${filename}`;

    const { rows } = await pool.query(
      `SELECT value FROM chat_settings WHERE key = $1`, [SETTINGS_KEYS.WIDGET_CONFIG]
    );

    let config = rows.length > 0 ? rows[0].value : {};
    if (typeof config === "string") config = JSON.parse(config);
    config.avatar_url = avatarUrl;

    await pool.query(
      `INSERT INTO chat_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SETTINGS_KEYS.WIDGET_CONFIG, JSON.stringify(config)]
    );

    return { ok: true, avatar_url: avatarUrl };
  });
}
