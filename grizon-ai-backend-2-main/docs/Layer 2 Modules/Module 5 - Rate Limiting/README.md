# Module 5 — Rate Limiting (4-Tier)

> Hourly / daily / weekly / monthly request caps, sliding-window in Redis, per-plan configurable.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §7](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, types, file structure, plan-shape extension, dependencies |
| 2 | [02_WINDOWS_AND_COOLDOWN.md](02_WINDOWS_AND_COOLDOWN.md) | Sliding-window algorithm, Redis key layout, manual cooldown, response headers, error envelopes, admin contracts |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, migrations, tests, verification |

## Status

- **Stage:** Implemented (middleware + service + migration + admin routes + tests)
- **Owner:** Backend
- **Last updated:** 2026-05-05

## Key Decisions

- **Four windows, all checked simultaneously.** Hourly · daily · weekly · monthly. Failing any one denies the request.
- **Sliding window via Redis sorted sets.** `ZADD/ZREMRANGEBYSCORE/ZCARD` per window — no fixed-bucket clock drift.
- **Limits live on the frozen plan snapshot** (`req.plan.limits`). No per-user override.
- **Cooldown is manual / admin-only.** Plan-window denials return `RATE_LIMIT_EXCEEDED` only. Operators may apply a Redis cooldown key via `POST /admin/ratelimits/:userId/cooldown`; repeated `cooldown` audit rows in 24h can still raise `flagged` for review (`rate_limit_events` + admin alert).
- **Headers always set** on every response, success or failure (`X-RateLimit-*`).
- **No user routes.** Module 5 is middleware-only; admin routes manage events + manual clears.
- **Audit table for events**, not for live limits — Redis is the source of truth, Postgres is the journal.
- **Pipeline position (locked):** `rateLimitMiddleware` (slot 10) runs **before** `creditBudgetMiddleware` (slot 11). See [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md). Already reflected in `src/app.ts`.

## Surface

- **0 user routes**
- **4 admin routes** under `/api/v1/admin/ratelimits/*`
- **1 middleware:** `rateLimitMiddleware` (slot 10 after the swap)
- **1 service:** `rateLimit.service.ts` (sliding-window arithmetic)
- **1 table:** `rate_limit_events` (audit only — already in `LAYER2_API_GATEWAY.md` §15)
- **Postman group:** `Module 5 - Admin RateLimit Contracts`

## Dependencies

- Module 1 — `req.user.id`
- Module 2 — `req.plan.limits` (`hourly`, `daily`, `weekly`, `monthly`; `null` = unlimited)
- `src/infra/redis.ts` — sorted sets
- `src/infra/postgres.ts` — `rate_limit_events` audit writes (async, never on the hot path)
