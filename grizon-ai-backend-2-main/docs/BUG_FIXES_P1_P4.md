# Bug Fix Plan — Priority 1 to 4
## grizon-ai-backend-2 | Post-Audit Fixes

> **Source:** Full codebase audit conducted 2026-05-09  
> **Scope:** Four confirmed bugs in the chat pipeline: prompt compaction, usage telemetry, platform cost reporting, and Anthropic keepalive.  
> **Status:** Pending implementation  
> **Do not modify** `docs/BUG_FIXES_P1_P4.md` during implementation — use it as the spec.

---

## Table of Contents

1. [Bug 1 — Keepalive Memory Leak / Cross-Session Interference](#bug-1--keepalive-memory-leak--cross-session-interference)
2. [Bug 2 — `semanticCacheHit` Misidentifies Prompt Cache as Semantic Cache](#bug-2--semanticcachehit-misidentifies-prompt-cache-as-semantic-cache)
3. [Bug 3 — `computeCostUsd` Ignores Cached Input Tokens](#bug-3--computecostusd-ignores-cached-input-tokens)
4. [Bug 4 — Prompt Compaction Runs Summariser but Discards the Result](#bug-4--prompt-compaction-runs-summariser-but-discards-the-result)
5. [Implementation Order](#implementation-order)
6. [Testing Checklist](#testing-checklist)

---

## Bug 1 — Keepalive Memory Leak / Cross-Session Interference

### Severity
**Medium** — No data loss, but causes unexpected keepalive failures in concurrent sessions and leaks timers.

### File
`src/models/providers/anthropic.ts`

### Root Cause
The `keepaliveIntervals` map is a module-level singleton keyed by `keepalive:${agentSlug}:${modelId}`. Every session that uses the same agent + model shares one timer entry. When any session finishes and calls `stopKeepalive`, it clears the interval and deletes the Redis key — silently killing the keepalive for every other concurrently running session that shares the same key.

```typescript
// CURRENT (buggy) — one shared timer for all sessions on chat + claude-sonnet-4-6
const keepaliveKey = `keepalive:${agentSlug}:${params.modelId}`;
if (!keepaliveIntervals.has(keepaliveKey)) {
  const interval = setInterval(() => {
    void refreshKeepalive(client, keepaliveKey, systemPrompt);
  }, KEEPALIVE_INTERVAL_MS);
  keepaliveIntervals.set(keepaliveKey, interval);
}
```

### Fix

Scope the keepalive key to the **job ID** (one per active stream). Pass `jobId` into `startKeepalive` from the provider stream params.

**Step 1 — Add `jobId` to `ProviderStreamParams`**

File: `src/types/router.ts`

```typescript
// Add to ProviderStreamParams interface:
jobId?: string;
```

**Step 2 — Pass `jobId` from the router**

File: `src/router/index.ts` — inside `streamCompletion`, when calling `provider.streamCompletion`:

```typescript
const stream = provider.streamCompletion({
  modelId: attempt.modelId,
  agentSlug: decision.agentSlug,
  messages: working,
  tools: toolSpecsFor(decision.allowedTools),
  systemPrompt: systemPromptOverride ?? decision.systemPrompt,
  temperature: decision.temperature,
  abortSignal,
  jobId: ctx.jobId,       // ← add this
});
```

**Step 3 — Scope the keepalive key to the job**

File: `src/models/providers/anthropic.ts`

```typescript
// FIXED — one timer per job, no shared state
async function startKeepalive(client: Anthropic, params: ProviderStreamParams) {
  const jobId = params.jobId ?? crypto.randomUUID();
  const keepaliveKey = `keepalive:job:${jobId}`;          // ← scoped to job
  const systemPrompt =
    typeof params.systemPrompt === "string"
      ? params.systemPrompt
      : JSON.stringify(params.systemPrompt.filter((b) => typeof b === "object"));

  const redis = await getRedisClient();
  if (redis) {
    await redis.set(keepaliveKey, String(Date.now()), { EX: KEEPALIVE_TTL_SECONDS });
  }

  // No shared-key guard needed — each job gets its own interval
  const interval = setInterval(() => {
    void refreshKeepalive(client, keepaliveKey, systemPrompt);
  }, KEEPALIVE_INTERVAL_MS);
  keepaliveIntervals.set(keepaliveKey, interval);

  return keepaliveKey;
}
```

`stopKeepalive` is already correct — it clears by key. No change needed there.

**Step 4 — Verify `StreamContext` passes `jobId`**

File: `src/workers/chat.worker.ts`

The `ctx` object already has `jobId: job.id!`. Confirm `streamCompletion` receives it from the router call. No changes needed in the worker itself — just verify the chain flows through.

### After Fix
- Each active stream has its own keepalive timer.
- Stopping one job does not affect any other running jobs.
- The `keepaliveIntervals` map is bounded by concurrent active streams (not unique agent+model pairs).

---

## Bug 2 — `semanticCacheHit` Misidentifies Prompt Cache as Semantic Cache

### Severity
**Low-Medium** — No functional impact. Pollutes analytics dashboards and the `usage_records` table with incorrect cache attribution.

### File
`src/workers/chat.worker.ts`

### Root Cause
The `semanticCacheHit` field in `usageTracker.record()` is set to `inputCached > 0`. But `inputCached` is the number of **prompt-cached input tokens** returned by Anthropic (the 90%-off token count). It has nothing to do with the semantic response cache (Qdrant vector lookup). A query served from the semantic cache never even reaches the LLM, so `inputCached` is always `0` for those. Conversely, a fresh LLM call with a warm prompt cache will incorrectly log `semanticCacheHit: true`.

```typescript
// CURRENT (buggy) — approximately line 710
await usageTracker.record({
  ...
  semanticCacheHit: inputCached > 0,        // ← WRONG: this is prompt cache
  cacheHitLayer: inputCached > 0 ? "prompt" : "none",
  ...
});
```

### Fix

Track a dedicated `promptCacheHit` boolean and keep `semanticCacheHit` for actual semantic cache hits only. The semantic cache path (`handleSemanticCacheHit`) already correctly passes `semanticCacheHit: true` — the bug is only in the LLM-served path.

**Step 1 — Add `promptCacheHit` to `UsageRecord` type (if it doesn't exist)**

File: `src/types/usage.d.ts`

```typescript
// Add to UsageRecord:
promptCacheHit?: boolean;
```

**Step 2 — Fix the LLM-served success path**

File: `src/workers/chat.worker.ts` — in the `!terminal && finish` block:

```typescript
// FIXED
await usageTracker.record({
  ...
  semanticCacheHit: false,                  // ← always false here (not from semantic cache)
  promptCacheHit: inputCached > 0,          // ← new field: prompt cache hit
  cacheHitLayer: inputCached > 0 ? "prompt" : "none",
  ...
});
```

**Step 3 — Fix the terminal failure path**

File: `src/workers/chat.worker.ts` — in `handleTerminalFailure`:

```typescript
// FIXED
await usageTracker.record({
  ...
  semanticCacheHit: false,
  promptCacheHit: inputCached > 0,
  cacheHitLayer: inputCached > 0 ? "prompt" : "none",
  ...
});
```

**Step 4 — Add `prompt_cache_hit` column to `usage_records` (migration)**

File: `src/db/migrations/038_usage_prompt_cache_hit.sql` (new file):

```sql
-- Bug fix: distinguish prompt cache hit from semantic cache hit in usage_records.
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS prompt_cache_hit BOOLEAN NOT NULL DEFAULT FALSE;
```

**Step 5 — Persist in `usageTracker.record()`**

File: `src/services/usageTracker.service.ts` — add `prompt_cache_hit` to the INSERT statement, reading from `args.promptCacheHit ?? false`.

### After Fix
- `usage_records.semantic_cache_hit = true` only when the Qdrant semantic cache answered the request (no LLM call made).
- `usage_records.prompt_cache_hit = true` when Anthropic's prompt cache reduced the input token cost.
- Analytics queries that compute cache ROI will be accurate.

---

## Bug 3 — `computeCostUsd` Ignores Cached Input Tokens

### Severity
**Medium** — Causes `api_calls.cost_usd_billed_to_us` to be understated on every request that hits Anthropic's prompt cache. Over time the admin cost dashboard underreports true platform LLM spend.

### File
`src/workers/chat.worker.ts`

### Root Cause
`computeCostUsd` accepts only `inputFresh` and `output`. Anthropic bills cached reads at 10% of the standard input rate — not zero. The cached token cost is excluded entirely.

```typescript
// CURRENT (buggy) — approximately line 44
async function computeCostUsd(model: string, usage: {
  inputFresh: number;
  output: number;     // inputCached never considered
}): Promise<number> {
  ...
  return ((usage.inputFresh * rates.inputRate) + (usage.output * rates.outputRate)) / 1000;
}
```

### Fix

**Step 1 — Add `input_cached_cost_per_1k` column to `ai_models` (migration)**

File: `src/db/migrations/039_ai_models_cached_rate.sql` (new file):

```sql
-- Bug fix: store the discounted rate for cached input tokens.
-- Anthropic default is 10% of input_cost_per_1k; other providers may differ.
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_cached_cost_per_1k NUMERIC(12,8) NOT NULL DEFAULT 0;

-- Backfill: set cached rate to 10% of input rate for all existing models.
UPDATE ai_models SET input_cached_cost_per_1k = input_cost_per_1k * 0.10
WHERE input_cost_per_1k > 0;
```

**Step 2 — Update `modelRateCache` to include the cached rate**

File: `src/workers/chat.worker.ts`:

```typescript
// FIXED
const modelRateCache = new Map<string, {
  inputRate: number;
  inputCachedRate: number;    // ← new
  outputRate: number;
}>();

async function computeCostUsd(model: string, usage: {
  inputFresh: number;
  inputCached: number;        // ← new parameter
  output: number;
}): Promise<number> {
  let rates = modelRateCache.get(model);
  if (!rates) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT input_cost_per_1k, input_cached_cost_per_1k, output_cost_per_1k
       FROM ai_models WHERE model_id = $1 LIMIT 1`,
      [model],
    );
    const row = res.rows[0] as {
      input_cost_per_1k?: string | number;
      input_cached_cost_per_1k?: string | number;
      output_cost_per_1k?: string | number;
    } | undefined;
    rates = {
      inputRate:       Number(row?.input_cost_per_1k        ?? 0),
      inputCachedRate: Number(row?.input_cached_cost_per_1k ?? 0),
      outputRate:      Number(row?.output_cost_per_1k       ?? 0),
    };
    modelRateCache.set(model, rates);
  }
  return (
    (usage.inputFresh  * rates.inputRate)       +
    (usage.inputCached * rates.inputCachedRate) +   // ← new
    (usage.output      * rates.outputRate)
  ) / 1000;
}
```

**Step 3 — Update all call sites of `computeCostUsd`**

There are two call sites in `chat.worker.ts`. Both need `inputCached` passed in:

```typescript
// In writeApiCallTelemetry:
const costUsd = await computeCostUsd(args.model, {
  inputFresh:  args.inputFresh,
  inputCached: args.inputCached,    // ← add
  output:      args.output,
});

// In handleSemanticCacheHit (semantic cache path — inputCached is 0 here, correct):
const costUsd = await computeCostUsd(args.model, {
  inputFresh:  0,
  inputCached: 0,
  output:      Math.max(1, Math.ceil(args.answer.length / 4)),
});
```

**Step 4 — Invalidate `modelRateCache` on restart (note)**

The in-memory cache has no TTL and survives until process restart. If model pricing changes in the database, a worker restart is needed to pick up the new rates. This is acceptable for now — document it in a comment above the map.

```typescript
// Rate cache: populated lazily, no TTL — restart workers after pricing changes in ai_models.
const modelRateCache = new Map<string, { inputRate: number; inputCachedRate: number; outputRate: number }>();
```

### After Fix
- `api_calls.cost_usd_billed_to_us` accurately reflects platform LLM spend including prompt cache reads.
- Admin analytics dashboard numbers will be higher (correct) for any model with prompt caching enabled.

---

## Bug 4 — Prompt Compaction Runs Summariser but Discards the Result

### Severity
**High** — When context overflows (>60% of model limit), the system runs the summariser and then builds the prompt from sliced raw history anyway, ignoring the summary. Users in long conversations get degraded context quality (raw slice) instead of the proper compact summary.

### Files
- `src/prompt/assembler.ts` — triggers summariser but doesn't reload
- `src/memory/session.memory.ts` — `hydrateSession` reads the summary if available
- `src/services/summariser.service.ts` — writes summary to `conversation_summaries` table

### Root Cause
`assemblePrompt` receives `conversationHistory` as a parameter. When it detects overflow, it calls `summariserService.run(conversationId)` which writes a summary to Postgres. But after the summariser runs, `assemblePrompt` does not re-read the session — it slices the already-in-memory raw history and uses that instead. The summary written by the summariser is not consumed until the **next request** (via `hydrateSession` in the chat worker).

```typescript
// CURRENT (buggy) — src/prompt/assembler.ts ~line 127
if (estimatedTokens > threshold) {
  compactionApplied = true;
  if (ctx.conversationId) {
    await summariserService.run(ctx.conversationId);   // ← writes summary to DB
  }
  // Slices raw history. Does NOT reload the freshly-written summary.
  history = history.slice(-Math.max(2, Math.floor(limits.maxContextMessages / 2)));
```

### Fix

After the summariser runs, reload the session messages so the current request benefits from the summary immediately.

**Step 1 — Export `hydrateSession` for use in the assembler**

`hydrateSession` is already exported from `src/memory/session.memory.ts`. No change needed there.

**Step 2 — Reload session inside `assemblePrompt` after summariser**

File: `src/prompt/assembler.ts`:

```typescript
// Add import at top:
import { hydrateSession } from "../memory/session.memory.js";

// FIXED compaction block:
if (estimatedTokens > threshold) {
  compactionApplied = true;
  if (ctx.conversationId) {
    try {
      await summariserService.run(ctx.conversationId);

      // Reload the session now that the summary is persisted.
      // hydrateSession returns: summary paragraph as a user/assistant exchange
      // at the front, followed by recent raw messages.
      const refreshed = await hydrateSession(ctx.conversationId);
      history = trimHistory(
        refreshed.filter((m) => m.role === "user" || m.role === "assistant"),
        limits.maxContextMessages,
      );
    } catch (error) {
      logger.warn(
        { err: error, conversationId: ctx.conversationId },
        "prompt_assembler_compaction_failed_falling_back",
      );
      // Fallback: slice raw history if summariser or reload fails
      history = history.slice(-Math.max(2, Math.floor(limits.maxContextMessages / 2)));
    }
  } else {
    // No conversationId — can't summarise, fall back to slicing
    history = history.slice(-Math.max(2, Math.floor(limits.maxContextMessages / 2)));
  }

  estimatedTokens = estimateTokens(
    `${ctx.systemPrompt}${buildToolSection(ctx.toolDefinitions)}\n${historyToText(history)}\n${ctx.userQuery}`,
  );
}
```

**Step 3 — Add the 85% fallback threshold (also from spec §11.2)**

This is a missing feature caught in the same audit. Add it as part of this fix since both live in the same block:

```typescript
// After the 60% compaction block, add the 85% emergency fallback:
const hardLimit = Math.floor(modelContextLimit * 0.85);
if (estimatedTokens > hardLimit) {
  // Emergency: keep only the last 3 messages + summary line
  history = history.slice(-3);
  estimatedTokens = estimateTokens(
    `${ctx.systemPrompt}${buildToolSection(ctx.toolDefinitions)}\n${historyToText(history)}\n${ctx.userQuery}`,
  );
  logger.warn(
    { agentSlug: ctx.agentSlug, estimatedTokens, hardLimit },
    "prompt_assembler_hard_context_limit_triggered",
  );
}
```

**Step 4 — Verify summariser idempotency**

File: `src/services/summariser.service.ts` — confirm that calling `run(conversationId)` when a recent summary already exists is safe (it should skip or update-in-place, not duplicate). If not, add an idempotency check before triggering the summariser:

```typescript
// In assemblePrompt, before calling summariserService.run():
// Only trigger if the estimated overflow is significant (not just barely over threshold)
if (estimatedTokens > threshold * 1.1) {   // 10% buffer to avoid thrashing
  await summariserService.run(ctx.conversationId);
  ...
}
```

### After Fix
- Long conversations immediately benefit from the compact summary on the request that triggered compaction, not just the next one.
- The 85% emergency threshold prevents any request from exceeding the model's hard context limit.
- The summariser is not re-triggered on every single message in long conversations (10% buffer).

---

## Implementation Order

Fix these in sequence — each is independent but ordered by risk:

| # | Bug | Files to Change | Est. Time | Risk |
|---|-----|-----------------|-----------|------|
| 1 | Bug 2 — semanticCacheHit telemetry | `chat.worker.ts`, `usageTracker.service.ts`, `usage.d.ts`, new migration | 30 min | Low |
| 2 | Bug 3 — computeCostUsd cached tokens | `chat.worker.ts`, new migration | 45 min | Low |
| 3 | Bug 1 — keepalive memory leak | `types/router.ts`, `router/index.ts`, `models/providers/anthropic.ts` | 30 min | Low |
| 4 | Bug 4 — compaction discards summary | `prompt/assembler.ts` | 45 min | Medium |

Start with 1 and 2 (telemetry/billing, zero functional impact on users). Do 3 next (affects concurrent heavy load). Do 4 last (changes core prompt assembly path — needs manual testing on a long conversation).

---

## Testing Checklist

### Bug 2 (semanticCacheHit)
- [ ] Send a query to the chat agent. Verify `usage_records.semantic_cache_hit = false` and `usage_records.prompt_cache_hit = false` on first call.
- [ ] Send the same query again (warm Anthropic cache). Verify `prompt_cache_hit = true`, `semantic_cache_hit = false`.
- [ ] Send the same query via the semantic cache path (agent = chat, same query twice). Verify `semantic_cache_hit = true`, `prompt_cache_hit = false`.

### Bug 3 (computeCostUsd)
- [ ] After migration 039, verify all existing `ai_models` rows have `input_cached_cost_per_1k = input_cost_per_1k * 0.10`.
- [ ] Send a request that generates prompt cache tokens. Verify `api_calls.cost_usd_billed_to_us` is greater than before the fix (because cached tokens are now counted at 10% rate).
- [ ] Verify no double-counting: a fresh request with zero cached tokens should have the same cost as before.

### Bug 1 (keepalive)
- [ ] Open two concurrent SSE streams using the same agent+model.
- [ ] Complete (close) the first stream. Verify the second stream's keepalive is still active in Redis (`keepalive:job:<jobId2>` key exists with a positive TTL).
- [ ] Complete the second stream. Verify both Redis keys are gone and no timers remain.

### Bug 4 (compaction)
- [ ] Create a conversation long enough to trigger the 60% threshold.
- [ ] Send a new message and verify `compactionApplied: true` in the assembled prompt log.
- [ ] Verify the assembled messages contain the summarised history (summary paragraph first, then recent raw messages) — not just a raw tail slice.
- [ ] Verify the summariser is not called again immediately on the next message (idempotency buffer check).
- [ ] Create an extremely long conversation and verify the 85% hard limit kicks in and logs `prompt_assembler_hard_context_limit_triggered`.

---

*This document is the implementation spec for the P1–P4 bug fixes. Close it out by creating a `BUGFIX_P1_P4_STATUS_REPORT.md` when all four are done.*
