CREATE TABLE IF NOT EXISTS subagent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_job_id UUID NOT NULL,
  task          TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  credits_used  NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_ms   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subagent_runs_parent_job_id ON subagent_runs(parent_job_id);
