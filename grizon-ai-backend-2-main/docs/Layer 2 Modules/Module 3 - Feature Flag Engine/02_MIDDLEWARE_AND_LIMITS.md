# 02 — Middleware Contracts, Limits, Errors

Two middleware factories make up Module 3's entire public API. Both run **after** `planMiddleware` and rely on `req.plan` being populated.

---

## A. `requireFeature(flag)`

**File:** `src/gateway/requireFeature.ts`

Binary on/off check. No Redis, no counters. Suitable for cheap features (model picker, temperature control, custom system prompt, file upload toggle, etc.).

```ts
export const requireFeature = (flag: keyof FeatureFlags): RequestHandler => {
  return (req, _res, next) => {
    if (!req.plan) {
      return next(Errors.internal('plan_not_loaded'));   // 500; programming bug
    }
    if (!req.plan.featureFlags[flag]) {
      return next(Errors.featureNotAvailable(flag));     // 403
    }
    next();
  };
};
```

### Error envelope (403)

```json
{
  "success": false,
  "message": "webSearch is not available on your current plan.",
  "error": {
    "code": "FEATURE_NOT_AVAILABLE",
    "details": {
      "feature": "webSearch",
      "upgradeUrl": "/pricing"
    }
  },
  "meta": { "request_id": "req_..." }
}
```

