CREATE TABLE IF NOT EXISTS memory_facts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact              TEXT NOT NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 0.80,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by     UUID REFERENCES memory_facts(id),
  UNIQUE (user_id, fact)
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_user_id ON memory_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_facts_created_at ON memory_facts(created_at);
