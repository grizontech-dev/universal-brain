CREATE TABLE IF NOT EXISTS token_blacklist (
  jti          TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  reason       TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blacklist_expires_at ON token_blacklist(expires_at);