The `upgradeUrl` value is plan-agnostic — frontends route the user from there. Module 3 never embeds a target plan id (decoupled from Module 2's catalog).

---

## B. `requireFeatureWithLimit(feature)`

**File:** `src/gateway/requireFeatureWithLimit.ts`

For `'webSearch'` and `'codeExecution'` only (today). Runs the binary check, then enforces per-window usage caps via Redis INCR.

### Behaviour

```
1. Verify req.plan present                    → 500 if not
2. If !plan.featureFlags[feature]             → 403 FEATURE_NOT_AVAILABLE
3. limits = plan.featureLimits?.[feature]
   if limits === null                         → 403 FEATURE_NOT_AVAILABLE
                                                 (treated same as flag-off)
4. windows = windowsFor(feature, userId)      // see Window Definitions below
5. For each window with limit !== null:
     used = parseInt(redis.GET(window.key) ?? '0', 10)
     if used >= window.limit                  → 429 FEATURE_LIMIT_EXCEEDED
                                                 (set X-Feature-* headers)
6. All windows passed:
     pipeline INCR + EXPIRE for every counted window
     await pipeline.exec()
7. Compute remaining for each window, set response headers
8. next()
```

### Window Definitions

| Feature | Window | Redis key | TTL (s) |
|---|---|---|---|
| `webSearch` | daily | `feature:websearch:daily:{userId}` | `86400` |
| `webSearch` | monthly | `feature:websearch:monthly:{userId}` | `2592000` |
| `codeExecution` | hourly | `feature:codeexec:hourly:{userId}` | `3600` |
| `codeExecution` | daily | `feature:codeexec:daily:{userId}` | `86400` |

Keys are built by `keyFor(feature, window, userId)` in `services/featureLimit.service.ts`. The TTL is set on first INCR (when `EXISTS` returns 0); subsequent INCRs do not reset it. This is the intended sliding-cap behaviour — counters expire after the window measured from first use.

> **Why first-use TTL, not calendar-aligned?** Calendar alignment requires a cron or scheduled flush. First-use TTL needs zero infrastructure beyond Redis and gives a predictable user experience ("you have N for the next 24h"). Calendar alignment can replace this when the renewal cron lands with Module 4.

### 429 Error envelope

```json
{
  "success": false,
  "message": "Daily webSearch limit reached.",
  "error": {
    "code": "FEATURE_LIMIT_EXCEEDED",
    "details": {
      "feature": "webSearch",
      "window": "daily",
      "limit": 20,
      "used": 20,
      "resetAt": "2026-05-04T08:31:00.000Z",
      "upgradeUrl": "/pricing"
    }
  },
  "meta": { "request_id": "req_..." }
}
```

`resetAt` is computed as `now + ttlRemaining` where `ttlRemaining = redis.TTL(key)` at the moment of denial.

### Response headers (success path)

After a successful pass-through, the middleware sets one pair of headers per window with a numeric limit:

```
X-Feature-WebSearch-Daily-Limit:       20
X-Feature-WebSearch-Daily-Remaining:   14
X-Feature-WebSearch-Monthly-Limit:     200
X-Feature-WebSearch-Monthly-Remaining: 194
X-Feature-CodeExec-Hourly-Limit:       10
X-Feature-CodeExec-Hourly-Remaining:   8
X-Feature-CodeExec-Daily-Limit:        50
X-Feature-CodeExec-Daily-Remaining:    47
```

Unlimited windows (`limit === null`) do not emit headers.

### Atomicity & race conditions

The check-then-increment is **not atomic**. Two simultaneous requests that read `used = limit - 1` will both pass and then both INCR. Result: counter goes one over the cap occasionally.

This is an acceptable trade-off:
- The over-count is bounded by request concurrency for a single user (typically ≤ 5)
- Going strictly atomic requires a Lua script (`EVAL`) which complicates ops for tiny benefit
- A user one over their cap is detected on the *next* request and denied

If product later requires strict caps (e.g. enterprise SLA), swap `checkAndIncrement` for an `EVAL` script that does `GET → compare → INCR → EXPIRE` in one round-trip. Same module, same key layout, no other changes required.

### Redis-down behaviour

`getRedisClient()` is fail-fast (1.5s timeout). If Redis is unavailable:

- The middleware **logs WARN** (`feature_limit_redis_unavailable`) and **fails open** — the request is allowed, no counter is incremented, no headers set.
- A `feature.limit.degraded` metric is incremented (when the metrics module lands).
- Rationale: feature limits are a soft guard; blocking all paid users because Redis blinked is worse than letting a few extra free queries through. Hard caps live in the wallet (Module 4) and rate limit (Module 5), not here.

This mirrors how `auth.middleware` already handles Redis-down on the JTI blacklist (Postgres mirror keeps the strict path).

---

## Error Code Reference (Module 3)

| Code | HTTP | Source | Meaning |
|---|---|---|---|
| `FEATURE_NOT_AVAILABLE` | 403 | `requireFeature`, `requireFeatureWithLimit` | The flag is `false` on the user's plan, OR `featureLimits[feature] === null` |
| `FEATURE_LIMIT_EXCEEDED` | 429 | `requireFeatureWithLimit` | Counter hit the window cap |

Both codes are added to `src/utils/errors.ts` as `Errors.featureNotAvailable(feature)` and `Errors.featureLimitExceeded({ feature, window, limit, used, resetAt })`.

---

## Security Notes

| Concern | Mitigation |
|---|---|
| User forges `req.plan` to bypass | Impossible — `req.plan` is server-set by Module 2's middleware from the frozen snapshot in the DB. Request body is never read. |
| Counter bypass via key forgery | Keys are built server-side from `req.user.id` (set by Module 1). Clients cannot influence the key. |
| Counter inflation by another user | Keys are user-scoped; one user's INCRs only affect their own bucket. |
| Redis flush erases counters | A single flush gives every user a free window. Acceptable; mirrors how auth's JTI blacklist behaves. |
| Header leakage in error responses | `X-Feature-*-Remaining` headers are set on success only; on 429 they communicate `0` but no other user's data is exposed. |
| Per-flag enumeration via timing | Both 403 paths (`!plan.featureFlags[flag]` vs `featureLimits[feature] === null`) return the same error code. Differentiation lives only in the `details.feature` field, which the user already knows. |

---

## Pipeline Position

Module 3's pipeline slot stays where the stub already is in `src/app.ts:28`:

```
... → planMiddleware (Module 2) → featureFlagMiddleware (Module 3, no-op global) → ...
```

Per-route wrappers (`requireFeature`, `requireFeatureWithLimit`) attach **inside** the route file, after the global pipeline:

```ts
// Example consumer (lives in another module's route file):
router.post(
  '/search',
  requireFeatureWithLimit('webSearch'),
  searchController.handle,
);
```

The global `featureFlagMiddleware` stub is kept (rather than removed) so the documented pipeline order in [`docs/PROJECT_ARCHITECTURE.md`](../../PROJECT_ARCHITECTURE.md) and [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md) remains stable for future per-request work (e.g. injecting a typed `req.features` helper).
