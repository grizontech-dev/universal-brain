CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  version_number INT NOT NULL DEFAULT 1,
  content_hash TEXT,
  storage_path TEXT,
  content_text TEXT,
  created_by_agent TEXT NOT NULL,
  is_latest BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artifacts_user_convo ON artifacts(user_id, conversation_id, created_at DESC);
CREATE INDEX idx_artifacts_chain ON artifacts(parent_id, version_number);
CREATE UNIQUE INDEX uq_artifacts_latest ON artifacts(parent_id) WHERE is_latest = true AND parent_id IS NOT NULL;
