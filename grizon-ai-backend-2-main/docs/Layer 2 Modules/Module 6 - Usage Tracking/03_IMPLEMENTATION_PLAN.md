# 03 — Implementation Plan

Concrete, ordered build for Module 6. Module 7 is a hard prerequisite for the *write path* (only its worker calls `usageTracker.record`); the rollup tables, admin dashboards, and user routes can be built and tested with seeded fixtures before Module 7 lands.

## Files to Create

| Path | Purpose |
|---|---|
| `src/types/usage.d.ts` | `UsageRecord`, `RecordUsageArgs`, aggregate row shapes |
| `src/services/usageTracker.service.ts` | `record(args)` — hashes IP, computes `total_tokens`, INSERTs, emits `usage.recorded`. Catches and logs errors; never throws to caller. |
| `src/services/analytics.service.ts` | Read-only queries: `getUserSummary(userId)`, `getUserHistory(userId, days)`, `getOverview(range)`, `getTopUsers(...)`, `getModelDistribution(range)`, `getCosts(range)`, `getErrors(range)`, `getRatelimits(range)` |
| `src/workers/usage.rollup.worker.ts` | Repeatable BullMQ job. `rollupSystemHourly` every 5 min; `rollupDailyUser` + `rollupDailyPlan` every 30 min. Each is idempotent via `ON CONFLICT DO UPDATE`. |
| `src/workers/usage.cleanup.worker.ts` | Daily cron (e.g. 03:30 IST). For now: stub that logs `usage_archive_skipped`. Hook reserved for cold-store dump when product asks. |
| `src/routes/user/usage.routes.ts` | `GET /usage/summary`, `GET /usage/history` |
| `src/routes/admin/analytics.routes.ts` | 6 routes |
| `src/controllers/user/usage.controller.ts` | thin |
| `src/controllers/admin/analytics.controller.ts` | thin |
| `src/events/usage.events.ts` | typed emitter |
| `src/db/migrations/017_usage_records.sql` | Full table per [`LAYER2_API_GATEWAY.md` §15](../../LAYER2_API_GATEWAY.md). Indexes: `(user_id, created_at desc)`, `(model_id, created_at desc)`, `(status, created_at desc)`, `(created_at)`. |
| `src/db/migrations/018_usage_daily_user.sql` | Composite PK `(user_id, day)`; index `(day)` for plan rollups. |
| `src/db/migrations/019_usage_daily_plan.sql` | Composite PK `(plan_id, day)`. |
| `src/db/migrations/020_usage_hourly_system.sql` | PK `hour`. |
| `test/unit/services/usageTracker.service.test.ts` | IP hashing, `total_tokens` computation, error-swallowing on DB failure |
| `test/unit/workers/usage.rollup.worker.test.ts` | Idempotent re-run, late-arriving rows in a closed bucket trigger an upsert |
| `test/integration/routes/usage.user.routes.test.ts` | `summary` and `history` against a seeded user with `usage_records` + matching `usage_daily_user` |
| `test/integration/routes/analytics.admin.routes.test.ts` | All 6 admin routes + RBAC |

## Files to Modify

| Path | Change |
|---|---|
| `src/routes/user/index.ts` | `userRoutes.use('/usage', usageRoutes)` |
| `src/routes/admin/index.ts` | `adminRoutes.use('/analytics', adminAnalyticsRoutes)` |
| `src/workers/chat.worker.ts` (Module 7, when it lands) | After every LLM call (success or failure), call `usageTracker.record(args)` once. Build `args` from worker context + `wallet.confirmDeduction`'s return. Document the call site as the **only** writer of `usage_records`. |
| `src/utils/errors.ts` | No new errors needed. |
| `docs/LLM_NEW_MODULE_PROMPT.md` | Add Postman groups `Module 6 - User Usage Contracts` and `Module 6 - Admin Analytics Contracts`. |
| `grizon-ai-backend-2.postman_collection.json` | 2 user reqs + 6 admin reqs. |

## Reused Utilities (do not re-implement)

- `src/infra/postgres.ts` — `query`, `queryOne`, prepared statements for hot dashboard endpoints
- `src/utils/logger.ts` — log every rollup-worker tick at `info`, every write failure at `error`
- `crypto.createHash('sha256')` (node stdlib) for IP hashing — pull `IP_HASH_SALT` from env via `src/config/env.ts` (add the var)
- BullMQ from existing `src/queues/*` setup (introduced by Module 7) — but Module 6's rollup worker uses BullMQ's repeatable jobs API, so it can ship even before chat queue exists if needed (a small queue named `usage` keeps it self-contained)

## Implementation Order

