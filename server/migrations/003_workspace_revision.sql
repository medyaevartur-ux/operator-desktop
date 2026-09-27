ALTER TABLE chat_v8_templates ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS chat_v8_active_operator_sessions ON widget_chat_sessions(operator_id) WHERE status<>'closed';
