/** Одна явная настройка автоматических приглашений. По умолчанию выключена. */
export const AUTO_INVITE_DEFAULTS = {
  auto_invite_enabled: false,
  auto_invite_delay: 60,
  auto_invite_message: "Здравствуйте! Если появятся вопросы — напишите, мы на связи.",
  auto_invite_cooldown_hours: 24,
};
export const AUTO_INVITE_KEYS = Object.keys(AUTO_INVITE_DEFAULTS);

export interface AutoInvitePolicy { enabled: boolean; delayMs: number; message: string; cooldownMs: number }

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function readAutoInvitePolicy(config: Record<string, unknown> | null | undefined): AutoInvitePolicy {
  const source = config ?? {};
  const message = typeof source.auto_invite_message === "string" && source.auto_invite_message.trim()
    ? source.auto_invite_message.trim().slice(0, 500)
    : AUTO_INVITE_DEFAULTS.auto_invite_message;
  return {
    enabled: source.auto_invite_enabled === true,
    delayMs: clamp(source.auto_invite_delay, 15, 3600, AUTO_INVITE_DEFAULTS.auto_invite_delay) * 1000,
    message,
    cooldownMs: clamp(source.auto_invite_cooldown_hours, 1, 720, AUTO_INVITE_DEFAULTS.auto_invite_cooldown_hours) * 3_600_000,
  };
}

export type AutoInviteDecision = "invite" | "disabled" | "has_chat" | "blocked" | "too_early" | "no_operators" | "recent_invitation";

/**
 * Приглашаем только когда владелец включил автоматику, посетитель ещё не пишет, провёл на сайте
 * заданное время, кто-то из команды может ответить, и за время паузы ему ничего не предлагали
 * (любое прошлое приглашение, в том числе отклонённое, откладывает следующее).
 */
export function decideAutoInvite(input: {
  policy: AutoInvitePolicy; hasChat: boolean; blocked: boolean; onSiteMs: number;
  operatorsOnline: number; lastInvitationAt: number | null; now: number;
}): AutoInviteDecision {
  if (!input.policy.enabled) return "disabled";
  if (input.hasChat) return "has_chat";
  if (input.blocked) return "blocked";
  if (input.onSiteMs < input.policy.delayMs) return "too_early";
  if (input.operatorsOnline < 1) return "no_operators";
  if (input.lastInvitationAt !== null && input.now - input.lastInvitationAt < input.policy.cooldownMs) return "recent_invitation";
  return "invite";
}

/** Настройки виджета для фоновых решений; кэш короткий, сохранение в панели его сбрасывает. */
let cached: { at: number; config: Record<string, unknown> } | null = null;
const CONFIG_TTL_MS = 15_000;

export async function currentWidgetConfig(): Promise<Record<string, unknown>> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.config;
  const { pool } = await import("../db.js"); // ленивый импорт: чистые функции выше тестируются без базы
  const { rows } = await pool.query("SELECT value FROM chat_settings WHERE key='widget_config'");
  let saved: unknown = rows[0]?.value ?? {};
  if (typeof saved === "string") { try { saved = JSON.parse(saved); } catch { saved = {}; } }
  cached = { at: Date.now(), config: { ...AUTO_INVITE_DEFAULTS, ...(saved && typeof saved === "object" ? saved as Record<string, unknown> : {}) } };
  return cached.config;
}

export function forgetWidgetConfig() { cached = null; }
