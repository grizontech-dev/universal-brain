# 03 — Database Schema

All tables owned (or extended) by Module 1. PostgreSQL 16. UUID primary keys via `gen_random_uuid()`.

## Tables Summary

| Table | Purpose | Owner |
|---|---|---|
| `users` | Identity + profile + auth state per account | Module 1 (extends Layer 2 baseline) |
| `oauth_accounts` | One row per linked external identity (Google today; Apple/GitHub later) | Module 1 |
| `refresh_tokens` | One row per active device session (multi-device) | Module 1 |
| `token_blacklist` | Revoked access JWTs (Postgres mirror of Redis) | Module 1 |
| `auth_audit` | Append-only log of every auth event | Module 1 |
| `password_reset_tokens` | Single-use links for forgot-password | Module 1 |
| `email_verification_tokens` | Single-use links for email verify | Module 1 |

## DDL

### users

Extends the baseline in `LAYER2_API_GATEWAY.md` §15 with auth-only fields.

```sql
CREATE TABLE users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT UNIQUE NOT NULL,
  email_normalised         TEXT UNIQUE NOT NULL,         -- lowercased + trimmed for lookup
  password_hash            TEXT,                          -- argon2id; null if user signed up via Google only
  role                     TEXT NOT NULL DEFAULT 'user', -- user | admin | superadmin
  status                   TEXT NOT NULL DEFAULT 'active', -- active | banned | suspended

  -- Profile (user-editable)
  name                     TEXT NOT NULL,                 -- display name, 1–60 chars
  bio                      TEXT,                          -- description, 0–500 chars
  avatar_url               TEXT,
  locale                   TEXT,                          -- e.g. 'en-IN'; defaults from accept-language at register
  timezone                 TEXT,                          -- IANA tz; defaults from client at register

  -- Source / multi-platform
  registration_platform    TEXT NOT NULL DEFAULT 'web',   -- where the account was first created

  -- Auth state
  email_verified_at        TIMESTAMPTZ,
  password_changed_at      TIMESTAMPTZ,
  failed_login_attempts    INT NOT NULL DEFAULT 0,
  locked_until             TIMESTAMPTZ,
  mfa_secret               TEXT,                          -- placeholder, future TOTP
  mfa_enabled              BOOLEAN NOT NULL DEFAULT false,

  -- Bookkeeping
  last_login_at            TIMESTAMPTZ,
  last_login_ip            INET,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  banned_at                TIMESTAMPTZ,
  banned_by                UUID REFERENCES users(id),
  ban_reason               TEXT
);

CREATE INDEX idx_users_email_normalised ON users(email_normalised);
CREATE INDEX idx_users_role_status      ON users(role, status);
```

### refresh_tokens

The **device list**. One row = one signed-in device. A user can have arbitrarily many concurrent rows across platforms (web, mobile-ios, mobile-android, admin). Rotated on every `/auth/refresh`.

```sql
CREATE TABLE refresh_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL,                       -- SHA-256 of the token
  family_id         UUID NOT NULL,                       -- groups rotated tokens; reuse → revoke whole family

  -- Device / platform metadata (shown in /auth/sessions)
  platform          TEXT NOT NULL,                       -- 'web' | 'admin' | 'mobile-ios' | 'mobile-android'
  device_name       TEXT,                                -- user-supplied or derived (e.g. "iPhone 15 · Safari")
  device_type       TEXT,                                -- 'desktop' | 'mobile' | 'tablet' | 'unknown'
  os                TEXT,                                -- 'macOS 14' | 'iOS 17' | …
  browser           TEXT,                                -- 'Chrome 124' | null on native
  app_version       TEXT,                                -- mobile build version, null on web
  fingerprint       TEXT,                                -- device fingerprint hash
  ip                INET,
  user_agent        TEXT,

  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT,                                -- 'logout' | 'rotated' | 'reuse_detected' | 'admin' | 'ban'
  replaced_by_id    UUID REFERENCES refresh_tokens(id),  -- next token in rotation chain
  last_used_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_user_active       ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_family            ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_user_platform     ON refresh_tokens(user_id, platform) WHERE revoked_at IS NULL;
```

> Multi-device note: there is no per-user cap by default. If product later wants "max N active devices", `session.service.create()` will revoke the oldest row past the cap; the schema doesn't change.

### oauth_accounts

One row per linked external identity. A user may have zero or more linked providers; today only Google is implemented, but the table is designed to take Apple, GitHub, etc. without schema changes.

