CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  title_generated_at TIMESTAMPTZ,
  default_agent_slug TEXT,
  default_model_id TEXT,
  total_tokens_used INT NOT NULL DEFAULT 0,
  message_count INT NOT NULL DEFAULT 0,
  summarised_up_to_msg_id UUID,
  summary_text TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  pinned_at TIMESTAMPTZ,
  tags TEXT[] NOT NULL DEFAULT '{}',
  platform TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_user_active
  ON conversations(user_id, last_message_at DESC, id DESC)
  WHERE status = 'active';

CREATE INDEX idx_conversations_user_pinned
  ON conversations(user_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;
