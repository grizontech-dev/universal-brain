# 01 — Overview

## Mission

Module 3 turns a user's plan into **feature-level access control**. It exposes two middleware factories that route handlers wrap themselves in:

- `requireFeature(flag)` — binary on/off check against `req.plan.featureFlags[flag]`
- `requireFeatureWithLimit(feature)` — binary check **plus** a Redis-backed usage counter (per-user, per-window) for expensive features

Module 3 owns no routes, no DB tables, and no business logic of its own. It is a thin authorization layer that sits between Module 2 (which populates `req.plan`) and downstream business modules (chat, search, code execution, document agents).

## Scope

### In scope
- `featureFlag.middleware.ts` — global no-op pass-through (no per-request work; it exists only to keep the pipeline slot)
- `requireFeature(flag)` factory — used per route
- `requireFeatureWithLimit(feature)` factory — used per route (today: `webSearch`, `codeExecution`)
- Redis counter management (INCR + EXPIRE) for feature usage windows
- Response headers for client-side awareness (`X-Feature-<Name>-<Window>-Limit/Remaining`)
- Type definitions: `FeatureFlags`, `FeatureLimits`
- Extension to the Module 2 `Plan` type so `featureLimits` lives alongside `featureFlags`

### Out of scope
- Feature *implementations* (chat, search, code-exec) — owned by their respective modules
- Plan creation/edit (Module 2)
- Wallet debits per feature (Module 4)
- Global request rate limits (Module 5)
- Admin override per user (no per-user feature-flag override; flags come exclusively from the plan snapshot)

## Inputs

| Source | What it carries |
|---|---|
| `req.plan` (set by Module 2's `planMiddleware`) | `featureFlags: Record<string, boolean>`, `featureLimits: FeatureLimits` (optional) |
| `req.user.id` (set by Module 1) | Used as the Redis counter bucket key |

If `req.plan` is missing on a route that uses these middleware, that's a programming bug — surfaced as `500 INTERNAL_ERROR`. Module 3 never falls back to a default plan.

## Outputs

- **Allow** → `next()`, with response headers added describing remaining quota for the windows checked
- **Deny (binary)** → `403 FEATURE_NOT_AVAILABLE` envelope with `upgradeUrl: '/pricing'`
- **Deny (limit)** → `429 FEATURE_LIMIT_EXCEEDED` envelope with `feature`, `window`, `limit`, `used`, `resetAt`, `upgradeUrl`

All responses use the universal envelope from [`Project Foundation/03_REQUEST_RESPONSE.md`](../../Project%20Foundation/03_REQUEST_RESPONSE.md).

## Type Contracts

```ts
// src/types/feature.d.ts
export interface FeatureFlags {
  // Search & Research
  webSearch: boolean;
  smartSynthesizer: boolean;
  deepResearch: boolean;
  // Document Handling
  fileUpload: boolean;
  documentCreation: boolean;
  documentAnalysis: boolean;
  // Code & Execution
  codeExecution: boolean;
  codeAgent: boolean;
  // UI & Artifacts
  htmlPreview: boolean;
  uiGenerator: boolean;
  artifactVersioning: boolean;
  // Power User
  modelPicker: boolean;
  customSystemPrompt: boolean;
  temperatureControl: boolean;
  // Memory
  longTermMemory: boolean;
  conversationSummary: boolean;
  // Voice
  voiceMode: boolean;
}

export interface FeatureLimits {
  webSearch: {
    dailyLimit:   number | null;   // null = unlimited
    monthlyLimit: number | null;
  } | null;                        // null = feature not available on plan
  codeExecution: {
    hourlyLimit: number | null;
    dailyLimit:  number | null;
  } | null;
}
```

`featureFlags` is a `Record<string, boolean>` at the DB/JSON level, but the TypeScript layer narrows reads to the keys above. Unknown keys default to `false`.

## Plan-Shape Extension (touches Module 2)

The `Plan` type defined by Module 2 (`src/types/plan.d.ts`) gains one new optional field:

```ts
interface Plan {
  // ... existing fields
  featureFlags: FeatureFlags;          // already present, narrowed type
  featureLimits?: FeatureLimits;       // NEW — null fields = unlimited or unavailable
}
```

The DB column `plans.feature_limits JSONB` will be added by **Module 3 migration 013** (not Module 2). The `Plan` zod schema in `plan.service` is extended in lockstep. Existing plan rows (FREE seed) backfill with all-`null` limits, which is correct because FREE has no quota-able features enabled.

## File Structure

```
src/
├── config/
│   └── features.ts                       ← FEATURE_NAMES (enum-like), default per-feature window TTLs, redis key builders
├── gateway/
│   ├── featureFlag.middleware.ts         ← Global no-op (kept for pipeline order)
│   ├── requireFeature.ts                 ← Factory: requireFeature(flag) → RequestHandler
│   └── requireFeatureWithLimit.ts        ← Factory: requireFeatureWithLimit(feature) → RequestHandler
├── services/
│   └── featureLimit.service.ts           ← Pure helpers: keyFor, ttlFor, checkAndIncrement(userId, feature)
├── types/
│   └── feature.d.ts                      ← FeatureFlags, FeatureLimits, FeatureName, FeatureWindow
└── db/
    └── migrations/
        └── 013_plans_feature_limits.sql  ← ALTER TABLE plans ADD COLUMN feature_limits JSONB NOT NULL DEFAULT '{}'
```

No routes, no controllers. Module 3's surface area = 2 middleware factories + 1 type file + 1 migration.

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | Reads `req.user.id` for counter bucket |
| Module 2 — Plan & Subscription | Reads `req.plan.featureFlags` and `req.plan.featureLimits` (frozen snapshot) |
| `src/infra/redis.ts` (`getRedisClient()`) | Counter INCR/EXPIRE; falls back to allow-with-warning if Redis unavailable (see [02_MIDDLEWARE_AND_LIMITS.md](02_MIDDLEWARE_AND_LIMITS.md)) |
| `src/utils/response.ts`, `src/utils/errors.ts` | Standard envelope + `AppError` |

Module 3 is read-only against the `plans` row (via `req.plan`). It performs no DB writes.

## Modules That Will Use Module 3

| Downstream module | Where they wrap |
|---|---|
| Chat / Conversation routes | `requireFeature('customSystemPrompt')`, `requireFeature('modelPicker')`, `requireFeature('temperatureControl')` |
| Search / Research routes | `requireFeatureWithLimit('webSearch')` |
| Code execution routes | `requireFeatureWithLimit('codeExecution')` |
| Document agent routes | `requireFeature('fileUpload')`, `requireFeature('documentCreation')`, `requireFeature('documentAnalysis')` |
| UI generator | `requireFeature('uiGenerator')`, `requireFeature('htmlPreview')` |
| Memory | `requireFeature('longTermMemory')`, `requireFeature('conversationSummary')` |
| Voice | `requireFeature('voiceMode')` |

These wrappers are added **inside the consuming module's route file** — Module 3 does not maintain a list of which routes use which flag.
