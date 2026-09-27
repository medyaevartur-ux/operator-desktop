import { pool } from "./db.js";

let ioRef: any = null;

export function setIoRef(io: any) {
  ioRef = io;
}

export function startAutoResponseCron() {
  console.log("[auto-response-cron] started, interval 30s");

  const timer = setInterval(async () => {
    try {
      // Пока есть хоть один онлайн-оператор — авто-ответы очереди не шлём,
      // оператор сам ответит (бот не вклинивается, пока человек работает).
      const { rows: onlineOps } = await pool.query(
        `SELECT 1 FROM chat_operators WHERE is_active = true AND is_online = true AND status = 'online' LIMIT 1`
      );
      if (onlineOps.length > 0) return;

      // Получить активные правила
      const { rows: rules } = await pool.query(
        `SELECT * FROM auto_response_rules WHERE is_active = true`
      );

      for (const rule of rules) {
        if (rule.trigger_type === "queue_timeout") {
          // Найти сессии в очереди, которые ждут дольше delay_seconds и ещё не получили auto_reply
          const { rows: sessions } = await pool.query(
            `SELECT id FROM widget_chat_sessions
             WHERE queued_at IS NOT NULL
               AND auto_replied = false
               AND operator_id IS NULL
               AND status IN ('waiting_operator')
               AND queued_at < NOW() - INTERVAL '1 second' * $1`,
            [rule.delay_seconds]
          );

          for (const session of sessions) {
            // Вставить system-сообщение
            const { rows: msgRows } = await pool.query(
              `INSERT INTO widget_chat_messages (session_id, sender, message, message_type)
               VALUES ($1, 'system', $2, 'auto_response') RETURNING *`,
              [session.id, rule.message]
            );

            // Пометить auto_replied
            await pool.query(
              `UPDATE widget_chat_sessions SET auto_replied = true, updated_at = NOW() WHERE id = $1`,
              [session.id]
            );

            // WebSocket
            if (ioRef && msgRows[0]) {
              ioRef.to(`session:${session.id}`).emit("new_message", msgRows[0]);
              ioRef.emit("session_updated", { session_id: session.id });
            }

            console.log(`[auto-response] sent to session ${session.id}: "${rule.message.substring(0, 40)}..."`);
          }
        }
      }
    } catch (err) {
      console.error("[auto-response-cron] error:", err);
    }
  }, 30_000);
  return () => clearInterval(timer);
}
