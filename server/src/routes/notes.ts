import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { z } from 'zod';
import { assertActor, operatorOf, isSupervisor, uuid } from '../core/security.js';

export function registerNoteRoutes(app: FastifyInstance) {
  app.get("/api/sessions/:id/notes", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const { rows } = await pool.query(
      `SELECT * FROM client_notes WHERE session_id = $1 ORDER BY updated_at DESC`,
      [id]
    );

    return rows;
  });

  app.post("/api/sessions/:id/notes", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { operator_id: supplied, note } = z.object({ operator_id: uuid.optional(), note: z.string().trim().min(1).max(10000) }).parse(request.body);
    const operator_id = assertActor(request, supplied);

    const { rows } = await pool.query(
      `INSERT INTO client_notes (session_id, operator_id, note)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, operator_id, note]
    );

    return rows[0];
  });

  app.patch("/api/notes/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { note } = z.object({ note: z.string().trim().min(1).max(10000) }).parse(request.body);
    const existing = await pool.query('SELECT operator_id FROM client_notes WHERE id=$1', [id]);
    if (!existing.rows[0] || (existing.rows[0].operator_id !== operatorOf(request).id && !isSupervisor(request))) throw Object.assign(new Error('Нет доступа к заметке'), { statusCode: 403 });

    await pool.query(
      `UPDATE client_notes SET note = $1, updated_at = NOW() WHERE id = $2`,
      [note, id]
    );

    return { ok: true };
  });

  app.delete("/api/notes/:id", {
    preHandler: [(app as any).authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const existing = await pool.query('SELECT operator_id FROM client_notes WHERE id=$1', [id]);
    if (!existing.rows[0] || (existing.rows[0].operator_id !== operatorOf(request).id && !isSupervisor(request))) throw Object.assign(new Error('Нет доступа к заметке'), { statusCode: 403 });
    await pool.query(`DELETE FROM client_notes WHERE id = $1`, [id]);
    return { ok: true };
  });
}
