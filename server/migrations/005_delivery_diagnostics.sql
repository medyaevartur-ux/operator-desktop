-- Additive: honest per-device delivery diagnostics. Only chat-owned tables; never reset the shared database.
ALTER TABLE chat_v8_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE chat_v8_deliveries ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE chat_v8_deliveries ADD COLUMN IF NOT EXISTS ack_outcome text;
CREATE INDEX IF NOT EXISTS chat_v8_deliveries_device_recent ON chat_v8_deliveries(device_id, created_at DESC);

-- What the device itself reports: OS permission, channel state, battery optimisation, focus/DND mode.
ALTER TABLE chat_v8_devices ADD COLUMN IF NOT EXISTS diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE chat_v8_devices ADD COLUMN IF NOT EXISTS diagnostics_at timestamptz;
