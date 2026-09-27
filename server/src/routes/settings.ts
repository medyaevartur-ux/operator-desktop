import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { forgetWidgetConfig } from "../services/auto-invite.js";

export function registerSettingsRoutes(app: FastifyInstance) {

  app.get("/api/settings/:key", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const allowed = ["prechat_form", "widget_config"];
    if (!allowed.includes(key)) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    const { rows } = await pool.query(
      `SELECT value FROM chat_settings WHERE key = $1`,
      [key]
    );

    if (!rows.length) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    return rows[0].value;
  });

  app.put("/api/settings/:key", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const allowed = ["prechat_form", "widget_config"];
    if (!allowed.includes(key)) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    const body = request.body;

    await pool.query(
      `INSERT INTO chat_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [key, JSON.stringify(body)]
    );
    forgetWidgetConfig();

    return body;
  });

  app.patch("/api/settings/:key", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const allowed = ["prechat_form", "widget_config"];
    if (!allowed.includes(key)) {
      reply.code(404).send({ error: "Not found" });
      return;
    }

    const body = request.body as Record<string, unknown>;

    const { rows } = await pool.query(
      `SELECT value FROM chat_settings WHERE key = $1`,
      [key]
    );

    const existing = rows.length ? rows[0].value : {};
    const merged = { ...existing, ...body };

    await pool.query(
      `INSERT INTO chat_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [key, JSON.stringify(merged)]
    );
    forgetWidgetConfig();

    return merged;
  });
}
