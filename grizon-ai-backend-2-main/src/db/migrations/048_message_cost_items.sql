-- One row per cost-incurring event within a single chat turn.
-- Covers: router LLM calls, each stream round, tool executions, subagent runs.
-- Lean cost ledger — no prompt/response blobs (those stay in router_llm_calls / tool_invocations).
CREATE TABLE IF NOT EXISTS message_cost_items (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent linkage
  message_id           UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  job_id               TEXT        NOT NULL,
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id      UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  agent_slug           TEXT,

  -- What kind of event this row represents
  item_type            TEXT        NOT NULL CHECK (item_type IN (
                         'router_classify',
                         'router_rewrite',
                         'router_search_plan',
                         'stream_round',
                         'tool_web_search',
                         'tool_web_fetch',
                         'tool_code_exec',
                         'tool_image_analyse',
                         'tool_other',
                         'subagent',
                         'semantic_cache'
                       )),

  -- Specific component name (tool name, subagent task, etc.)
  component            TEXT,

  -- Model used (null for non-LLM items like web_search, code_exec)
  model_id             TEXT,
  model_provider       TEXT,

  -- For multi-round main LLM streams (1-indexed)
  round_number         SMALLINT,

  -- Tokens (exact from API for LLM calls; 0 for API-only tools)
  input_tokens         INT         NOT NULL DEFAULT 0,
  output_tokens        INT         NOT NULL DEFAULT 0,
  input_tokens_fresh   INT,
  input_tokens_cached  INT,
  cache_write_tokens   INT,

  -- Cost (informational for router/tool; actual for stream_round/subagent)
  cost_usd             NUMERIC(12,8),
  credits_used         INT         NOT NULL DEFAULT 0,

  -- Cross-reference to the detailed debug record
  ref_table            TEXT,
  ref_id               UUID,

  -- Performance
  latency_ms           INT,

  -- Status
  status               TEXT        NOT NULL DEFAULT 'success'
                         CHECK (status IN ('success', 'error', 'timeout', 'skipped', 'cache_hit')),

  -- Per-type context (see service docs for shape per item_type)
  metadata             JSONB       NOT NULL DEFAULT '{}',

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mci_message    ON message_cost_items (message_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_mci_user       ON message_cost_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mci_job        ON message_cost_items (job_id);
CREATE INDEX IF NOT EXISTS idx_mci_item_type  ON message_cost_items (item_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mci_agent_slug ON message_cost_items (agent_slug, created_at DESC);
