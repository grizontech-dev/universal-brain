# 03 — Database Schema

All tables owned by Module 2. PostgreSQL 16. UUID primary keys via `gen_random_uuid()` where applicable.

> **Currency convention:** all money in this module is stored as **Indian Rupees in paise** (the smallest unit, integer). e.g. `49900` = ₹499.00. PhonePe APIs accept paise natively, so no conversion is needed at the PG boundary.

## Tables Summary

| Table | Purpose | Owner |
|---|---|---|
| `plans` | Versioned, immutable catalog of billing tiers | Module 2 |
| `subscriptions` | One row per user × plan period; carries frozen `plan_snapshot` | Module 2 |
| `subscription_history` | Append-only log of every plan change, renewal, cancel, admin adjustment | Module 2 |

## DDL

### plans

The catalog. Plans are **immutable once active**: structural fields (slug, name) cannot change. Pricing/credits/limits/flags can be patched, but the convention is to version (`plan_pro_v2`) and archive the old when behaviour shifts noticeably.

```sql
CREATE TABLE plans (
  id                TEXT PRIMARY KEY,                       -- slug-like, e.g. 'plan_free_v1', 'plan_pro_v1'
  name              TEXT NOT NULL,                          -- display name, e.g. 'Pro'
  slug              TEXT UNIQUE NOT NULL,                   -- URL-safe, e.g. 'pro'
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','archived')),
  is_public         BOOLEAN NOT NULL DEFAULT false,         -- show on /plans (pricing page)
  is_introductory   BOOLEAN NOT NULL DEFAULT false,         -- limited-time / launch plan flag

  -- Money (INR, paise)
  pricing           JSONB NOT NULL,                         -- { monthly: 49900, annual: 39900, currency: 'inr' }

  -- Credits & rollover
  credits           JSONB NOT NULL,                         -- { included, rollover, maxRollover, topupEnabled, topupPackages }

  -- Per-period quotas + per-request size caps
  limits            JSONB NOT NULL,                         -- { hourly, daily, weekly, monthly,
                                                            --   maxContextMessages, maxFileSize, maxFilesPerChat,
                                                            --   maxArtifactVersions }

  -- Capability gates
  model_access      TEXT[] NOT NULL DEFAULT '{}',           -- e.g. ['gpt-4o-mini','claude-haiku']
  agent_access      TEXT[] NOT NULL DEFAULT '{}',           -- e.g. ['research','code']
  feature_flags     JSONB NOT NULL DEFAULT '{}',            -- { webSearch: true, codeExecution: false, ... }

  -- Bookkeeping
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at       TIMESTAMPTZ,
  created_by        UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_plans_status_public ON plans(status, is_public);
CREATE UNIQUE INDEX idx_plans_slug   ON plans(slug);
```

**Immutability enforcement** lives in the application layer (`plan.service.updatePlan`), not in the DB. The DB happily accepts any update; the service rejects changes to `slug`, `name`, `id` with `PLAN_FIELD_IMMUTABLE` so that snapshots taken in `subscriptions.plan_snapshot` remain meaningful.

### subscriptions

One row per **subscription period**. A user's history of subscriptions accumulates here; only one row per user has `status='active'` at a time, enforced by a partial unique index.

```sql
CREATE TABLE subscriptions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                     TEXT NOT NULL REFERENCES plans(id),
  plan_snapshot               JSONB NOT NULL,                 -- frozen Plan at subscription/upgrade time

  billing_cycle               TEXT NOT NULL
                                CHECK (billing_cycle IN ('monthly','annual')),
  status                      TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','past_due','cancelled','paused')),

  current_period_start        TIMESTAMPTZ NOT NULL,
  current_period_end          TIMESTAMPTZ NOT NULL,
  cancel_at_period_end        BOOLEAN NOT NULL DEFAULT false,

  -- Wallet hand-off (Module 4 reads these on renewal)
  credits_granted             INTEGER NOT NULL DEFAULT 0,     -- credits given at period start
  credits_rolled_over         INTEGER NOT NULL DEFAULT 0,     -- portion brought from previous period

  -- Payment Gateway (PhonePe-shaped; reserved, no live integration in Module 2)
  pg_provider                 TEXT
                                CHECK (pg_provider IN ('phonepe')),
  pg_subscription_id          TEXT,                           -- PhonePe subscription / mandate id
  pg_merchant_transaction_id  TEXT,                           -- PhonePe `merchantTransactionId` for the originating order
  pg_customer_ref             TEXT,                           -- PhonePe customer / MUID reference

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active subscription per user
CREATE UNIQUE INDEX idx_subscriptions_one_active_per_user
  ON subscriptions(user_id) WHERE status = 'active';

CREATE INDEX idx_subscriptions_user        ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_plan        ON subscriptions(plan_id);
CREATE INDEX idx_subscriptions_status      ON subscriptions(status);
CREATE INDEX idx_subscriptions_period_end  ON subscriptions(current_period_end);
```

