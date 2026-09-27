CREATE TABLE IF NOT EXISTS chat_v8_files (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES widget_chat_sessions(id),
  operator_id uuid REFERENCES chat_operators(id),
  storage_name text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_v8_files_session ON chat_v8_files(session_id);
