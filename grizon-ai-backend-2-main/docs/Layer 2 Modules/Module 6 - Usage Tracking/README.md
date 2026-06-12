# Module 6 — Usage Tracking & Analytics

> Per-call usage records and pre-computed aggregates for users, plans, and the system.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §8](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, types (`UsageRecord`, aggregates), file structure, dependencies |
| 2 | [02_USAGE_RECORDS_AND_AGGREGATES.md](02_USAGE_RECORDS_AND_AGGREGATES.md) | Write contract (called by Module 7), aggregation cadence, user + admin route contracts, error envelopes |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, migrations, tests, verification |

## Status

- **Stage:** Implemented
- **Owner:** Backend
- **Last updated:** 2026-05-05

## Key Decisions

- **Single fact table:** `usage_records` — one row per LLM call (or per chargeable feature use). Append-only, never updated.
- **Aggregations are pre-computed.** Hot dashboards never scan the fact table directly. Daily and hourly rollups live in `usage_daily_user`, `usage_daily_plan`, and `usage_hourly_system`.
- **Module 6 does not deduct credits or call providers.** It is invoked by Module 7's worker at the end of each LLM call with the final numbers; it persists, emits, and aggregates.
- **No real-time streaming aggregates.** A BullMQ repeatable job rolls up the last hour every 5 min and the last day every 30 min. Cheap, debuggable, accurate within the lag window.
- **PII stays out of analytics.** `usage_records.ip_address` is hashed at write time. Email never appears in aggregates.
- **No on-the-fly cost recompute.** `actual_cost_usd` and `credits_deducted` are written once with the values used by Module 4 and never recomputed.

## Surface

- **2 user routes** under `/api/v1/usage/*`
- **6 admin routes** under `/api/v1/admin/analytics/*`
- **0 middleware** (Module 6 is invoked from Module 7's worker, not from the request pipeline)
- **2 services:** `usageTracker.service.ts` (write path), `analytics.service.ts` (read path)
- **4 tables:** `usage_records`, `usage_daily_user`, `usage_daily_plan`, `usage_hourly_system`
- **2 workers:** `usage.rollup.worker.ts` (cron), `usage.cleanup.worker.ts` (90-day archive)
- **Postman groups:** `Module 6 - User Usage Contracts`, `Module 6 - Admin Analytics Contracts`

## Dependencies

- Module 1 — `req.user.id` for user-facing reads
- Module 2 — `plan_id` joined for per-plan aggregates
- Module 4 — emits `wallet.deducted`; Module 6 mirrors `credits_deducted` and `agent_multiplier` / `plan_discount` into the fact row
- Module 5 — denial events (`rate_limit_events`) feed the `analytics/ratelimits` admin dashboard but are written by Module 5 itself; Module 6 only reads them
- Module 7 — chat worker is the long-term writer of `usage_records` rows.  
  Temporary Module 6 bridge: `wallet.service.ts` writes usage rows after `confirmDeduction` until Module 7 worker is available.
