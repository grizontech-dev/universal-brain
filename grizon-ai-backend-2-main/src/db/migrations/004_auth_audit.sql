CREATE TABLE IF NOT EXISTS auth_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  actor_id      UUID REFERENCES users(id),
  event_type    TEXT NOT NULL,
  ip            INET,
  user_agent    TEXT,
  fingerprint   TEXT,
  success       BOOLEAN NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_created ON auth_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event        ON auth_audit(event_type, created_at DESC);

