CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  provider_user_id      TEXT NOT NULL,
  provider_email        TEXT NOT NULL,
  email_verified        BOOLEAN NOT NULL,
  raw_profile           JSONB NOT NULL DEFAULT '{}',
  linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_subject ON oauth_accounts(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

