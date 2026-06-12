CREATE TABLE usage_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id    TEXT,
  message_id         TEXT,
  request_id         TEXT,
  model_id           TEXT NOT NULL,
  agent_slug         TEXT NOT NULL,
  provider           TEXT NOT NULL,
  platform           TEXT NOT NULL,
  status             TEXT NOT NULL,
  error_code         TEXT,
  latency_ms         INTEGER NOT NULL DEFAULT 0,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  total_tokens       INTEGER NOT NULL DEFAULT 0,
  credits_deducted   INTEGER NOT NULL DEFAULT 0,
  estimated_credits  INTEGER,
  wallet_balance_before INTEGER,
  wallet_balance_after  INTEGER,
  actual_cost_usd    NUMERIC(12,6),
  finish_reason      TEXT,
  semantic_cache_hit BOOLEAN NOT NULL DEFAULT false,
  had_files          BOOLEAN NOT NULL DEFAULT false,
  had_voice          BOOLEAN NOT NULL DEFAULT false,
  ip_hash            TEXT,
  user_agent         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_records_user_created ON usage_records(user_id, created_at DESC);
CREATE INDEX idx_usage_records_model_created ON usage_records(model_id, created_at DESC);
CREATE INDEX idx_usage_records_created ON usage_records(created_at DESC);
