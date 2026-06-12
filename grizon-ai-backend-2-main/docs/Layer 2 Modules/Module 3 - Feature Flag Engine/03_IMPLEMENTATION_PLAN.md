# 03 — Implementation Plan

Concrete, ordered build plan for Module 3. Assumes Module 1 is shipped and Module 2 is at least partially implemented (the `Plan` type and `req.plan` middleware exist). If Module 2 is not yet wired, ship its `req.plan` injection first — Module 3 has no value without it.

## Files to Create

| Path | Purpose |
|---|---|
| `src/types/feature.d.ts` | `FeatureFlags`, `FeatureLimits`, `FeatureName`, `FeatureWindow` |
| `src/config/features.ts` | `FEATURE_NAMES` const array; `WINDOW_CONFIG` (per-feature TTL + key prefix); `keyFor(feature, window, userId)`; `headerNamesFor(feature, window)` |
| `src/services/featureLimit.service.ts` | `checkAndIncrement(userId, feature)`: returns `{ allowed: true, headers } \| { allowed: false, denial: { window, limit, used, resetAt } }`. Encapsulates Redis access; pure-data return so middleware stays thin. |
| `src/gateway/requireFeature.ts` | Factory: `requireFeature(flag) → RequestHandler` |
| `src/gateway/requireFeatureWithLimit.ts` | Factory: `requireFeatureWithLimit(feature) → RequestHandler` |
| `src/db/migrations/013_plans_feature_limits.sql` | `ALTER TABLE plans ADD COLUMN feature_limits JSONB NOT NULL DEFAULT '{}'`; backfill update for FREE plan to set `{"webSearch":null,"codeExecution":null}` |

## Files to Modify

| Path | Change |
|---|---|
| `src/gateway/featureFlag.middleware.ts` | Keep as no-op pass-through. Add a one-line JSDoc explaining its slot is reserved. **Do not delete** — documented pipeline order matters. |
| `src/types/plan.d.ts` (Module 2) | Add `featureLimits?: FeatureLimits` to `Plan` interface. Import `FeatureLimits` from `feature.d.ts`. |
| `src/services/plan.service.ts` (Module 2) | Extend the Zod schema for `createPlan` and `updatePlan` to accept `featureLimits` (optional). On read, hydrate from `plans.feature_limits`. Snapshot freezing on `subscription.service.upgradeSubscription` automatically picks up the new field because it serialises the whole row. |
| `src/db/migrations/012_seed_free_plan.sql` (Module 2) | Add `'{"webSearch":null,"codeExecution":null}'::jsonb` for the FREE seed's `feature_limits`. If 012 has already been applied in dev, migration 013 backfills it via `UPDATE plans SET feature_limits = ... WHERE id = 'plan_free_v1'`. |
| `src/utils/errors.ts` | Add `Errors.featureNotAvailable(feature)` → 403 / `FEATURE_NOT_AVAILABLE` and `Errors.featureLimitExceeded(details)` → 429 / `FEATURE_LIMIT_EXCEEDED`. |
| `docs/LLM_NEW_MODULE_PROMPT.md` | No Postman group changes (Module 3 owns no routes). Add a one-line entry under "Current API Mounts" noting Module 3 contributes per-route middleware only. |

## Reused Utilities (do not re-implement)

- `src/infra/redis.ts` — `getRedisClient()` (already fail-fast with 1.5s timeout)
- `src/utils/response.ts` — `fail()` for the error envelopes
- `src/utils/errors.ts` — `AppError` class
- `src/utils/logger.ts` — for the `feature_limit_redis_unavailable` WARN

## Implementation Order

