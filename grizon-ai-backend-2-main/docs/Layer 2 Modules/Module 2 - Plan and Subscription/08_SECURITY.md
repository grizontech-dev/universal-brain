# 08 — Security

Threat model and mitigations specific to Module 2. Auth-layer threats are owned by Module 1; this doc only covers concerns introduced by plan + subscription state.

## Threat Model

| # | Threat | Asset at risk | Severity |
|---|---|---|---|
| T1 | Snapshot tampering — user modifies plan_snapshot to grant themselves entitlements | Credits, model access, feature flags | Critical |
| T2 | Concurrent upgrade race creates two active subs | Billing integrity, downstream wallet logic | High |
| T3 | Replay of `POST /subscription/upgrade` causes duplicate billing once PG is live | User wallet, support overhead | High (when PG ships) |
| T4 | Plan-id enumeration leaks unreleased product tiers | Marketing surprise, competitive intel | Low |
| T5 | IDOR — user reads another user's subscription via guessed id | Other users' billing data | High |
| T6 | Admin escalation — non-admin somehow reaches `/admin/plans/*` | Catalog integrity | High |
| T7 | Live plan edit silently changes existing subscriber entitlements | User trust, billing disputes | High |
| T8 | Archived plan still subscribable | Catalog integrity | Medium |
| T9 | Admin downgrade via `PATCH /admin/subscriptions/:id` strips a paying customer | User trust | Medium |
| T10 | Webhook replay (future PhonePe) credits a subscription twice | Billing | High (when PG ships) |
| T11 | Plan field type confusion (e.g. negative `included` credits) | Wallet underflow downstream | Medium |
| T12 | Per-request memo poisoning across requests | Privilege confusion | Critical |

## Mitigations

### T1 — Snapshot tampering
- `plan_snapshot` is a **server-only** column. It is set by the service from a `SELECT` of the live `plans` row at upgrade time, never from the request body.
- The user-facing `Subscription` response is shaped by the service before serialisation; even if a route handler accidentally proxied request data into the response, it would not survive a round trip to the DB.
- Validation: services accept only `{ planId, billingCycle }` from clients; everything else is computed server-side.

### T2 — Concurrent upgrade race
- Partial unique index `idx_subscriptions_one_active_per_user` makes the second concurrent INSERT fail with `23505`.
- Service catches `23505` and returns `409 SUBSCRIPTION_CONFLICT` (idempotency-friendly: the client retries; the prior request already succeeded).
- Inside the transaction, the existing active row is read with `SELECT ... FOR UPDATE` to serialise upgrade vs cancel.

### T3 — Replay attacks on upgrade (PG-era)
- Today there is no charge, so replay is harmless beyond a `409 ALREADY_ON_PLAN`.
- When PhonePe lands: the future charge call uses `merchantTransactionId` derived as `sub_<userId>_<periodStart>_<rand>`; PhonePe rejects duplicate `merchantTransactionId` natively, and the service stores it in `pg_merchant_transaction_id` for audit.
- Recommend Idempotency-Key header on `POST /subscription/upgrade` once PG is live (out of scope today).

### T4 — Plan-id enumeration
- `GET /plans` returns only `is_public AND status='active'` rows. Internal-only plans (e.g. `plan_pilot_v1`) are invisible.
- `GET /admin/plans` requires admin; non-admins see `403 ADMIN_REQUIRED`.
- Plan ids are guessable (`plan_pro_v1`); the security boundary is **server enforcement**, not id obscurity.

### T5 — IDOR
- All user-facing endpoints derive the subscription from `req.user.id` server-side. There is no path parameter `/subscription/:id` for users — only for admins.
- `PATCH /admin/subscriptions/:id` and `GET /admin/plans/:id/subscribers` are admin-gated.

### T6 — Admin escalation
- `/admin/*` is gated by Module 1's `adminMiddleware` (requires `x-platform: admin` AND role ∈ {admin, superadmin}).
- `PATCH /admin/subscriptions/:id` adds `requireSuperadmin` because it bypasses billing.
- A regression test in `test/integration/routes/admin.plan.routes.test.ts` asserts `403 ADMIN_REQUIRED` for plain users and `403 SUPERADMIN_REQUIRED` for plain admins on the SA endpoint.

### T7 — Silent retroactive entitlement change
- The whole point of `plan_snapshot`. Live edits to `plans` only affect new subscriptions taken **after** the edit.
- `PATCH /admin/plans/:id` is restricted to non-breaking fields. Structural changes (`slug`, `name`) are rejected with `PLAN_FIELD_IMMUTABLE` so the convention "version + archive old" is forced.
- Convention is documented in [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md) and reinforced in admin error messages.

### T8 — Archived plan still subscribable
- `subscription.service.upgradeSubscription` re-reads `plans.status` inside the transaction (not a stale cache) and returns `410 PLAN_ARCHIVED` if archived.
- Public `GET /plans` filters on `status='active'` so the catalog never advertises archived plans.

### T9 — Admin downgrade abuse
- `PATCH /admin/subscriptions/:id` requires a non-empty `reason` field, written into `subscription_history.payload.reason` and the actor id into `actor_user_id`. Every adjustment is auditable.
- Superadmin-only.
- Future: emit a `subscription.admin_adjusted` event consumed by Notification module to email the affected user.

### T10 — Webhook replay (future)
- Reserved field `pg_merchant_transaction_id` is `UNIQUE`-friendly (we'll add a partial unique index when the integration ships).
- PhonePe X-VERIFY checksum verification is the responsibility of `phonepeAdapter.verifyCallback`, with a per-request idempotency check on `merchantTransactionId`.

### T11 — Plan field type confusion
- Zod schemas in route layer reject negatives, non-integers, and unknown enums.
- Migration 009 enforces `CHECK (status IN ...)` and `CHECK (billing_cycle IN ...)` at DB level.
- `credits.included` is positive-int validated in the Zod schema for `POST /admin/plans`.

### T12 — Per-request memo poisoning
- The `WeakMap<Request, Subscription>` memo is keyed by the Express `Request` object reference, which is unique per request and garbage-collected after response. There is no possible cross-request leakage because no request references another's `Request` object.
- Memo is set only after a successful service load; on errors, no entry is written.

## Data Sensitivity Classification

| Field | Sensitivity | Visible to |
|---|---|---|
| `plans.*` (public rows) | Public | Anyone via `/plans` |
| `plans.*` (non-public rows) | Internal | Admins only |
| `subscriptions.plan_snapshot`, `.status`, `.period*`, `.credits*` | User-private | Owner + admins |
| `subscriptions.pg_*` | Sensitive (financial) | Admins only — never returned in user-facing `GET /subscription` |
| `subscription_history.*` | Internal | Admins only |

The user-route response shaper at `src/routes/user/plan.routes.ts` will explicitly omit `pg_*` fields. A regression test will assert this.

## Defence-in-Depth Checklist

- [ ] Partial unique index in migration 010 verified
- [ ] `plan_snapshot` only ever set from server-side SELECT, never from request body
- [ ] `requireSuperadmin` on `PATCH /admin/subscriptions/:id`
- [ ] Zod schemas reject negative numbers / unknown billing cycles / extra plan fields
- [ ] User route response shaper strips `pg_*` columns
- [ ] `subscription_history.actor_user_id` populated on every admin write
- [ ] Memo stored in `WeakMap` (not a global object)
- [ ] Integration tests cover IDOR (user A can't read user B's sub), admin/superadmin gating, and concurrent upgrade race