1. **Migrations 017–020** — apply, verify with `psql \\d`. Validate indexes against the typical dashboard queries (`EXPLAIN ANALYZE SELECT … FROM usage_daily_user WHERE user_id = $1 AND day BETWEEN …`).
2. **Types** (`src/types/usage.d.ts`) — exported `RecordUsageArgs` is what Module 7 will import.
3. **`usageTracker.service.ts`** — IP-hash + INSERT + emit. Unit test the hashing and the swallow-on-error behaviour with a mocked pool.
4. **Seed fixtures** — small script `npm run seed:usage` writes 30 days of synthetic `usage_records` for one test user across two plans. Lets the dashboards be built without Module 7.
5. **`analytics.service.ts`** — read queries first; mock data via the seed.
6. **Rollup worker** — start with `rollupSystemHourly`. Verify idempotency by running the seed twice over the same window. Add `rollupDailyUser` and `rollupDailyPlan`.
7. **User routes + controller** — `GET /usage/summary` reads `usage_daily_user` for the period, **plus** the live `usage_records` for the current day's rows that haven't been rolled up yet (lag fill). Document the lag-fill SQL inline in the controller.
8. **Admin routes + controller** — six endpoints, all read-only, all `requireAdmin`.
9. **Cleanup worker stub** — wire the cron, log the skip. Real archive lands later.
10. **Wire Module 7 (when it ships)** — in `chat.worker.ts`, exactly one `await usageTracker.record(...)` call per LLM call. Cover failure paths: `status='failed'`, `errorCode`, `finishReason='error'`. Tests use the existing Module 7 worker test scaffold.
11. **Postman + status report** — final.

## Verification

```bash
npm run migrate                                            # 017–020
npm run build
npm run seed:usage                                          # 30 days of synthetic data
npm test -- test/unit/services/usageTracker.service.test.ts
npm test -- test/unit/workers/usage.rollup.worker.test.ts
npm test -- test/integration/routes/usage.user.routes.test.ts
npm test -- test/integration/routes/analytics.admin.routes.test.ts
```

Manual smoke (Module 7 not yet shipped — use seed):

1. `npm run seed:usage` → inserts 30 days of `usage_records` for `seed_user_1` on a Pro plan.
2. Trigger the rollup worker once: `npm run worker:rollup -- --once`. Verify `usage_daily_user`, `usage_daily_plan`, and `usage_hourly_system` populated.
3. `GET /api/v1/usage/summary` as `seed_user_1` → returns the correct period totals (period bounded by their subscription).
4. `GET /api/v1/usage/history?days=7` → 7 entries, sorted ascending.
5. `GET /api/v1/admin/analytics/overview?from=2026-04-01&to=2026-05-01` as admin → totals match the seed.
6. `GET /api/v1/admin/analytics/costs?...` → margin column equals `creditsCharged - costUsd_in_credit_units`. Verify the math against a known seed row.
7. Stop Postgres → admin dashboards return `500 INTERNAL_ERROR` envelope; user dashboards do too. No silent empty payload.
8. Run rollup worker over the same window twice. Counts in rollup tables stay identical (proves `ON CONFLICT DO UPDATE`).

After Module 7 ships:

9. Send 5 chat messages as a real user. After 5 min, system hourly rollup should reflect `+5 requests`. After 30 min, `usage_daily_user` for today should add 5 to that user's row.
10. Force a chat call to fail (e.g. invalid model id). `usage_records.status = 'failed'`, `error_code` populated, dashboards count it under errors.

## Risks / Notes

- **Single-writer invariant for `usage_records`:** if anything other than Module 7's worker ever writes to this table, fix the violator — duplication breaks dashboards. Document in [`Module 6 README`](README.md) and in the chat worker's file-level JSDoc.
- **IP hash salt rotation:** if `IP_HASH_SALT` is rotated, historical hashes become incomparable. Document the policy: rotate at most yearly; previous salts are versioned in env (`IP_HASH_SALT_V2`, etc.). Out of scope today, but reserve the env name.
- **Retention boundary:** `usage_records` is hot for 90 days. The cleanup worker is a stub today — when product asks for longer retention, decide between (a) longer hot retention (more disk + slower queries) or (b) cold dump to S3 + BigQuery. Don't implement either prematurely.
- **Rollup catch-up lag:** if the worker is offline for more than its rollup interval, the next run scans a larger window. This is fine — `INSERT … ON CONFLICT DO UPDATE` handles it. But if the worker is offline for > 24 h, the daily rollup will need to backfill a multi-day range; the current SQL does that via `WHERE created_at BETWEEN last_processed AND now()` recorded in a small `worker_state` table (add it to `017` or as `017a`).
- **Cost-margin math:** `marginPct` requires both `actual_cost_usd` and `credits_deducted` × INR-to-USD price-of-a-credit. The price-of-a-credit lives in Module 2's plan config. Coordinate to make sure both modules agree on a single conversion constant (or a function call into `creditCalculator.toUsd()` from Module 4).
- **Performance budget:** dashboard endpoints must return < 250 ms p95 against rolled-up tables. If a query slips past that, that's the signal to add an index — never to denormalize further. Use `EXPLAIN ANALYZE` first.
- **No dashboard caching layer today:** if traffic to admin dashboards becomes painful, add a 60 s Redis cache keyed on `(endpoint, range)` in `analytics.service.ts`. Out of scope until measured.
