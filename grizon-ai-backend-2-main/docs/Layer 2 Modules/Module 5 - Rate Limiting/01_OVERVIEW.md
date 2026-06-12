# 01 — Overview

## Mission

Module 5 is the **request governor**. It rejects or admits each authed request based on how many requests the user has made in the last hour, day, week, and month — all four windows checked at once. Limits come from the frozen plan snapshot, so a user's caps are fixed for the lifetime of their current subscription period.

It does not count tokens, credits, or feature usage. Module 4 (credits) and Module 3 (feature limits) handle those concerns. Module 5's only job is "did this user make too many HTTP requests?"

## Scope

### In scope
- `rateLimit.middleware.ts` — replaces the existing pipeline stub
- `services/rateLimit.service.ts` — sliding-window arithmetic via Redis sorted sets
- Per-window counters: `hourly`, `daily`, `weekly`, `monthly`
- **No automatic burst cooldown** after plan-window denials; operators may apply cooldown via admin API
- **Flagging:** many `cooldown` audit rows in 24 h (typically from repeated admin applies) → `rate_limit_events` `flagged` + admin notification
- 4 admin routes under `/api/v1/admin/ratelimits/*`
- Response headers (`X-RateLimit-*`) on every response

### Out of scope
- Token / credit / feature counters (Modules 3, 4)
- Provider-side rate limits (those are LLM-call-time concerns, handled in `models/provider.ts` with retries + fallback)
- IP-based rate limiting (different mechanism; lives in nginx + helmet at the edge — out of this module)
- Bypass / whitelisting via env (intentionally absent — overrides happen via plan changes only)

## Inputs

| Source | What it carries |
|---|---|
| `req.user.id` (Module 1) | Bucket key for all four windows |
| `req.plan.limits` (Module 2) | `{ hourly, daily, weekly, monthly }`. Each may be a positive integer or `null` (unlimited). |
| `req.method`, `req.path` | Used only to skip non-counted routes (`/health`, `/wallet`, GET `/auth/me`) |

If `req.plan.limits` is missing → Module 5 throws `Errors.internal('plan_limits_not_loaded')` (programming bug, 500).

## Outputs

- **Allow** → `next()` after recording the request in all four windows. Headers set with remaining counts.
- **Deny** → `429 RATE_LIMIT_EXCEEDED` envelope + `Retry-After` header + headers showing the failed window's reset time. No window is incremented on a denial.
- **Cooldown denial** → `429 RATE_LIMIT_COOLDOWN` when `ratelimit:cooldown:{userId}` is active (admin-applied). TTL matches the applied duration (default `COOLDOWN_DURATION_SEC` in config).
- **Events emitted** to `src/events/rateLimit.events.ts`:
  - `ratelimit.hit` `{ userId, window, limit }`
  - `ratelimit.cooldown_started` `{ userId, until, reason }`
  - `ratelimit.flagged` `{ userId, cooldownsInLast24h }` (consumed by Module 1 admin notifications)
  - `ratelimit.cleared` `{ userId, byActor }`

All HTTP responses use the universal envelope from [`Project Foundation/03_REQUEST_RESPONSE.md`](../../Project%20Foundation/03_REQUEST_RESPONSE.md).

## Type Contracts

```ts
// src/types/rateLimit.d.ts
export interface RateLimitWindows {
  hourly:  number | null;   // requests per rolling 3600s
  daily:   number | null;   // 86400s
  weekly:  number | null;   // 604800s
  monthly: number | null;   // 2592000s
}

export interface RateLimitCheckResult {
  allowed: boolean;
  limitType?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  limit?: number;
  remaining?: number;
  resetAt?: Date;
  cooldownUntil?: Date;     // present when in cooldown
}

export type RateLimitEventType =
  | 'hit' | 'cooldown_started' | 'flagged' | 'cleared';
```

The `Plan.limits` field on Module 2's frozen snapshot already has this exact shape; no plan-shape extension is needed.

## File Structure

```
src/
├── config/
│   └── rateLimit.ts                     ← WINDOWS = [{key:'hourly', sec:3600}, …], `COOLDOWN_DURATION_SEC`, `FLAG_TRIGGER`, `isSkipped`, key helpers
├── gateway/
│   └── rateLimit.middleware.ts          ← Pipeline slot 10 (after the swap with Module 4). Calls service + sets headers.
├── services/
│   └── rateLimit.service.ts             ← checkAndRecord(userId, plan): RateLimitCheckResult, applyCooldown, isInCooldown, clear(userId), flag(userId)
├── routes/
│   └── admin/
│       └── ratelimits.routes.ts         ← /api/v1/admin/ratelimits/*
├── controllers/
│   └── admin/
│       └── ratelimits.controller.ts
├── events/
│   └── rateLimit.events.ts              ← typed emitter
└── db/
    └── migrations/
        └── 016_rate_limit_events.sql    ← (already specified in LAYER2 §15; create it here)
```

No user routes. No new tables beyond `rate_limit_events`.

## Plan-Shape Extension (touches Module 2)

None. `Plan.limits` already exposes the four windows. If a plan was created before Module 5 lands and is missing one of the keys, the middleware treats it as `null` (unlimited) for that window and logs a `WARN rate_limit_window_undefined`.

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | `req.user.id` |
| Module 2 — Plan & Subscription | `req.plan.limits` |
| `src/infra/redis.ts` | Sorted sets via `ZADD/ZREMRANGEBYSCORE/ZCARD` + `EXPIRE` |
| `src/infra/postgres.ts` | `rate_limit_events` audit writes (fire-and-forget; never blocks the request) |
| `src/utils/{response,errors,logger}.ts` | Envelope, `AppError`, structured logs |

## Modules That Will Use Module 5

| Downstream module | Where it integrates |
|---|---|
| Every authed route | Implicitly — `rateLimitMiddleware` is global, slot 10. |
| Module 4 — Credit Wallet | Runs **after** Module 5 (post-swap) so denied requests don't open pending holds. |
| Module 7 — Message Queue | Consumes `Retry-After` from the denial envelope when scheduling user-facing retries. |
| Module 1 — Admin notifications | Subscribes to `ratelimit.flagged` to push admin alerts. |
