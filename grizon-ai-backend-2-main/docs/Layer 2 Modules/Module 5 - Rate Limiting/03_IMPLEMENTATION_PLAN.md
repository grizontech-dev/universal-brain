# 03 — Implementation Plan

Concrete, ordered build for Module 5. Assumes Module 1 is shipped and Module 2's `req.plan.limits` is populated. The middleware pipeline is already locked with `rateLimitMiddleware` at slot 10 (before credit budget at slot 11) — see [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md). Module 5 replaces the slot-10 stub with the real implementation; no reorder.

## Files to Create

| Path | Purpose |
|---|---|
| `src/types/rateLimit.d.ts` | `RateLimitWindows`, `RateLimitCheckResult`, `RateLimitEventType` |
| `src/config/rateLimit.ts` | `WINDOWS = [{key:'hourly',sec:3600}, …]`, `COOLDOWN_DURATION_SEC`, `FLAG_TRIGGER = {count, withinSec}`, `SKIP_ROUTES` equivalents (`SKIP_EXACT`, `SKIP_PREFIXES`). Helpers: `keyFor(window, userId)`, `headerNamesFor(window)`, `isSkipped(method, path)`. |
| `src/services/rateLimit.service.ts` | `checkAndRecord(userId, plan)` (sliding window via pipeline), `applyCooldown(userId, durationSec, reason)`, `isInCooldown(userId)`, `clear(userId)`, `peek(userId)` (read-only for skipped routes), event-recording wrapper |
| `src/gateway/rateLimit.middleware.ts` | Replaces stub. Reads `req.plan`, calls service, sets headers, throws on deny. |
| `src/events/rateLimit.events.ts` | Typed emitter |
| `src/routes/admin/ratelimits.routes.ts` | 4 routes (5 with optional `flagged/:userId` PATCH) |
| `src/controllers/admin/ratelimits.controller.ts` | Thin handlers |
| `src/db/migrations/016_rate_limit_events.sql` | Already specified in `LAYER2_API_GATEWAY.md` §15. Add an index on `(user_id, created_at DESC)` and `(event_type, created_at DESC)`. |
| `test/unit/services/rateLimit.service.test.ts` | Allow path, window exhaustion (`RATE_LIMIT_EXCEEDED` path), active cooldown TTL denial, peek does not write |
| `test/integration/middleware/rateLimit.middleware.test.ts` | Mocked service: allowed vs `RATE_LIMIT_EXCEEDED` vs `RATE_LIMIT_COOLDOWN` |
| `test/integration/routes/ratelimits.admin.routes.test.ts` | All admin routes + RBAC |

## Files to Modify

| Path | Change |
|---|---|
| `src/app.ts` | The pipeline already places `rateLimitMiddleware` at slot 10. Module 5 only **replaces the slot-10 stub** with the real implementation; no reorder. |
| `src/routes/admin/index.ts` | `adminRoutes.use('/ratelimits', adminRatelimitsRoutes)` |
| `src/utils/errors.ts` | Add `Errors.rateLimited(details)` → 429 / `RATE_LIMIT_EXCEEDED` and `Errors.rateLimitCooldown(details)` → 429 / `RATE_LIMIT_COOLDOWN`. `Errors.reasonRequired()` may already exist (Module 4) — reuse. |
| `docs/LLM_NEW_MODULE_PROMPT.md` | Add Postman group `Module 5 - Admin RateLimit Contracts` under "Postman groups currently include". (Middleware order is already locked in this doc.) |
| `grizon-ai-backend-2.postman_collection.json` | Add the admin group with 4–5 requests. |

## Reused Utilities (do not re-implement)