> **Why store `plan_snapshot` as JSONB?** Plans evolve. A user who subscribed to `plan_pro_v1` at ₹499 keeps that price and that feature set for the duration of their period, even if an admin patches the live plan tomorrow. The snapshot is the source of truth for entitlements; the live `plans` row is the source of truth for *new* signups only.

> **Why a partial unique index instead of an app-level check?** Race conditions during simultaneous upgrade requests would otherwise allow two `active` rows for the same user. The index makes the second insert fail with a clean DB error that the service maps to `ALREADY_ON_PLAN` or `SUBSCRIPTION_CONFLICT`.

### subscription_history

Append-only audit log. Never updated. Used by admin dashboards and the cancel/renewal flow to reconstruct timelines.

```sql
CREATE TABLE subscription_history (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  event            TEXT NOT NULL,                       -- see event list below
  from_plan_id     TEXT REFERENCES plans(id),
  to_plan_id       TEXT REFERENCES plans(id),
  actor_user_id    UUID REFERENCES users(id),           -- null = system
  payload          JSONB NOT NULL DEFAULT '{}',
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sub_hist_sub_time ON subscription_history(subscription_id, occurred_at DESC);
```

**Event types written:**
`created`, `upgraded`, `renewed`, `cancel_scheduled`, `cancelled`, `paused`, `resumed`, `admin_adjusted`.

## Seed (migration 012)

```sql
-- Canonical FREE plan. Every new user is auto-subscribed to this row.
INSERT INTO plans (
  id, name, slug, status, is_public, is_introductory,
  pricing, credits, limits, model_access, agent_access, feature_flags,
  created_by
) VALUES (
  'plan_free_v1', 'Free', 'free', 'active', true, false,
  '{"monthly":0,"annual":0,"currency":"inr"}'::jsonb,
  '{"included":1000,"rollover":false,"maxRollover":null,"topupEnabled":false,"topupPackages":[]}'::jsonb,
  '{"hourly":20,"daily":100,"weekly":500,"monthly":1000,"maxContextMessages":10,"maxFileSize":1048576,"maxFilesPerChat":2,"maxArtifactVersions":3}'::jsonb,
  ARRAY['gpt-4o-mini']::TEXT[],
  ARRAY[]::TEXT[],
  '{"webSearch":false,"codeExecution":false,"fileUpload":false,"documentCreation":false,"documentAnalysis":false,"deepResearch":false}'::jsonb,
  (SELECT id FROM users WHERE role='superadmin' ORDER BY created_at LIMIT 1)
)
ON CONFLICT (id) DO NOTHING;
```

The numbers above are sensible defaults; product can revise them by shipping `plan_free_v2` later (never by editing this row).

## Column → Use-site Cross-Reference

| Column | Read by | Written by |
|---|---|---|
| `plans.status`, `plans.is_public` | `plan.service.listPublicPlans` (filters), `subscription.service.upgradeSubscription` (rejects archived/non-public) | admin archive/publish endpoints |
| `plans.pricing`, `plans.credits`, `plans.limits` | `subscription.service.upgradeSubscription` (snapshot freeze) | admin create/update endpoints |
| `subscriptions.plan_snapshot` | `planMiddleware` → `req.plan` | `subscription.service.upgradeSubscription`, `assignFreePlan` |
| `subscriptions.status` | `getActiveSubscriptionForUser`, partial unique index | `cancelSubscription`, renewal cron (future), admin adjust |
| `subscriptions.current_period_end` | renewal cron (future) | `upgradeSubscription`, renewal cron |
| `subscriptions.cancel_at_period_end` | renewal cron (future) — flips to `cancelled` + assigns FREE | `cancelSubscription({ immediate:false })` |
| `subscriptions.credits_granted`, `.credits_rolled_over` | Module 4 (Wallet) on `subscription.renewed` event | `assignFreePlan`, `upgradeSubscription`, renewal cron |
| `subscriptions.pg_*` | future PhonePe integration only | future PhonePe integration only |
| `subscription_history.*` | admin dashboard endpoint | every state-changing service method |

Every endpoint in [05_USER_API_CONTRACTS.md](05_USER_API_CONTRACTS.md) and [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md) maps to one or more of these reads/writes.
