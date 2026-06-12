CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL DEFAULT '',
  attached_file_ids UUID[] NOT NULL DEFAULT '{}',
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  credits_deducted INT NOT NULL DEFAULT 0,
  agent_slug TEXT,
  model_id TEXT,
  model_provider TEXT,
  web_search_used BOOLEAN NOT NULL DEFAULT false,
  code_execution_used BOOLEAN NOT NULL DEFAULT false,
  file_analysis_used BOOLEAN NOT NULL DEFAULT false,
  voice_mode_used BOOLEAN NOT NULL DEFAULT false,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  latency_ms INT,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending', 'streaming', 'complete', 'error')),
  job_id TEXT,
  error_message TEXT,
  is_included_in_summary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_summarised_msg
  FOREIGN KEY (summarised_up_to_msg_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX idx_messages_convo_created ON messages(conversation_id, created_at ASC, id ASC);
CREATE INDEX idx_messages_job ON messages(job_id) WHERE job_id IS NOT NULL;
