import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { startWidgetScenario, handleWidgetBotEvent } from "../services/widget-bot/runtime.js";

// Ownership-проверка по заголовку X-Visitor-Id (тот же контракт, что в widget.ts).
// Грузит сессию, сверяет visitor_id; при несовпадении/отсутствии заголовка → 403.
// Возвращает true если доступ разрешён, иначе уже отправил 403/404 и вернул false.
async function checkSessionOwner(request: any, reply: any, sessionId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT id, visitor_id FROM widget_chat_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!rows[0]) {
    reply.code(404).send({ error: "Session not found" });
    return false;
  }
  // Сессии без visitor_id (служебные) — не блокируем.
  if (!rows[0].visitor_id) { reply.code(403).send({ error: "forbidden" }); return false; }
  const vid = request.headers["x-visitor-id"];
  if (!vid || vid !== rows[0].visitor_id) {
    request.log?.warn?.({ sessionId }, "[widget-bot] ownership check failed (403)");
    reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}

// Публичные роуты виджет-бота (без auth) — дёргает виджет на сайте.
export function registerWidgetBotRoutes(app: FastifyInstance) {
  // Запустить активный widget-сценарий для сессии (точка входа «Ознакомиться с продукцией»)
  app.post("/api/widget/sessions/:id/bot-start", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await checkSessionOwner(request, reply, id))) return;
    try {
      return await startWidgetScenario((app as any).io, id);
    } catch (e: any) {
      console.error("[widget-bot] start error:", e.message);
      return reply.code(500).send({ error: "bot_failed" });
    }
  });

  // Клик по кнопке/карточке или ответ → продвинуть сценарий
  app.post("/api/widget/sessions/:id/bot-event", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await checkSessionOwner(request, reply, id))) return;
    try {
      return await handleWidgetBotEvent((app as any).io, id, request.body || {});
    } catch (e: any) {
      console.error("[widget-bot] event error:", e.message);
      return reply.code(500).send({ error: "bot_failed" });
    }
  });
}
