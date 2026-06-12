-- Add message + job + agent context to subagent_runs so they are queryable per turn.
ALTER TABLE subagent_runs
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_id     TEXT,
  ADD COLUMN IF NOT EXISTS agent_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_subagent_runs_message_id ON subagent_runs (message_id);
CREATE INDEX IF NOT EXISTS idx_subagent_runs_job_id     ON subagent_runs (job_id);
