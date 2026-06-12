# 02 — Write Contract, Aggregates, Routes

How Module 7 writes into Module 6, how the rollups are computed, and every HTTP contract Module 6 exposes.

---

## A. Write API — `usageTracker.record(args)`

Single entry point. Called from `src/workers/chat.worker.ts` after the LLM responds and Module 4 has confirmed the deduction.

```ts
// src/services/usageTracker.service.ts
export interface RecordUsageArgs {
  userId: string;
  conversationId: string;
  messageId: string;
  jobId: string | null;

  platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
  clientVersion: string | null;
  ip: string;                          // hashed inside the service before INSERT
  userAgent: string | null;

  agentSlug: string;
  modelId: string;
  modelProvider: string;

  tokens: {
    inputFresh: number;
    inputCached: number;
    output: number;
    cacheWrite: number;
  };

  cost: {
    creditsDeducted: number;            // from Module 4's confirmDeduction
    creditRate: number;
    agentMultiplier: number;
    planDiscount: number;
    walletBalanceBefore: number;
    walletBalanceAfter: number;
    actualCostUsd: number;              // what we paid the provider, in cents-as-decimal
  };

  features: {
    webSearch:    boolean;
    webSearchEngine: string | null;
    webSearchCount: number;
    webFetchCount: number;
    toolCountTotal: number;
    fileUpload:   boolean;
    codeExecution: boolean;
    codeExecutionCount: number;
    voiceMode:    boolean;
  };

  cache: {
    layer: 'semantic' | 'prompt' | 'none';
    semanticHit: boolean;
  };

  timing: {
    routerMs: number;
    llmFirstTokenMs: number;
    llmTotalMs: number;
    totalRequestMs: number;
  };

  outcome: {
    status: 'success' | 'failed' | 'cancelled' | 'timeout';
    errorCode: string | null;
    finishReason: 'stop' | 'length' | 'content_filter' | 'error' | null;
  };
}

export async function record(args: RecordUsageArgs): Promise<void>;
```

Implementation rules:
- One `INSERT` per call. No transactions; Module 6 does not own balance state.
- IP is hashed via `sha256(ip + IP_HASH_SALT).slice(0, 16)` before INSERT.
- `total_tokens` is computed (`inputFresh + inputCached + output`) at write time and stored — saves every dashboard query a per-row sum.
- Failure to write must **not** raise to the worker. Wrap in `try { await pool.query(...) } catch (err) { logger.error('usage_record_write_failed', { err, userId, jobId }); }` so a logging blip does not fail the user's chat call.
- Emits `usage.recorded` after the INSERT succeeds.

The full insert column list mirrors [`LAYER2_API_GATEWAY.md` §15 `usage_records`](../../LAYER2_API_GATEWAY.md). Migration 017 in Module 6 owns the table; the LAYER2 doc is informational.

---

## B. Aggregations

Three rollup tables. All are append-or-update on `(scope_id, time_bucket)` via `INSERT … ON CONFLICT DO UPDATE`.

### `usage_hourly_system(hour, …)`

Fired every 5 minutes by `usage.rollup.worker.ts → rollupSystemHourly()`. Reads the last completed hour (or hours, if the worker fell behind) and writes:

```sql
hour                              TIMESTAMPTZ PRIMARY KEY      -- truncated to hour
total_requests                    INT
success_count                     INT
cache_hit_count_semantic          INT
cache_hit_count_prompt            INT
provider_success_count            JSONB                        -- { anthropic: N, openai: M, … }
provider_total_count              JSONB
p50_total_ms                      INT
p95_total_ms                      INT
p99_total_ms                      INT
avg_actual_cost_usd_per_request   NUMERIC
total_actual_cost_usd             NUMERIC
created_at                        TIMESTAMPTZ DEFAULT now()
updated_at                        TIMESTAMPTZ DEFAULT now()
```

### `usage_daily_user(user_id, day, …)`

Fired every 30 minutes by `rollupDailyUser()`. Composite PK `(user_id, day)`.

