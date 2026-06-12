CREATE TABLE IF NOT EXISTS api_calls (
  request_id              UUID PRIMARY KEY,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL,
  model                   TEXT NOT NULL,
  agent_slug              TEXT NOT NULL,
  input_fresh             INT NOT NULL DEFAULT 0,
  input_cached            INT NOT NULL DEFAULT 0,
  output                  INT NOT NULL DEFAULT 0,
  cache_write             INT NOT NULL DEFAULT 0,
  cost_usd_billed_to_us   NUMERIC(12,6),
  credits_charged_to_user NUMERIC(12,2),
  cache_layer             TEXT CHECK (cache_layer IN ('semantic', 'prompt', 'none')),
  tool_count              INT NOT NULL DEFAULT 0,
  latency_ms              INT NOT NULL DEFAULT 0,
  metadata                JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_calls_user_id ON api_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_created_at ON api_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_api_calls_agent_slug ON api_calls(agent_slug);
CREATE INDEX IF NOT EXISTS idx_api_calls_model ON api_calls(model);

ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS input_cost_per_1k NUMERIC(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_cost_per_1k NUMERIC(12,6) NOT NULL DEFAULT 0;
