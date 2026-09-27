-- Metadata revision is independent from message activity, so editing a contact
-- does not conflict with a new incoming message.
ALTER TABLE widget_chat_sessions ADD COLUMN IF NOT EXISTS contact_revision integer NOT NULL DEFAULT 1;
ALTER TABLE widget_offline_leads ADD COLUMN IF NOT EXISTS client_request_id uuid;
ALTER TABLE widget_offline_leads ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES widget_chat_sessions(id);
CREATE UNIQUE INDEX IF NOT EXISTS widget_offline_leads_request ON widget_offline_leads(visitor_id,client_request_id) WHERE client_request_id IS NOT NULL;
