CREATE TABLE chat_jobs (
  id                TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL,
  client_message_id UUID NOT NULL,
  wallet_hold_id    UUID NOT NULL REFERENCES wallet_transactions(id),
  status            TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'streaming', 'completed', 'failed', 'cancelled')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  result_message_id UUID NULL,
  artifact_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code        TEXT NULL,
  error_message     TEXT NULL,
  agent_slug        TEXT NULL,
  model_id          TEXT NULL,
  started_at        TIMESTAMPTZ NULL,
  completed_at      TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, conversation_id, client_message_id)
);

CREATE INDEX idx_chat_jobs_user_created ON chat_jobs(user_id, created_at DESC);
CREATE INDEX idx_chat_jobs_conversation_created ON chat_jobs(conversation_id, created_at DESC);
