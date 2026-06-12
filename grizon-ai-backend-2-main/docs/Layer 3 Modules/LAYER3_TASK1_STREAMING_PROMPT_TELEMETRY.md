# Layer 3 Task 1 — Streaming, Prompt Assembly & Cost Telemetry
## Implementation Specification

> **Status:** Ready for Implementation
> **Depends on:** Nothing (implement first)
> **Modules:** M13 (Agent Runtime), M15 (Provider & Streaming), M16 (Prompt Assembly), M23 (Cost Telemetry)
> **Last Updated:** 2026-05-08

---

## 1. Source Priority

1. `docs/AGENT_LLM_CATALOGUE.md` — supersedes M13/M15 on catalogue schema and agent_type branching
2. `docs/LAYER3_AGENT_EXECUTION.md` — base contracts for all modules
3. `docs/LAYER3_RUNTIME_PROVIDER_PROMPT_REFERENCE.md` — implementation companion (runtime branch rules, prompt rules)
4. `docs/PROJECT_ARCHITECTURE.md` — cross-layer constraints
5. `docs/LLM_NEW_MODULE_PROMPT.md` — coding standards, envelope, error patterns

Follow source priority when there is a conflict. Do not invent behavior not described in any of the above.

---

## 2. Existing Code to Reuse (Do NOT re-implement)

| File | What to reuse |
|---|---|
| `src/workers/chat.worker.ts` | Entire job lifecycle, SSE publishing, wallet hold/release, usage_records write — keep all unchanged; only add prompt assembler call + api_calls write |
| `src/router/index.ts` | `runRouter()`, `streamCompletion()` — keep unchanged |
| `src/router/providerHealth.ts` | Circuit breaker: `recordSuccess()`, `recordFailure()`, `getHealth()` — reuse as-is |
| `src/router/tools.ts` | Tool allowance and JSON spec generation — reuse as-is |
| `src/router/agentDispatcher.ts` | Agent dispatch and fallback ladder — reuse as-is |
| `src/models/providers/anthropic.ts` | Existing streaming implementation — extend only for keepalive |
| `src/models/providers/openai.ts` | Full impl — use as template for xai.ts and deepseek.ts |
| `src/services/summariser.service.ts` | `summarise(conversationId, messages, limit)` — call from assembler |
| `src/utils/errors.ts` | `AppError`, `Errors.*` patterns |
| `src/utils/response.ts` | `ok()`, `fail()`, `created()` helpers |
| `src/db/pool.ts` (or equivalent) | Postgres pool — use for all DB writes |
| `src/lib/redis.ts` (or equivalent) | Redis client — use for keepalive keys |

---

## 3. What NOT to Change

- Do not alter any existing route handler signatures or response envelopes.
- Do not modify `src/router/agentDispatcher.ts`, `src/router/classifier.ts`, or `src/router/queryRewriter.ts`.
- Do not modify `src/services/summariser.service.ts`.
- Do not change the `usage_records` write logic in `chat.worker.ts` — the new `api_calls` write is additive.
- Do not remove the in-memory `AGENT_CATALOGUE` from `src/router/catalogue.ts` — the DB-backed path is additive; keep the fallback.
- Do not change existing migration files.

---

## 4. New Files to Create

### 4.1 `src/db/migrations/030_api_calls.sql`

```sql
CREATE TABLE IF NOT EXISTS api_calls (
  request_id              UUID PRIMARY KEY,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL,
  model                   TEXT NOT NULL,
  agent_slug              TEXT NOT NULL,
  input_fresh             INT NOT NULL DEFAULT 0,
  input_cached            INT NOT NULL DEFAULT 0,
  output                  INT NOT NULL DEFAULT 0,
  cache_write             INT NOT NULL DEFAULT 0,
  cost_usd_billed_to_us   NUMERIC(12,6),
  credits_charged_to_user NUMERIC(12,2),
  cache_layer             TEXT CHECK (cache_layer IN ('semantic', 'prompt', 'none')),
  tool_count              INT NOT NULL DEFAULT 0,
  latency_ms              INT NOT NULL DEFAULT 0,
  metadata                JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_calls_user_id     ON api_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_created_at  ON api_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_api_calls_agent_slug  ON api_calls(agent_slug);
CREATE INDEX IF NOT EXISTS idx_api_calls_model       ON api_calls(model);
```

### 4.2 `src/prompt/assembler.ts`

Assembles the provider-ready message array from a job context. Must:

- Accept: `{ agentSlug, systemPrompt, toolDefinitions, conversationHistory, userQuery, retrievedContext?, plan }`
- Enforce `agent.max_context_messages` by truncating `conversationHistory` to that limit (read from DB agents row via agent slug; fall back to 20 if not found)
- Enforce `agent.max_context_tokens` by triggering compaction (call `summariser.service.ts`) when estimated token count > 60% of model limit
- Produce a `messages` array in the shape the provider adapters expect
- For Anthropic providers: add `cache_control: { type: 'ephemeral' }` at exactly two breakpoints:
  - Breakpoint 1: on the `system` block that contains tool definitions (stable prefix ends here)
  - Breakpoint 2: on the last `user` message that contains stable history (the current query is NOT cached)
