import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export function registerAutoResponseRoutes(app: FastifyInstance) {

  // Получить все правила
  app.get("/api/auto-responses", {
    preHandler: [(app as any).authenticate],
  }, async () => {
    const { rows } = await pool.query(
      `SELECT * FROM auto_response_rules ORDER BY created_at ASC`
    );
    return rows;
  });

  // Создать правило
  app.post("/api/auto-responses", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { trigger_type, delay_seconds, message, is_active } = request.body as {
      trigger_type: string;
      delay_seconds: number;
      message: string;
      is_active?: boolean;
    };

    const { rows } = await pool.query(
      `INSERT INTO auto_response_rules (trigger_type, delay_seconds, message, is_active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [trigger_type, delay_seconds, message, is_active !== false]
    );
    return rows[0];
  });

  // Обновить правило
  app.patch("/api/auto-responses/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { trigger_type, delay_seconds, message, is_active } = request.body as {
      trigger_type?: string;
      delay_seconds?: number;
      message?: string;
      is_active?: boolean;
    };

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (trigger_type !== undefined) { updates.push(`trigger_type = $${idx}`); values.push(trigger_type); idx++; }
    if (delay_seconds !== undefined) { updates.push(`delay_seconds = $${idx}`); values.push(delay_seconds); idx++; }
    if (message !== undefined) { updates.push(`message = $${idx}`); values.push(message); idx++; }
    if (is_active !== undefined) { updates.push(`is_active = $${idx}`); values.push(is_active); idx++; }

    if (updates.length === 0) return { ok: true };

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE auto_response_rules SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] || { ok: true };
  });

  // Удалить правило
  app.delete("/api/auto-responses/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    await pool.query(`DELETE FROM auto_response_rules WHERE id = $1`, [id]);
    return { ok: true };
  });
}
