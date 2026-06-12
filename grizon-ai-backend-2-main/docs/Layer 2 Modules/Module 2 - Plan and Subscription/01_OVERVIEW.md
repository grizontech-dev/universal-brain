# 01 — Overview

## Mission

Module 2 is the **monetization spine** of the API Gateway. It owns the catalog of plans the product sells, the subscription record that ties each user to one plan at a time, and the middleware that injects a frozen plan snapshot onto every authenticated request. Once Module 1 has answered *who* the caller is, Module 2 answers *what they're entitled to* — credits, limits, feature flags, model access — and hands that answer to every downstream module without further work.

Plans are **immutable once active** and **versioned**, never edited in place. Subscriptions carry a `planSnapshot` so that price/limit changes never silently affect existing subscribers. Every user has a subscription — even free users hold an active `FREE` subscription — so downstream code never has to handle a "no plan" branch.

## Responsibilities

- **Plan catalog** — create, publish, archive, and read plans (admin CRUD + public list)
- **Plan immutability** — reject mutations to structural fields on a live plan; force versioning instead
- **Subscription lifecycle** — assign FREE on registration, upgrade to a paid plan, cancel (graceful or immediate), admin adjust
- **Snapshot freezing** — copy the plan into `subscriptions.plan_snapshot` at subscription/upgrade time so future plan edits cannot retroactively change a user's entitlements
- **`req.plan` / `req.subscription` injection** — load the active subscription on every authenticated request and attach the snapshot
- **One-active-sub invariant** — enforce a single `status='active'` subscription per user via partial unique index
- **Period bookkeeping** — `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, billing cycle (`monthly` | `annual`)
- **Credit rollover math** — at renewal, compute next-period grant = `included + min(unused, maxRollover)`. Module 2 emits the renewal event with the computed grant; Module 4 (Wallet) actually credits.
- **Subscription history** — append-only log of every plan change, renewal, cancel, admin adjustment
- **Payment-gateway boundary** — schema and service shape are aligned to **PhonePe** (the chosen PG). Module 2 ships **no live PG integration**; a `PaymentGatewayAdapter` interface is reserved for the future Module N PhonePe integration.

> **Out of scope by design:** charging users (no PhonePe order create / X-VERIFY callback yet), wallet writes (Module 4), rate-limit enforcement (Module 5), feature flag gating (Module 3), renewal cron (added with Module 4/5).

## Non-Responsibilities

These belong to other Layer 2 modules and **must not** leak into Module 2:

| Concern | Owner |
|---|---|
| Bearer JWT verify, `req.user` load | Module 1 (Auth) |
| Feature-flag gating (`requireFeature`) | Module 3 (Feature Flag Engine) |
| Wallet ledger writes / debit on usage | Module 4 (Credit Wallet) |
| Per-bucket rate limit enforcement | Module 5 (Rate Limit) |
| Usage / cost tracking | Module 6 (Usage Tracking) |
| Live PhonePe charge / mandate creation | Future PhonePe integration module |

Module 2 *reads* `req.user` from Module 1 and *publishes* `req.plan` + events. Nothing else.

## Inputs

| Source | What it carries |
|---|---|
| `req.user.id` (set by Module 1) | Identity of the caller; used to locate their active subscription |
| `req.user.role` | Routes the caller through user vs admin code paths |
| `req.platform` | Inherited; not gated by this module |
| Request body on `/subscription/upgrade` | `{ planId, billingCycle }` |
| Request body on `/subscription/cancel` | `{ immediate?: boolean }` |
| Request body on `POST /admin/plans` | Full Plan creation payload |
| Request body on `PATCH /admin/plans/:id` | Subset of non-breaking fields only |
| Request body on `PATCH /admin/subscriptions/:id` | Period / status / credit adjustments (superadmin) |

## Outputs (attached to `req`)

```ts
req.subscription  // { id, userId, planId, planSnapshot, billingCycle, status,
                  //   currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd,
                  //   creditsGranted, creditsRolledOver, pgProvider, pgSubscriptionId, ... }

req.plan          // = req.subscription.planSnapshot
                  // The frozen Plan object — what THIS user is entitled to RIGHT NOW.
                  // Downstream modules MUST read entitlements from req.plan, not from
                  // the live plans table, so plan edits never affect existing subscribers.
```

`req.subscription` is undefined on:
- requests without `req.user` (public routes)
- explicit allowlist (`/health`, `/plans`, `/auth/*`)

`req.plan` falls back to the FREE plan snapshot if a user somehow has no active subscription (auto-assigned and recovered idempotently inside the middleware so the request continues).

## Module Touchpoints (text diagram)

```
                  ┌──────────────────────────┐
                  │  Module 1: Auth          │
                  │  sets req.user           │
                  └────────────┬─────────────┘
                               ▼
                  ┌──────────────────────────┐
                  │  Module 2: Plan & Sub    │  ← THIS MODULE
                  │  loads sub + snapshot    │
                  │  attaches req.plan       │
                  └────────────┬─────────────┘
                               │
        ┌──────────┬───────────┼───────────┬──────────┬──────────┐
        ▼          ▼           ▼           ▼          ▼          ▼
   Module 3    Module 4    Module 5    Module 6    Module 9    Module 10
   Feature     Credit      Rate        Usage       Sanitiser   Smart
   flags       Wallet      Limit       Tracker     (size)      Router
   reads       reads       reads       reads       reads       reads
   plan.       plan.       plan.       (no plan    plan.       plan.
   feature     credits     limits      read; just  limits      modelAccess
   Flags       .included   .{hourly..} writes log) .maxFile..  agentAccess
```

## Public Surface (1-line summary)

- 4 user endpoints under `/api/v1/{subscription,plans}/*`
- 8 admin endpoints under `/api/v1/admin/{plans,subscriptions}/*`
- 1 middleware: `planMiddleware`
- 2 services: `plan.service`, `subscription.service`
- 1 stub: `payment/phonepe.adapter.ts` (interface only — no live calls)

Detailed in [02_FILE_STRUCTURE.md](02_FILE_STRUCTURE.md), [05_USER_API_CONTRACTS.md](05_USER_API_CONTRACTS.md), [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md).
