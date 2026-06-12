# Module 3 — Feature Flag Engine

> Per-route feature gating built on top of the frozen plan snapshot from Module 2.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §5](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, types (`FeatureFlags`, `FeatureLimits`), file structure, Plan-shape extension |
| 2 | [02_MIDDLEWARE_AND_LIMITS.md](02_MIDDLEWARE_AND_LIMITS.md) | `requireFeature` + `requireFeatureWithLimit` contracts, Redis key layout, error envelopes, response headers, security |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, Module 2 touch-points (migration 013), tests, verification |

## Status

- **Stage:** Implemented (middleware + config + service + migration + tests)
- **Owner:** Backend
- **Last updated:** 2026-05-05

## Key Decisions

- **No routes, no DB tables of its own.** Module 3 = 2 middleware factories + 1 column added to `plans`.
- **`featureFlags` is binary; `featureLimits` is per-window quota.** Two factories, two purposes.
- **Counters live in Redis** under `feature:<name>:<window>:{userId}` with first-use TTL.
- **Fail-open on Redis-down** (logged WARN). Hard caps live in Module 4 (wallet) and Module 5 (rate limit), not here.
- **No per-user override** — flags come exclusively from the frozen plan snapshot. Admin-comping a user means moving them to a different plan via Module 2.
- **Race-condition tolerance:** check-then-INCR is non-atomic and may over-count by ≤ user concurrency. Acceptable; documented.

## Dependencies

- Module 1 — `req.user.id`
- Module 2 — `req.plan.featureFlags`, `req.plan.featureLimits` (added by migration 013)
- `src/infra/redis.ts` — existing Redis client

## Surface

- 0 routes
- 2 middleware factories: `requireFeature(flag)`, `requireFeatureWithLimit(feature)`
- 1 type file, 1 service file, 1 config file, 1 migration