```sql
user_id                  UUID
day                      DATE
total_requests           INT
success_count            INT
total_credits_spent      INT
total_input_tokens       INT
total_output_tokens      INT
top_agents               JSONB                                  -- [{slug, count}] sorted desc, top 5
top_models               JSONB                                  -- same shape
avg_total_request_ms     INT
created_at               TIMESTAMPTZ DEFAULT now()
updated_at               TIMESTAMPTZ DEFAULT now()
PRIMARY KEY (user_id, day)
```

### `usage_daily_plan(plan_id, day, …)`

Fired by `rollupDailyPlan()` (every 30 min). Joins `usage_records` with the user's `subscription.plan_id` at row-write time.

```sql
plan_id                  UUID
day                      DATE
active_subscriber_count  INT                                    -- distinct user_id with status='active' on day
avg_credits_per_user     NUMERIC
feature_usage            JSONB                                  -- { webSearch: N, codeExecution: M, … } across the plan
churn_count              INT                                    -- subs that ended on this day
created_at               TIMESTAMPTZ DEFAULT now()
updated_at               TIMESTAMPTZ DEFAULT now()
PRIMARY KEY (plan_id, day)
```

> **Why pre-compute?** Live aggregates over `usage_records` for "system overview, last 24 h" tank dashboard latency once the table grows past a few million rows. Pre-rolled hourly + daily keeps the dashboards under 100 ms even at scale. The 5-minute / 30-minute lag is acceptable; anything urgent goes through SSE on the chat path.

### Idempotency

Each rollup query reads `usage_records` filtered by `created_at` in the bucket and writes via `INSERT … ON CONFLICT (pk) DO UPDATE SET … = EXCLUDED. …`. Re-running the worker over the same window produces the same numbers — the worker is safe to crash and resume.

---

## C. User API Routes

Base: `/api/v1/usage`. Bearer JWT required. Postman group: **Module 6 - User Usage Contracts**.

### `GET /usage/summary`