- `src/infra/redis.ts` → `getRedisClient()`; use pipelines for atomic check-or-record
- `src/infra/postgres.ts` → fire-and-forget audit inserts (don't await on the request hot path)
- `src/utils/response.ts`, `src/utils/errors.ts`, `src/utils/logger.ts`
- Module 1's `requireAdmin` for the admin route file

## Implementation Order

1. **Migration 016** — `rate_limit_events` table + indexes.
2. **Types + config** — pure data, no I/O.
3. **`rateLimit.service.ts`** — `checkAndRecord` using the two-pass flow (read windows, then `ZADD` on allow). No `ratelimit:hits:*` or automatic cooldown.
4. **Flag trigger** — on each `applyCooldown`, insert `cooldown` then count last-24h cooldown rows; emit `flagged` when count ≥ `FLAG_TRIGGER.count`.
5. **Middleware** — replaces the slot-10 stub. Wires service + headers + skip-list. Skip list is read once at module load.
6. **Error helpers** — two new `Errors.*` factories.
7. **Admin routes + controllers** — `requireAdmin` per route. Audit row written on every action.
8. **Tests** — unit first (fast), integration after.
9. **Headers verification** — manually `curl -I` to confirm `X-RateLimit-*` on success and on deny.
10. **Postman + status report** — final.

## Verification

```bash
npm run migrate                                        # apply 016
npm run build                                          # TypeScript compile must pass
npm test -- test/unit/services/rateLimit.service.test.ts
npm test -- test/integration/middleware/rateLimit.middleware.test.ts
npm test -- test/integration/routes/ratelimits.admin.routes.test.ts
```

Manual smoke (FREE plan: hourly 10 / daily 50):

1. As FREE user, send 10 chat requests within an hour → all 200, headers count down `Remaining: 9 → 0`.
2. 11th request → `429 RATE_LIMIT_EXCEEDED` with `limitType:'hourly'`, `retryAfterSeconds` close to 3600. `X-RateLimit-Hourly-Remaining: 0`.
3. As admin, `POST /admin/ratelimits/<userId>/cooldown` → subsequent user requests return `429 RATE_LIMIT_COOLDOWN` until TTL expires or admin removes cooldown.
4. `redis-cli KEYS 'ratelimit:*'` to verify keys.
5. As admin, `POST /admin/ratelimits/<userId>/clear { reason: 'support cleared limits' }` → user can call again immediately.
6. Apply enough admin cooldowns in 24 h to exceed `FLAG_TRIGGER.count`; verify `rate_limit_events` has a `flagged` row and the admin notification fires (Module 1 emits).
7. Stop Redis. Hit any route → still 200, no headers, log line `rate_limit_redis_unavailable`.
8. Verify `X-RateLimit-Reset` is the unix timestamp closest to the **earliest** window's reset (because that's what the user will hit first).

## Risks / Notes

- **Sliding-set memory:** Pro plan's `monthly_limit = 20000` × ~32 bytes ≈ 640 KB per user. At 10K active monthly users, that's ~6 GB Redis. Plan accordingly; Enterprise unlimited monthly is `null` → no key, no memory.
- **Cooldown via plan-only field?** Some teams prefer storing cooldown duration on the plan. We store it in `config/rateLimit.ts` for now; if product needs per-plan cooldowns, move it to `Plan.cooldownPolicy` later (no schema change to `plans` because `feature_flags` is a free-form JSONB).
- **`peek` cost on every skipped GET:** four `ZCARD` calls per request. Cheap but not free. If `/auth/me` becomes the hottest route, cache the result for 1 s in Redis under `ratelimit:peek:{userId}`. Document only if profiling demands it.
- **Calendar alignment:** product may later want "monthly resets at the 1st" semantics. Sliding-window stays preferred (no boundary abuse), but if forced, change `windowSec` to `secondsUntilEndOfMonth` and rebuild keys daily. Significant work — do not touch unless asked.
- **`rate_limit_events` writes on the hot path:** do them in a `setImmediate(() => insert(...))` or via a tiny BullMQ queue. Never `await` the audit insert before responding.
- **Coordination with Module 1 ban cascade:** when admin escalates a flagged user to ban, Module 1's `ban` cascade revokes all sessions; the user's next request will 401, not 429. Document this in [Module 1's flows](../Module%201%20-%20Auth%20and%20Identity/07_FLOWS.md) if not already.
