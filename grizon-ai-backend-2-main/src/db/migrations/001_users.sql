CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT UNIQUE NOT NULL,
  email_normalised         TEXT UNIQUE NOT NULL,
  password_hash            TEXT,
  role                     TEXT NOT NULL DEFAULT 'user',
  status                   TEXT NOT NULL DEFAULT 'active',

  name                     TEXT NOT NULL,
  bio                      TEXT,
  avatar_url               TEXT,
  locale                   TEXT,
  timezone                 TEXT,

  registration_platform    TEXT NOT NULL DEFAULT 'web',

  email_verified_at        TIMESTAMPTZ,
  password_changed_at      TIMESTAMPTZ,
  failed_login_attempts    INT NOT NULL DEFAULT 0,
  locked_until             TIMESTAMPTZ,
  mfa_secret               TEXT,
  mfa_enabled              BOOLEAN NOT NULL DEFAULT false,

  last_login_at            TIMESTAMPTZ,
  last_login_ip            INET,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  banned_at                TIMESTAMPTZ,
  banned_by                UUID REFERENCES users(id),
  ban_reason               TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email_normalised ON users(email_normalised);
CREATE INDEX IF NOT EXISTS idx_users_role_status      ON users(role, status);

