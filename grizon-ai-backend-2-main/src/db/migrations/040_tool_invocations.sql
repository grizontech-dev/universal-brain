CREATE TABLE IF NOT EXISTS tool_invocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        TEXT NOT NULL,
  call_id         TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  agent_slug      TEXT,
  model_id        TEXT,
  tool_name       TEXT NOT NULL,
  request_args    JSONB NOT NULL,
  response_output JSONB,
  status          TEXT NOT NULL CHECK (status IN ('success','error','timeout')),
  error_message   TEXT,
  duration_ms     INT NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_invocations_user         ON tool_invocations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_invocations_tool         ON tool_invocations(tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_invocations_trace        ON tool_invocations(trace_id);
CREATE INDEX IF NOT EXISTS idx_tool_invocations_conversation ON tool_invocations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_invocations_status_time  ON tool_invocations(status, created_at DESC);
