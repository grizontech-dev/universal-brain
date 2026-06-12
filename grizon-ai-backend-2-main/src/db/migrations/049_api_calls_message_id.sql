-- Link api_calls rows back to the assistant message they were generated for.
ALTER TABLE api_calls
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_api_calls_message_id ON api_calls (message_id);
