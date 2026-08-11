-- Repair production messages schema to match the current application model.
-- Safe for existing data.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attached_file_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS input_tokens INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_slug TEXT,
  ADD COLUMN IF NOT EXISTS model_id TEXT,
  ADD COLUMN IF NOT EXISTS model_provider TEXT,
  ADD COLUMN IF NOT EXISTS web_search_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS code_execution_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS file_analysis_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_mode_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS latency_ms INT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS is_included_in_summary BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_convo_created
  ON messages(conversation_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_messages_job
  ON messages(job_id)
  WHERE job_id IS NOT NULL;
