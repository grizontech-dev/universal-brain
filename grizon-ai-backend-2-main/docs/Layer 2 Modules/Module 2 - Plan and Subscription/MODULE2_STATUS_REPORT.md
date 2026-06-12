# Module 2 — Status Report

## Module

- Name: Plan & Subscription System
- Source docs: `docs/Layer 2 Modules/Module 2 - Plan and Subscription/`
- Report date: 2026-05-03

## Current Status

- Stage: **Implemented** (migrations + services + middleware + routes + tests + Postman + LLM prompt sync)
- Documentation set: Complete (01–09); contracts remain source of truth
- Code implementation: **Live** — see file list below
- Runtime readiness: Apply migrations **`009_plans.sql` → `013_plans_feature_limits.sql`**, ensure superadmin seed exists (`008_seed_superadmin.sql`) for FREE plan `created_by`

## Delivered Surface

### Migrations (`src/db/migrations/`)

| File | Purpose |
|------|---------|
| `009_plans.sql` | `plans` + indexes |
| `010_subscriptions.sql` | `subscriptions` + partial unique one-active-per-user + indexes |
| `011_subscription_history.sql` | `subscription_history` + index |
| `012_seed_free_plan.sql` | Canonical `plan_free_v1` seed |
| `013_plans_feature_limits.sql` | Adds `plans.feature_limits` + FREE plan backfill (`webSearch`/`codeExecution` as `null`) |

### Core code

| Area | Path |
|------|------|
| Config | `src/config/plan.ts` |
| Types + `Express.Request` | `src/types/plan.ts`, `src/types/feature.d.ts` |
| Plan serialize | `src/utils/planSerialize.ts` (includes `featureLimits` hydration from `feature_limits`) |
| Errors | Extended in `src/utils/errors.ts`; `parseQuery` in same file |
| Services | `src/services/plan.service.ts`, `src/services/subscription.service.ts` |
| PhonePe stub | `src/services/payment/phonepe.adapter.ts` |
| Events | `src/events/plan.events.ts` |
| Middleware | `src/gateway/plan.middleware.ts` (active; `WeakMap` memo per request) |
| User routes | `src/routes/user/plan.routes.ts` — mounted via `mountPlanUserRoutes` in `src/routes/user/index.ts` |
| Admin routes | `src/routes/admin/plan.routes.ts` — mounted in `src/routes/admin/index.ts` |
| Registration hooks | `auth.service.register` (txn + `assignFreePlan`); Google `registered` outcome (`assignFreePlan`) |

### Auth / platform alignment

- **`GET /api/v1/plans`** is public (no Bearer) but listed in `auth.middleware` public paths.
- **`/api/v1/auth/*`** rejects **`x-platform: admin`** (consumer-only namespace).
- **`/api/v1/plans`** and **`/api/v1/subscription*`** reject **`x-platform: admin`** via `requireConsumerPlatformForPlansModule` (mounted only under `/plans` and `/subscription`, so other `/api/v1/*` routes are unaffected).

## Live Routes

### User (`x-platform`: `web` \| `mobile-ios` \| `mobile-android`)

| Method | Path |
|--------|------|
| GET | `/api/v1/plans` |
| GET | `/api/v1/subscription` |
| POST | `/api/v1/subscription/upgrade` |
| POST | `/api/v1/subscription/cancel` |

### Admin (`x-platform`: `admin`, Bearer admin JWT + role)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/admin/plans` | |
| POST | `/api/v1/admin/plans` | |
| PATCH | `/api/v1/admin/plans/:id` | |
| POST | `/api/v1/admin/plans/:id/archive` | |
| POST | `/api/v1/admin/plans/:id/publish` | |
| GET | `/api/v1/admin/plans/:id/subscribers` | |
| GET | `/api/v1/admin/subscriptions` | |
| PATCH | `/api/v1/admin/subscriptions/:id` | **`requireSuperadmin`** |

Inherited foundation + Module 1 routes unchanged (`GET /`, `GET /health`, `/api/v1/ping`, `/api/v1/error`, `/api/v1/admin/ping`, `/api/v1/auth/*`, `/api/v1/admin/auth/*`).

## Tests

| Suite | Path |
|-------|------|
| Unit — period / rollover helpers | `test/unit/services/subscription.math.test.ts` |
| Integration — public catalog + admin platform rejection | `test/integration/routes/user.plan.routes.test.ts` |

**Run:** `npm test` — integration `beforeAll` hook timeout extended (`60s`) for cold `buildApp()` imports (`foundation.spec.ts` aligned).

## Artifacts

- Postman: `grizon-ai-backend-2.postman_collection.json` — folders **`Module 2 - User Plan Contracts`**, **`Module 2 - Admin Plan Contracts`**; variables **`planId`**, **`subscriptionId`** (defaults documented in Postman UI).
- LLM onboarding doc: `docs/LLM_NEW_MODULE_PROMPT.md` updated Postman group list + `/api/v1/auth/*` admin rejection note.

## Module 3 Compatibility Notes

- Plan create/patch flows now accept optional `featureLimits` and persist to `plans.feature_limits`.
- `Plan` snapshots exposed through middleware include `featureLimits` when present.
- Legacy snapshots with missing `featureLimits` remain valid and are treated as flag-only in Module 3.

## Risks / Notes (unchanged business constraints)

- Gateway examples in USD cents are superseded by Module 2 **INR paise** convention for money fields.
- Renewal cron + live PhonePe charges remain **out of scope**; `phonepeAdapter` throws **`501 NOT_IMPLEMENTED`**.
- Wallet applies rollover consumption on **`subscription.upgraded`** only when Module 4 consumes emitted metadata; unused balance for rollover math is **`0`** until Module 4 supplies wallet reads.
