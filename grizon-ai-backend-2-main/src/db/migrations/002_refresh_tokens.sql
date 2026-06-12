CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL,
  family_id         UUID NOT NULL,

  platform          TEXT NOT NULL,
  device_name       TEXT,
  device_type       TEXT,
  os                TEXT,
  browser           TEXT,
  app_version       TEXT,
  fingerprint       TEXT,
  ip                INET,
  user_agent        TEXT,

  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT,
  replaced_by_id    UUID REFERENCES refresh_tokens(id),
  last_used_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_user_active       ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_family            ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user_platform     ON refresh_tokens(user_id, platform) WHERE revoked_at IS NULL;

