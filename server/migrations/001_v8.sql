-- Additive migration: only chat-owned tables. Never reset the shared database.
ALTER TABLE widget_chat_messages ADD COLUMN IF NOT EXISTS client_message_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS chat_v8_message_client_id
  ON widget_chat_messages(session_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_v8_message_history ON widget_chat_messages(session_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_v8_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL UNIQUE,
  operator_id uuid NOT NULL REFERENCES chat_operators(id),
  platform text NOT NULL CHECK (platform IN ('windows','android','web')),
  provider text NOT NULL CHECK (provider IN ('socket','fcm','webpush')),
  token text,
  subscription jsonb,
  app_version text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_v8_devices_operator ON chat_v8_devices(operator_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS chat_v8_auth_sessions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES chat_operators(id),
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  installation_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  replaced_by uuid REFERENCES chat_v8_auth_sessions(id),
  rotated_at timestamptz,
  rotation_envelope text,
  client_name text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS chat_v8_auth_operator ON chat_v8_auth_sessions(operator_id, family_id);

CREATE TABLE IF NOT EXISTS chat_v8_notification_preferences (
  operator_id uuid PRIMARY KEY REFERENCES chat_operators(id),
  enabled boolean NOT NULL DEFAULT true,
  new_messages boolean NOT NULL DEFAULT true,
  escalation boolean NOT NULL DEFAULT true,
  show_preview boolean NOT NULL DEFAULT true,
  dnd_start text,
  dnd_end text,
  timezone text NOT NULL DEFAULT 'Asia/Yekaterinburg',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_v8_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES widget_chat_messages(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES widget_chat_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  dedupe_key text UNIQUE,
  socket_published_at timestamptz,
  notifications_enqueued_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_v8_events_pending ON chat_v8_events(created_at)
  WHERE socket_published_at IS NULL OR notifications_enqueued_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_v8_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES chat_v8_events(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES chat_v8_devices(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES chat_operators(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','acked','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  provider_message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, device_id)
);
CREATE INDEX IF NOT EXISTS chat_v8_deliveries_pending ON chat_v8_deliveries(next_attempt_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS chat_v8_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  shortcut text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'Общие',
  uses integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES chat_operators(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shortcut)
);

CREATE TABLE IF NOT EXISTS chat_v8_routing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  automatic boolean NOT NULL DEFAULT false,
  escalation_minutes integer NOT NULL DEFAULT 3 CHECK (escalation_minutes BETWEEN 1 AND 60),
  idle_minutes integer NOT NULL DEFAULT 5 CHECK (idle_minutes BETWEEN 1 AND 120),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO chat_v8_routing_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION chat_v8_capture_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind text;
BEGIN
  IF TG_OP='INSERT' THEN event_kind := 'message.created';
  ELSIF (NEW.message,NEW.is_deleted,NEW.is_edited,NEW.attachments) IS DISTINCT FROM (OLD.message,OLD.is_deleted,OLD.is_edited,OLD.attachments) THEN event_kind := 'message.updated';
  ELSIF (NEW.status,NEW.is_read,NEW.delivered_at,NEW.read_at) IS DISTINCT FROM (OLD.status,OLD.is_read,OLD.delivered_at,OLD.read_at) THEN event_kind := 'message.status';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO chat_v8_events(message_id, session_id, kind, dedupe_key)
    VALUES (NEW.id, NEW.session_id, event_kind, CASE WHEN TG_OP='INSERT' THEN 'message.created:'||NEW.id ELSE NULL END)
    ON CONFLICT(dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_v8_message_event ON widget_chat_messages;
CREATE TRIGGER chat_v8_message_event AFTER INSERT OR UPDATE ON widget_chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_v8_capture_message();

CREATE OR REPLACE FUNCTION chat_v8_capture_reaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message_uuid uuid; session_uuid uuid;
BEGIN
  message_uuid := CASE WHEN TG_OP='DELETE' THEN OLD.message_id ELSE NEW.message_id END;
  SELECT session_id INTO session_uuid FROM widget_chat_messages WHERE id=message_uuid;
  IF session_uuid IS NOT NULL THEN
    INSERT INTO chat_v8_events(message_id,session_id,kind) VALUES(message_uuid,session_uuid,'reaction.updated');
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS chat_v8_reaction_event ON message_reactions;
CREATE TRIGGER chat_v8_reaction_event AFTER INSERT OR DELETE ON message_reactions
  FOR EACH ROW EXECUTE FUNCTION chat_v8_capture_reaction();