- Never include `Date.now()`, session IDs, or user-specific identifiers above a cache breakpoint
- For non-Anthropic providers: emit the same messages array without `cache_control` fields (providers ignore unknown fields)
- Export: `assemblePrompt(ctx: PromptAssemblyContext): Promise<AssembledPrompt>`

```typescript
interface PromptAssemblyContext {
  agentSlug: string;
  systemPrompt: string;
  toolDefinitions: object[];     // already-resolved JSON specs from router/tools.ts
  conversationHistory: Message[];
  userQuery: string;
  retrievedContext?: string;     // optional injected context (memory recall, file snippets)
  planSlug: string;
  provider: string;              // 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek'
}

interface AssembledPrompt {
  system: string | object[];     // string for OpenAI/Google; array with cache_control for Anthropic
  messages: Message[];
  estimatedTokens: number;
  compactionApplied: boolean;
}
```

Token estimation: use `Math.ceil(text.length / 4)` (good enough; no external tokeniser needed).

### 4.3 `src/models/providers/xai.ts`

X.ai (Grok) uses the OpenAI-compatible API. Implement by mirroring `openai.ts` exactly with these changes:

- `baseURL`: `process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1'`
- `apiKey`: `process.env.XAI_API_KEY`
- If `XAI_API_KEY` is absent: export an empty object and log a warning; do not throw
- Provider ID string: `'xai'`

### 4.4 `src/models/providers/deepseek.ts`

DeepSeek uses the OpenAI-compatible API. Implement by mirroring `openai.ts` with:

- `baseURL`: `process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1'`
- `apiKey`: `process.env.DEEPSEEK_API_KEY`
- If `DEEPSEEK_API_KEY` is absent: export an empty object and log a warning; do not throw
- Provider ID string: `'deepseek'`

---

## 5. Files to Modify

### 5.1 `src/router/modelSelector.ts`

**Change:** Add DB-backed model priority resolution alongside the existing in-memory path.

Add a function `resolveModelFromDB(agentSlug: string, agentType: 'specialized' | 'direct'): Promise<RouterDecision | null>`:

- Query:
  ```sql
  -- For specialized:
  SELECT amp.model_id, amp.provider_id, amp.priority,
         m.model_name, m.tier, m.input_cost_per_1k, m.output_cost_per_1k,
         ph.status as health_status
  FROM agent_model_priorities amp
  JOIN ai_models m ON m.id = amp.model_id
  JOIN agents a ON a.id = amp.agent_id
  LEFT JOIN provider_health ph ON ph.provider_id = amp.provider_id
  WHERE a.slug = $1 AND amp.is_active = true
  ORDER BY amp.priority ASC
  ```
- Walk the result rows: skip rows where `health_status = 'down'`; prefer `healthy` over `degraded`
- Return the first usable row as `RouterDecision`
- For `direct` type: query `agents.direct_model_id` → single hard-fail if unavailable

**Change:** In the existing `selectModel()` (or equivalent entry point), try `resolveModelFromDB()` first. If it returns null (DB empty or no active priorities), fall through to the existing in-memory catalogue logic.

### 5.2 `src/models/providers/anthropic.ts`

**Change:** Add keepalive scheduling.

After a streaming session starts for an Anthropic model:

1. Read or write a Redis key `keepalive:{agentSlug}:{modelId}` with the current timestamp (TTL 10 min).
2. If no existing interval for this key, schedule a `setInterval` every 4 minutes that:
   - Makes a minimal Anthropic API call (1-token completion, Haiku model) with the same static system prompt prefix to refresh the Anthropic cache TTL.
   - Updates the Redis key TTL.
3. On stream `finish` or `error` event: clear the interval and delete the Redis key.
4. On Redis key expiry (10 min idle): the key is gone; next stream start creates a new one.

Keep the keepalive interval map as a module-level `Map<string, NodeJS.Timeout>`.

### 5.3 `src/workers/chat.worker.ts`

**Change 1 — Use prompt assembler:**
Replace the inline message array construction with a call to `assemblePrompt()` from `src/prompt/assembler.ts`. Pass the returned `AssembledPrompt.messages` to the router/stream call. Keep all other chat.worker logic unchanged.

**Change 2 — Write api_calls row:**
After the job completes (success or failure), insert one row into `api_calls`:

```typescript
await db.query(`
  INSERT INTO api_calls (
    request_id, user_id, provider, model, agent_slug,
    input_fresh, input_cached, output, cache_write,
    cost_usd_billed_to_us, credits_charged_to_user,
    cache_layer, tool_count, latency_ms, metadata
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ON CONFLICT (request_id) DO NOTHING
`, [
  jobId, userId, provider, model, agentSlug,
  usageTokens.inputFresh, usageTokens.inputCached,
  usageTokens.output, usageTokens.cacheWrite,
  computeCostUsd(model, usageTokens),   // see §5.4 below
  creditsCharged,
  cacheLayer ?? 'none',
  toolCallCount,
  Date.now() - jobStartTime,
  { subagentCost: 0 }
]);
```

`computeCostUsd(model, tokens)`: look up `input_cost_per_1k` and `output_cost_per_1k` from `ai_models` table for the model string; compute `(inputFresh * inputRate + output * outputRate) / 1000`. Cache the rate lookup in a module-level Map (it does not change during a run).

### 5.4 `src/controllers/admin/analytics.controller.ts`

**Change:** Implement or replace the `getCosts()` stubs with real queries against `api_calls`.

Add these three methods (register on the existing analytics router — do not add new route mounts):

**`GET /api/v1/admin/analytics/costs/overview`**
```sql
SELECT
  SUM(cost_usd_billed_to_us)   FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')  AS today_usd,
  SUM(credits_charged_to_user) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')  AS today_credits,
  SUM(cost_usd_billed_to_us)   FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week_usd,
  SUM(credits_charged_to_user) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week_credits,
  SUM(cost_usd_billed_to_us)   FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS month_usd,
  SUM(credits_charged_to_user) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS month_credits,
  COUNT(*)                     FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')  AS today_calls
FROM api_calls;
```

**`GET /api/v1/admin/analytics/costs/by-model`**
```sql
SELECT model, provider,
  COUNT(*)                    AS call_count,
  SUM(input_fresh + input_cached + output) AS total_tokens,
  SUM(cost_usd_billed_to_us)  AS total_usd
FROM api_calls
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY model, provider
ORDER BY total_usd DESC;
```

**`GET /api/v1/admin/analytics/costs/by-agent`**
```sql
SELECT agent_slug,
  COUNT(*)                    AS call_count,
  SUM(cost_usd_billed_to_us)  AS total_usd,
  SUM(credits_charged_to_user) AS total_credits,
  AVG(latency_ms)             AS avg_latency_ms
FROM api_calls
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY agent_slug
ORDER BY total_usd DESC;
```

All three return inside the standard `ok()` envelope. Require `requireAdmin` middleware (already applied on the admin router).

---

## 6. DB Migrations

Run order:
1. `030_api_calls.sql` — no dependencies on other new migrations

Migration must be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

---

## 7. API Surface

No new route mounts. The three cost analytics endpoints already exist on the admin analytics router — this task implements their controllers.

| Method | Path | Auth | Change |
|---|---|---|---|
| `GET` | `/api/v1/admin/analytics/costs/overview` | admin | implement controller |
| `GET` | `/api/v1/admin/analytics/costs/by-model` | admin | implement controller |
| `GET` | `/api/v1/admin/analytics/costs/by-agent` | admin | implement controller |

Response envelope (all three):
```json
{
  "success": true,
  "data": { ... }
}
```

---

## 8. Error Codes

Use existing `AppError`/`Errors.*` patterns. No new error codes required for this task. For DB failures in `api_calls` insert: log the error and continue (do not fail the job because of telemetry write failure).

---

## 9. Postman Updates

Add a new folder **"Module 23 - Admin Costs Contracts"** in the Postman collection with 3 requests:

1. `GET {{baseUrl}}/api/v1/admin/analytics/costs/overview`
   - Headers: `x-platform: admin`, `Authorization: Bearer {{adminAccessToken}}`
   - Test: `pm.response.to.have.status(200)`, `pm.expect(pm.response.json().data).to.have.property('today_usd')`

2. `GET {{baseUrl}}/api/v1/admin/analytics/costs/by-model`
   - Same headers
   - Test: status 200, data is array

3. `GET {{baseUrl}}/api/v1/admin/analytics/costs/by-agent`
   - Same headers
   - Test: status 200, data is array

---

## 10. Verification Steps

1. **api_calls write**: Send a chat message end-to-end. Query `SELECT * FROM api_calls` — confirm one row with correct `user_id`, `agent_slug`, `model`, `input_fresh > 0`, `output > 0`, `latency_ms > 0`.

2. **Prompt cache breakpoints**: Send the same chat message twice to the same agent. On the second call, check provider usage logs for `input_cached > 0` (Anthropic `cache_read_input_tokens > 0`). Verify the system prompt + tool definitions block has `cache_control` set.

3. **Context cap enforcement**: Create a conversation with 50 messages. Send a new message. Verify the assembled prompt's `messages` array does not exceed `agent.max_context_messages` (default 20). Check `compactionApplied: true` if token count was over 60% of limit.

4. **X.ai + DeepSeek stubs**: With `XAI_API_KEY` unset, confirm app starts without error and xai provider is simply absent from the registry. With a valid key, confirm a test stream request routes through and emits chunks.

5. **Cost analytics endpoints**: After step 1, hit `GET /api/v1/admin/analytics/costs/overview` — confirm `today_calls >= 1` and `today_usd > 0`.

6. **Keepalive**: Set up a long-running chat with an Anthropic model. Confirm Redis key `keepalive:{agentSlug}:{modelId}` exists during streaming. After stream finish, confirm the key is removed.