```sql
CREATE TABLE oauth_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,                   -- 'google' (future: 'apple', 'github')
  provider_user_id      TEXT NOT NULL,                   -- Google `sub` claim — stable, opaque
  provider_email        TEXT NOT NULL,                   -- email from the provider at link time
  email_verified        BOOLEAN NOT NULL,                -- from provider
  raw_profile           JSONB NOT NULL DEFAULT '{}',     -- name, picture, locale, etc. (last seen)
  linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_oauth_provider_subject ON oauth_accounts(provider, provider_user_id);
CREATE INDEX        idx_oauth_user             ON oauth_accounts(user_id);
```

- `(provider, provider_user_id)` is the unique key — the same Google account can't be linked to two of our users.
- `provider_email` is captured at link time only; we always trust `provider_user_id` for identity, never the email (Google emails can be reassigned in rare admin cases).
- A user with `password_hash IS NULL` and no `oauth_accounts` row is impossible — the constraint is enforced at the application layer (`auth.service` rejects unlinking the last sign-in method).

### token_blacklist

Postgres mirror of the Redis `auth:blacklist:{jti}` set, kept for audit + cold-restart recovery.

```sql
CREATE TABLE token_blacklist (
  jti          TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  reason       TEXT NOT NULL,            -- 'logout' | 'admin_revoke' | 'ban'
  expires_at   TIMESTAMPTZ NOT NULL,     -- = original JWT exp; rows older than this are GC'd nightly
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blacklist_expires_at ON token_blacklist(expires_at);
```

### auth_audit

Append-only. Never updated. Used for security investigations and admin dashboards.

```sql
CREATE TABLE auth_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),              -- nullable: failed login of unknown email
  actor_id      UUID REFERENCES users(id),              -- admin who performed the action (impersonate, ban)
  event_type    TEXT NOT NULL,                          -- see event-type list below
  ip            INET,
  user_agent    TEXT,
  fingerprint   TEXT,
  success       BOOLEAN NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_user_created ON auth_audit(user_id, created_at DESC);
CREATE INDEX idx_audit_event        ON auth_audit(event_type, created_at DESC);
```

**Event types written:**
`register`, `register_google`, `login`, `login_google`, `login_new_device`, `login_failed`, `email_check`, `google_linked`, `google_unlinked`, `logout`, `logout_all`, `refresh`, `refresh_reuse_detected`, `profile_updated`, `password_changed`, `password_reset_requested`, `password_reset_completed`, `email_verify_requested`, `email_verify_completed`, `admin_ban`, `admin_unban`, `admin_force_logout`, `admin_session_revoked`, `admin_reset_password`, `admin_impersonate_start`, `admin_impersonate_end`, `account_locked`, `account_unlocked`.

### password_reset_tokens

```sql
CREATE TABLE password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,                           -- SHA-256 of opaque token
  expires_at   TIMESTAMPTZ NOT NULL,                    -- 30 minutes from issue
  used_at      TIMESTAMPTZ,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_reset_token_hash ON password_reset_tokens(token_hash);
```

### email_verification_tokens

```sql
CREATE TABLE email_verification_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,                    -- 24 hours from issue
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_verify_token_hash ON email_verification_tokens(token_hash);
```

## Column → Use-site Cross-Reference

| Column | Read by | Written by |
|---|---|---|
| `users.password_hash` | `auth.service.login` | `auth.service.register`, `auth.service.changePassword`, `auth.service.resetPassword` |
| `users.failed_login_attempts`, `users.locked_until` | `auth.service.login` (lockout gate) | `auth.service.login` (on fail / on success reset) |
| `users.email_verified_at` | `requireFeature` checks needing verified email | `auth.service.confirmEmailVerify` |
| `users.role` | `admin.middleware`, `requireSuperadmin` | `admin.users.update` route |
| `users.status` | `auth.middleware` (block banned), `auth.service.login` | admin ban/unban routes |
| `refresh_tokens.token_hash` | `auth.service.refresh` | `auth.service.login`, `auth.service.refresh` (rotate) |
| `refresh_tokens.family_id` | reuse-detection in `auth.service.refresh` | `auth.service.login` (new family), inherited on rotation |
| `refresh_tokens.revoked_at` | `auth.service.refresh`, `session.service.list` | logout, admin force-logout, ban cascade |
| `refresh_tokens.platform / device_name / device_type` | `/auth/sessions` UI listing | `auth.service.login` (captured from headers + UA) |
| `token_blacklist.jti` | `auth.middleware` (blacklist check) | `auth.service.logout`, admin force-logout |
| `users.name / bio / avatar_url / locale / timezone` | `/auth/me` GET | `/auth/me` PATCH (profile.service) |
| `auth_audit.*` | admin audit endpoint | every flow that touches identity |

Every endpoint listed in [05_USER_API_CONTRACTS.md](05_USER_API_CONTRACTS.md) and [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md) maps to one or more of these reads/writes.
