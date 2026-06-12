# 01 — Overview

## Mission

Module 6 is the **observability spine**. After every LLM call, it captures who called what, with which model, how many tokens, how many credits, how long it took, what features ran, what cached, and whether it succeeded. Users see a usage summary on their account page; finance and engineering see system-wide costs, cache hit rates, model distribution, and error rates from the admin dashboards.

It writes one row per call into `usage_records` and pre-computes daily/hourly rollups so the dashboards never scan the fact table.

## Scope

### In scope
- `usage_records` fact table + write API (`usageTracker.service.ts`)
- Three rollup tables + the worker that fills them:
  - `usage_daily_user(user_id, day, total_requests, success_rate, credits_spent, tokens_used, top_agents, top_models, avg_response_ms)`
  - `usage_daily_plan(plan_id, day, active_subs, avg_credits_per_user, feature_usage)`
  - `usage_hourly_system(hour, cache_hit_rate, provider_success_rate, p50, p95, p99, avg_cost_per_request)`
- 2 user routes: `GET /usage/summary`, `GET /usage/history`
- 6 admin routes under `/admin/analytics/*` (overview, users, models, costs, errors, ratelimits)
- 90-day hot retention; older rows archived to a cold table or S3 dump (out of scope today, hook reserved)

### Out of scope
- Sending data to a third-party analytics SaaS (no events leave the box)
- BI tooling (Metabase / Superset can query Postgres directly when needed)
- Per-message billing PDFs (financial export — separate module later)
- Realtime streaming dashboards (5-min lag is intentional)

## Inputs

| Source | What it carries |
|---|---|
| Module 7's chat worker | `recordUsage(args)` — full breakdown after every LLM call |
| Module 4's `wallet.deducted` event | Credits actually deducted, signed; mirror into `usage_records.credits_deducted` |
| Module 5's `rate_limit_events` | Read only — used by `GET /admin/analytics/ratelimits` |
| `req.user.id` (user routes) | Reading own usage |
| `plan_id` (admin routes) | Filtering aggregates |

## Outputs

- Persisted: a `usage_records` row per LLM call; updated rollup rows on the next worker tick
- Emitted: `usage.recorded` `{ userId, modelId, agentSlug, creditsDeducted, status }` (consumed by future "anomaly detection" work; safe to ignore for now)
- HTTP: usage and analytics responses in the universal envelope

## Type Contract

The `UsageRecord` shape is already defined in [`LAYER2_API_GATEWAY.md` §8](../../LAYER2_API_GATEWAY.md). For convenience, here is the TS form Module 6 commits to:

```ts
// src/types/usage.d.ts
export interface UsageRecord {
  id: string;

  // Identity
  userId: string;
  conversationId: string;
  messageId: string;
  jobId: string | null;

  // Source
  platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
  clientVersion: string | null;
  ipHash: string;                   // SHA-256(ip)/24 — never raw IP
  userAgent: string | null;

  // Agent & Model
  agentSlug: string;
  modelId: string;
  modelProvider: 'anthropic' | 'openai' | 'google' | string;

  // Token Usage
  inputTokensFresh: number;
  inputTokensCached: number;
  outputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;              // computed at write time

  // Credit Usage (mirror from Module 4)
  creditsDeducted: number;
  creditRate: number;
  agentMultiplier: number;
  planDiscount: number;
  walletBalanceBefore: number;
  walletBalanceAfter: number;

  // Cost
  actualCostUsd: number;            // what we paid the provider

  // Features Used
  webSearchUsed: boolean;
  webSearchEngine: string | null;
  webSearchCount: number;
  fileUploadUsed: boolean;
  codeExecutionUsed: boolean;
  codeExecutionCount: number;
  voiceModeUsed: boolean;

  // Cache
  cacheHitLayer: 'semantic' | 'prompt' | 'none';
  semanticCacheHit: boolean;

  // Performance
  routerLatencyMs: number;
  llmFirstTokenMs: number;
  llmTotalMs: number;
  totalRequestMs: number;

  // Outcome
  status: 'success' | 'failed' | 'cancelled' | 'timeout';
  errorCode: string | null;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error' | null;

  createdAt: string;
}
```

## Plan-Shape Extension (touches Module 2)

None.

## File Structure

```
src/
├── services/
│   ├── usageTracker.service.ts        ← record(args) → INSERT one row, emit usage.recorded
│   └── analytics.service.ts            ← read-only queries against rollup tables
├── workers/
│   ├── usage.rollup.worker.ts          ← repeatable job; runs every 5 min for hourly, every 30 min for daily
│   └── usage.cleanup.worker.ts         ← daily; archives rows older than 90 days
├── routes/
│   ├── user/
│   │   └── usage.routes.ts             ← /api/v1/usage/*
│   └── admin/
│       └── analytics.routes.ts         ← /api/v1/admin/analytics/*
├── controllers/
│   ├── user/
│   │   └── usage.controller.ts
│   └── admin/
│       └── analytics.controller.ts
├── events/
│   └── usage.events.ts                 ← typed emitter
└── db/
    └── migrations/
        ├── 017_usage_records.sql       ← already drafted in LAYER2 §15; add proper indexes
        ├── 018_usage_daily_user.sql
        ├── 019_usage_daily_plan.sql
        └── 020_usage_hourly_system.sql
```

No middleware. Module 6 lives off the request hot path entirely.

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | `req.user.id` for user routes |
| Module 2 — Plan & Subscription | `plan_id` joined into aggregates; current-period boundaries for `GET /usage/summary` |
| Module 4 — Credit Wallet | Source of truth for `credits_deducted`; Module 6 mirrors but does not recompute |
| Module 5 — Rate Limiting | Read-only joins on `rate_limit_events` for the `analytics/ratelimits` admin dashboard |
| Module 7 — Message Queue | Single writer for `usage_records`; calls `usageTracker.record()` after every LLM call |
| `src/infra/postgres.ts` | Heavy reader for analytics; uses prepared statements for hot dashboard queries |
| `src/utils/{response,errors,logger}.ts` | Standard envelope, `AppError`, structured logs |

## Modules That Will Use Module 6

| Downstream module | How |
|---|---|
| Module 7 — chat worker | Calls `usageTracker.record()` once per LLM call; payload includes everything in [02_USAGE_RECORDS_AND_AGGREGATES.md §A](02_USAGE_RECORDS_AND_AGGREGATES.md). |
| Admin dashboard (frontend) | Calls all six `/admin/analytics/*` routes. |
| User account page (frontend) | Calls `/usage/summary` (current period totals) and `/usage/history` (last 30 days per-day chart). |