Current billing period totals (start = subscription's `current_period_start`).

**200 OK**
```json
{
  "success": true,
  "message": "Usage summary loaded.",
  "data": {
    "periodStart": "2026-04-15T00:00:00Z",
    "periodEnd":   "2026-05-15T00:00:00Z",
    "creditsIncluded": 5000,
    "creditsSpent":     1382,
    "creditsRemaining": 3618,
    "totalRequests":    214,
    "successRate":      0.987,
    "topAgents": [
      { "slug": "research",   "requests": 88 },
      { "slug": "writer",     "requests": 56 },
      { "slug": "code",       "requests": 42 }
    ],
    "topModels": [
      { "modelId": "claude-sonnet-4-6", "requests": 152 },
      { "modelId": "claude-haiku-4-5",  "requests": 49 }
    ],
    "featureUsage": { "webSearch": 31, "codeExecution": 12, "fileUpload": 7 }
  }
}
```

Reads come exclusively from `usage_daily_user` rows whose `day` falls in the period — never from `usage_records` directly.

### `GET /usage/history?days=30`

Per-day chart for the last N days (default 30, max 90). Returns array sorted ascending.

**200 OK**
```json
{
  "success": true,
  "message": "Usage history loaded.",
  "data": [
    { "day": "2026-04-04", "requests": 12, "creditsSpent": 64, "successRate": 1.0 },
    { "day": "2026-04-05", "requests": 8,  "creditsSpent": 41, "successRate": 1.0 },
    …
  ]
}
```

---

## D. Admin API Routes

Base: `/api/v1/admin/analytics`. Requires `x-platform: admin` + admin role. Postman group: **Module 6 - Admin Analytics Contracts**.

### `GET /admin/analytics/overview?from=&to=`

Single composite payload powering the home dashboard.

**200 OK**
```ts
{
  range: { from: ISO8601, to: ISO8601 },
  totals: {
    requests: number,
    activeUsers: number,
    creditsSpent: number,
    actualCostUsd: number,
    revenueInr: number,                  // pulled from Module 2's subscription_history; informational
    cacheHitRate: number                 // 0..1
  },
  series: {
    requestsHourly: [{ hour: ISO8601, count: number }],
    costHourly:     [{ hour: ISO8601, costUsd: number }]
  },
  providerHealth: {
    anthropic: { successRate: number, requests: number },
    openai:    { successRate: number, requests: number },
    google:    { successRate: number, requests: number }
  }
}
```

### `GET /admin/analytics/users?sort=-creditsSpent&limit=50`

Top users by usage / spend. Sort keys: `creditsSpent`, `requests`, `lastActiveAt` (each `+/-` for asc/desc).

```ts
[
  {
    userId, email, name, planSlug,
    requestsLast30d, creditsSpentLast30d,
    lastActiveAt
  }
]
```

### `GET /admin/analytics/models`

Distribution of model usage in the requested range.

```ts
{
  range,
  models: [
    { modelId, provider, requests, totalInputTokens, totalOutputTokens,
      totalCreditsCharged, totalActualCostUsd, marginUsd }
  ]
}
```

### `GET /admin/analytics/costs`

Actual USD costs versus credits charged. Tells finance whether the credit pricing is aligned with provider invoices.

```ts
{
  range,
  byPlan: [
    { planSlug, requests, costUsd, creditsCharged, marginPct }
  ],
  byModel: [
    { modelId, costUsd, creditsCharged, marginPct }
  ],
  totals: { costUsd, creditsCharged, marginPct }
}
```

### `GET /admin/analytics/errors?from=&to=`

Error-rate breakdown.

```ts
{
  range,
  byCode: [
    { errorCode, count, exampleRequestIds: [string] }   // last 5 ids per code
  ],
  byProvider: [
    { provider, errorCount, totalCount, errorRate }
  ]
}
```

### `GET /admin/analytics/ratelimits?from=&to=`

Reads `rate_limit_events` (Module 5's table) and joins user identity. Module 6 owns no data here; it owns the dashboard.

```ts
{
  range,
  hits:       number,
  cooldowns:  number,
  flags:      number,
  topUsers:   [{ userId, email, hits, cooldowns }],
  byHour:     [{ hour: ISO8601, hits: number }]
}
```

---

## E. Error Code Reference

| Code | HTTP | Source |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad query params (`from > to`, `days > 90`, etc.) — uses standard Zod adapter |
| `NOT_FOUND` | 404 | `GET /usage/history` for a user with no period started yet (no subscription) |
| `INTERNAL_ERROR` | 500 | Unexpected query failure; logged with `request_id` |

Module 6 introduces no new `Errors.*` factories; everything routes through the existing helpers.

---

## F. Retention & Archival

- `usage_records` keeps 90 days hot. After that, a daily worker (`usage.cleanup.worker.ts`) deletes rows older than 90 days **after** confirming a copy exists in the cold store (out of scope today; for now the worker just logs `usage_archive_skipped`).
- Rollup tables are kept indefinitely (small, valuable, no PII).
- Compliance / GDPR delete: when a user is hard-deleted (Module 1 admin action — future), Module 6's deletion handler scrubs `user_id` to `NULL` on all matching rows in `usage_records` and recomputes the affected `usage_daily_user` rows. Aggregates by plan/system stay accurate because they aggregate on `plan_id`, not user.

---

## G. Security Notes

| Concern | Mitigation |
|---|---|
| User reads another user's usage | All user-route queries pin `WHERE user_id = req.user.id`. No `:userId` param on user routes. |
| Admin sees raw IPs | Stored as `ip_hash` only. Original IP is in nginx logs (separate stream, separate retention). |
| Cost manipulation via crafted `record()` | Service is internal; not exposed via HTTP. Only Module 7 worker can call it. |
| Rollup worker double-runs | `INSERT … ON CONFLICT DO UPDATE` makes it safe. The worker uses BullMQ's `repeatable jobs` with `removeOnComplete: 50` to keep history short. |
| PII in `userAgent` | Stored verbatim today; redacted in admin dashboards by truncating to first 200 chars. Acceptable. |
| Timing-attack on `GET /usage/summary` | Always returns the same shape regardless of values; latency is bounded by the rollup table read (1 row). |
