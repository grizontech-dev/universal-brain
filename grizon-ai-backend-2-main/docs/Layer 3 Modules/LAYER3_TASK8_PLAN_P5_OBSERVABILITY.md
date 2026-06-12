# Layer 3 Task 8 — P5: Observability Gaps
## Implementation Plan

> **Priority:** P5 — Operational visibility; no user-facing features blocked  
> **Depends on:** P1, P3 (provider health integrated)  
> **Last Updated:** 2026-05-09

---

## Table of Contents
1. [Overview](#1-overview)
2. [5.1 Cache ROI Admin Endpoint](#2-51-cache-roi-admin-endpoint)
3. [5.2 Live Provider & Agent Metrics Counters](#3-52-live-provider--agent-metrics-counters)
4. [5.3 Admin System Health — Provider Status](#4-53-admin-system-health--provider-status)
5. [Files Changed / Created](#5-files-changed--created)

---

## 1. Overview

Two confirmed observability gaps from the audit:

| Gap | Current State | Target |
|---|---|---|
| `GET /admin/costs/cache-roi` | Listed in spec; not found in analytics routes | Implemented endpoint returning semantic + prompt cache savings |
| Live metrics Redis counters | `usageTracker` writes daily rollups only; provider/cache counters not written | Counters written on each event, readable by admin endpoints |

Additionally, the existing `GET /admin/system/health` endpoint needs provider health status wired in (depends on P3 health monitor).

---

## 2. 5.1 Cache ROI Admin Endpoint

### Route
`GET /api/v1/admin/analytics/costs/cache-roi`

**File:** `src/routes/admin/analytics.routes.ts` — add route  
**File:** `src/controllers/admin/analytics.controller.ts` — add handler  
**File:** `src/services/analytics.service.ts` — add query

### Query logic

The ROI calculation compares:
1. **Semantic cache savings**: credits NOT deducted when semantic cache hit (charged at 5% of normal)  
   Source: `semantic_cache_hits` table — `saved_credits` column
2. **Prompt cache savings**: tokens served from provider cache at 10% cost (Anthropic) vs full price  
   Source: `api_calls` table — `input_cached` column × (full_rate - cached_rate)
3. **Total wall-clock**: date range query (default: last 30 days)

```typescript
// analytics.service.ts — new method
async getCacheRoi(params: { from: Date; to: Date }) {
  // 1. Semantic cache savings
  const semanticResult = await pool.query(`
    SELECT
      COUNT(*)::int                  AS semantic_hits,
      COALESCE(SUM(saved_credits), 0) AS semantic_credits_saved
    FROM semantic_cache_hits
    WHERE created_at BETWEEN $1 AND $2
  `, [params.from, params.to]);

  // 2. Prompt cache savings
  // Anthropic: cached tokens billed at 10% → saving = input_cached × (full_rate × 0.90)
  // OpenAI: cached tokens billed at 50% → saving = input_cached × (full_rate × 0.50)
  const promptResult = await pool.query(`
    SELECT
      provider,
      SUM(input_cached)::int                                AS cached_tokens,
      SUM(
        CASE provider
          WHEN 'anthropic' THEN input_cached * 0.90 * (cost_usd_billed_to_us / NULLIF(input_fresh + output, 0))
          WHEN 'openai'    THEN input_cached * 0.50 * (cost_usd_billed_to_us / NULLIF(input_fresh + output, 0))
          ELSE 0
        END
      )                                                     AS estimated_usd_saved
    FROM api_calls
    WHERE created_at BETWEEN $1 AND $2
      AND input_cached > 0
    GROUP BY provider
  `, [params.from, params.to]);

  // 3. Total spend in period
  const totalResult = await pool.query(`
    SELECT
      COALESCE(SUM(cost_usd_billed_to_us), 0) AS total_usd_spent
    FROM api_calls
    WHERE created_at BETWEEN $1 AND $2
  `, [params.from, params.to]);

  const semanticHits = semanticResult.rows[0].semantic_hits;
  const semanticSaved = parseFloat(semanticResult.rows[0].semantic_credits_saved);
  const promptUsdSaved = promptResult.rows.reduce((acc: number, r: any) => acc + parseFloat(r.estimated_usd_saved ?? 0), 0);
  const totalUsdSpent = parseFloat(totalResult.rows[0].total_usd_spent);

  return {
    period: { from: params.from, to: params.to },
    semantic: {
      hits: semanticHits,
      creditsSaved: semanticSaved,
    },
    promptCache: {
      cachedTokens: promptResult.rows.reduce((a: number, r: any) => a + parseInt(r.cached_tokens ?? 0), 0),
      estimatedUsdSaved: promptUsdSaved,
      byProvider: promptResult.rows,
    },
    summary: {
      totalUsdSpent,
      totalUsdSaved: promptUsdSaved,
      savingsPercent: totalUsdSpent > 0 ? (promptUsdSaved / (totalUsdSpent + promptUsdSaved)) * 100 : 0,
    },
  };
}
```

### Controller
```typescript
// analytics.controller.ts
async getCacheRoi(req: Request, res: Response) {
  const days = parseInt(req.query.days as string ?? '30', 10);
  const to = new Date();
  const from = new Date(Date.now() - days * 86400_000);
  const data = await analyticsService.getCacheRoi({ from, to });
  return ok(res, data);
}
```

### Route registration
```typescript
// analytics.routes.ts
router.get('/costs/cache-roi', requireAdmin, analyticsController.getCacheRoi);
```

---

## 3. 5.2 Live Provider & Agent Metrics Counters

### Redis key design
```
metrics:cache:semantic:{YYYYMMDD}        INCR — semantic cache hits per day
metrics:cache:prompt:{YYYYMMDD}          INCR — requests with any prompt cache hit per day
metrics:provider:{name}:ok:{YYYYMMDD}    INCR — successful completions per provider per day
metrics:provider:{name}:err:{YYYYMMDD}   INCR — failed completions per provider per day
metrics:agent:{slug}:calls:{YYYYMMDD}    INCR — agent invocations per day
```

All keys use 48h TTL (Redis expires after 2 days — analytics reads from DB for longer periods).

### Where to write each counter

**`src/workers/chat.worker.ts`** — in the post-completion block (after usage is tracked):

```typescript
import { redis } from '../infra/redis';

const today = new Date().toISOString().slice(0, 10); // YYYYMMDD

// After semantic cache HIT:
await redis.incr(`metrics:cache:semantic:${today}`);
await redis.expire(`metrics:cache:semantic:${today}`, 172800);

// After successful stream completion:
await redis.incr(`metrics:provider:${decision.modelProvider}:ok:${today}`);
await redis.expire(`metrics:provider:${decision.modelProvider}:ok:${today}`, 172800);

// If inputTokensCached > 0 (prompt cache hit):
if (usage.inputTokensCached > 0) {
  await redis.incr(`metrics:cache:prompt:${today}`);
  await redis.expire(`metrics:cache:prompt:${today}`, 172800);
}

// Agent invocation:
await redis.incr(`metrics:agent:${decision.agentSlug}:calls:${today}`);
await redis.expire(`metrics:agent:${decision.agentSlug}:calls:${today}`, 172800);

// On provider error:
await redis.incr(`metrics:provider:${decision.modelProvider}:err:${today}`);
await redis.expire(`metrics:provider:${decision.modelProvider}:err:${today}`, 172800);
```

All `redis.incr` + `redis.expire` calls are wrapped in a try/catch — metrics are non-fatal.

### Admin endpoint to read live metrics

`GET /api/v1/admin/analytics/live`

```typescript
async getLiveMetrics(req: Request, res: Response) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

  const providers = ['anthropic', 'openai', 'google', 'deepseek', 'xai'];
  const agents = ['chat', 'writer', 'research', 'code', 'document', 'analyst', 'architect', 'debugger', 'ui', 'deep_research'];

  const [
    semanticToday, semanticYesterday,
    promptToday,
    ...providerValues
  ] = await redis.mget(
    `metrics:cache:semantic:${today}`,
    `metrics:cache:semantic:${yesterday}`,
    `metrics:cache:prompt:${today}`,
    ...providers.flatMap(p => [
      `metrics:provider:${p}:ok:${today}`,
      `metrics:provider:${p}:err:${today}`,
    ])
  );

  const agentValues = await redis.mget(
    ...agents.map(a => `metrics:agent:${a}:calls:${today}`)
  );

  return ok(res, {
    date: today,
    cache: {
      semanticHitsToday: parseInt(semanticToday ?? '0'),
      semanticHitsYesterday: parseInt(semanticYesterday ?? '0'),
      promptCacheHitsToday: parseInt(promptToday ?? '0'),
    },
    providers: providers.map((p, i) => ({
      id: p,
      successesToday: parseInt(providerValues[i * 2] ?? '0'),
      errorsToday: parseInt(providerValues[i * 2 + 1] ?? '0'),
    })),
    agents: agents.map((a, i) => ({
      slug: a,
      callsToday: parseInt(agentValues[i] ?? '0'),
    })),
  });
}
```

Route: `GET /api/v1/admin/analytics/live` — add to `analytics.routes.ts`

---

## 4. 5.3 Admin System Health — Provider Status

**File:** `src/controllers/admin/system.controller.ts`

Add provider health from the `ProviderHealthMonitor` singleton (created in P3):

```typescript
import { providerHealth } from '../../models/health';

// In the health endpoint handler:
const providerStatuses = ['anthropic', 'openai', 'google', 'deepseek', 'xai'].map(id => ({
  id,
  status: providerHealth.getStatus(id),
}));

// Add to response:
return ok(res, {
  // ...existing postgres, redis, bullmq checks...
  providers: providerStatuses,
});
```

---

## 5. Files Changed / Created

| File | Action |
|---|---|
| `src/services/analytics.service.ts` | **Modify** — add `getCacheRoi()` method |
| `src/controllers/admin/analytics.controller.ts` | **Modify** — add `getCacheRoi` handler |
| `src/routes/admin/analytics.routes.ts` | **Modify** — add `/costs/cache-roi` and `/live` routes |
| `src/workers/chat.worker.ts` | **Modify** — write Redis metrics counters on completion |
| `src/controllers/admin/system.controller.ts` | **Modify** — expose provider health statuses |
