import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export function registerTagRoutes(app: FastifyInstance) {
  app.get("/api/tags", {
    preHandler: [(app as any).authenticate],
  }, async () => {
    const { rows } = await pool.query(
      `SELECT id, name, color, created_at FROM chat_tags ORDER BY name ASC`
    );
    return rows;
  });

  app.post("/api/tags", {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { name, color } = request.body as { name: string; color: string };

    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }

    // Upsert — если тег уже есть, вернуть его
    const { rows } = await pool.query(
      `INSERT INTO chat_tags (name, color)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color
       RETURNING *`,
      [name.trim(), color || "#7C5CBF"]
    );

    return rows[0];
  });

  app.get("/api/sessions/:id/tags", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const { rows } = await pool.query(
      `SELECT st.id, st.session_id, st.tag_id, st.created_at,
              json_build_object('id', t.id, 'name', t.name, 'color', t.color, 'created_at', t.created_at) as tag
       FROM chat_session_tags st
       JOIN chat_tags t ON t.id = st.tag_id
       WHERE st.session_id = $1`,
      [id]
    );

    return rows;
  });

  app.post("/api/sessions/:id/tags", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { tag_id } = request.body as { tag_id: string };

    const { rows } = await pool.query(
      `INSERT INTO chat_session_tags (session_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [id, tag_id]
    );

    return rows[0] ?? { ok: true };
  });

  app.delete("/api/sessions/:sessionId/tags/:tagId", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { sessionId, tagId } = request.params as { sessionId: string; tagId: string };

    await pool.query(
      `DELETE FROM chat_session_tags WHERE session_id = $1 AND tag_id = $2`,
      [sessionId, tagId]
    );

    return { ok: true };
  });
}