1. **Migration 013** — add `feature_limits` column; backfill FREE plan; verify with `psql \\d plans`.
2. **Types** (`src/types/feature.d.ts`) — defines the contract every other file imports.
3. **Module 2 type extension** — add `featureLimits?` to `Plan`. TypeScript compile-pass before touching any logic.
4. **Module 2 plan.service Zod schema** — accept and persist `featureLimits`.
5. **`config/features.ts`** — pure data + helpers. No I/O.
6. **`services/featureLimit.service.ts`** — `checkAndIncrement` with Redis. Treat Redis-down as `{ allowed: true, headers: [], degraded: true }`; the middleware decides what to log.
7. **Error helpers** — add the two new `Errors.*` factories.
8. **`requireFeature.ts`** — trivial; ship with unit test that asserts 500/403/next based on `req.plan`.
9. **`requireFeatureWithLimit.ts`** — wires service + headers + error envelopes.
10. **Tests** — see below.
11. **Update Module 2 status report and Module 3 status notes** in `MODULE2_STATUS_REPORT.md` and `README.md` here.

## Tests

| File | Coverage |
|---|---|
| `test/unit/services/featureLimit.service.test.ts` | First call (allows + sets TTL), at-limit (denies, returns resetAt), unlimited window (passes without INCR), Redis-down (returns `{ allowed: true, degraded: true }`) |
| `test/unit/gateway/requireFeature.test.ts` | `req.plan` missing → 500; flag false → 403; flag true → next() |
| `test/unit/gateway/requireFeatureWithLimit.test.ts` | flag-off → 403; null limits → 403; pass with headers; 429 with reset; degraded fail-open |
| `test/integration/middleware/feature.middleware.test.ts` | Mounted on a stub route via `requireFeatureWithLimit('webSearch')`; uses real Redis (test container) to assert counter increments and 429 firing on the (limit+1)-th call |

Use the existing test scaffold pattern from `test/unit/services/auth.service.test.ts` and `test/integration/`. Reuse `test/helpers/request.ts` if present; otherwise mirror Module 1's setup.

## Verification

After implementing, run:

```
npm run migrate                           # apply 013
npm run build                              # TypeScript compile must pass
npm test -- test/unit/services/featureLimit.service.test.ts
npm test -- test/unit/gateway/requireFeature.test.ts
npm test -- test/unit/gateway/requireFeatureWithLimit.test.ts
npm test -- test/integration/middleware/feature.middleware.test.ts
```

Manual smoke (once a consumer route exists, e.g. `/search`):

1. As a FREE user, hit `/search` → expect `403 FEATURE_NOT_AVAILABLE` with `details.feature='webSearch'`.
2. Admin creates `plan_starter_v1` with `featureFlags.webSearch=true` and `featureLimits.webSearch={dailyLimit:3, monthlyLimit:10}`. User upgrades.
3. Hit `/search` 3 times → all 200, headers show `Remaining: 2 → 1 → 0`.
4. 4th call → `429 FEATURE_LIMIT_EXCEEDED` with `window: 'daily'`, `resetAt` ≈ now + 24h.
5. `redis-cli DEL feature:websearch:daily:<userId>` → next call passes again (used to confirm the key shape).
6. With Redis stopped → call still passes; check logs for `feature_limit_redis_unavailable`.

## Risks / Notes

- **Counter drift on Redis flush:** documented in [02_MIDDLEWARE_AND_LIMITS.md](02_MIDDLEWARE_AND_LIMITS.md). Acceptable today.
- **Race-condition over-count:** documented; bounded by per-user concurrency. Swap to Lua `EVAL` if/when product needs strict caps.
- **Calendar alignment:** first-use TTL is intentional. If product later wants "resets at midnight UTC", change `WINDOW_CONFIG` and add a key-naming scheme like `feature:websearch:daily:{userId}:2026-05-03`. No middleware-shape change.
- **Module 2 dependency:** if `featureLimits` is missing from a plan snapshot (older subscriptions taken before migration 013), `plan.featureLimits?.[feature]` is `undefined`, which `requireFeatureWithLimit` treats as **flag-only** (no usage cap). This is the safe default for legacy snapshots. Document this in the snapshot-evolution section of Module 2 if needed.
- **No admin UI:** flags and limits are set on the `Plan` row by Module 2's existing admin endpoints. No Module 3 routes are required.
