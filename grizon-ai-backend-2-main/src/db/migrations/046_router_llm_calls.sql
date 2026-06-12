-- Router LLM calls analytics: captures prompt + response for classifier, rewriter, search_planner
CREATE TABLE IF NOT EXISTS router_llm_calls (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  component       TEXT        NOT NULL CHECK (component IN ('classifier', 'rewriter', 'search_planner')),
  source          TEXT        NOT NULL,   -- 'heuristic' | 'llm' | 'cache' | 'skipped' | 'error' | 'timeout'
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID,
  job_id          TEXT,
  message_id      TEXT,
  model           TEXT        NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_system   TEXT,
  prompt_user     TEXT,
  response_text   TEXT,
  response_json   JSONB,
  latency_ms      INTEGER,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  status          TEXT        NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'skipped', 'error', 'timeout')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_router_llm_calls_component_created  ON router_llm_calls (component, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_router_llm_calls_user_created        ON router_llm_calls (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_router_llm_calls_source_created      ON router_llm_calls (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_router_llm_calls_created             ON router_llm_calls (created_at DESC);
