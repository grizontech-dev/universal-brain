# Module 7 Worker ↔ Module 6 Usage — Implementation Spec

> **Status:** Specification (existing worker is partial — this document is the contract for completing it)
> **Scope:** `src/workers/chat.worker.ts` ↔ `src/services/usageTracker.service.ts` + `src/services/wallet.service.ts` + `src/services/message.service.ts`
> **Last Updated:** 2026-05-06

---

## 1. Why this document exists

Today, accurate usage data is partly bridged from `wallet.service.confirmDeduction()` (per the note in `LAYER2_API_GATEWAY.md` §8). That keeps numbers flowing during Layer 2 bring-up but produces:

- Usage rows that lack provider/model truth (the wallet doesn't know which model the router actually picked vs. the one originally selected).
- Missing tool-use signals (web search engine, code-execution counts).
- No first-token latency or router latency captured.
- No backfill of `cache_hit_layer` because the wallet only sees aggregate token counts.

The fix: the **chat worker** is the single authoritative writer for `usage_records`. The wallet only does money. Module 6 receives one durable write per terminal job state.

---

## 2. Roles & invariants

| Component | Owns | Must NOT |
|---|---|---|
| `chat.worker.ts` | Job lifecycle, streaming, finalise message, write usage row, confirm/release wallet hold | Charge twice; emit usage before message is finalised |
| `wallet.service.ts` | Holds, confirmations, releases, transactions | Write to `usage_records` |
| `usageTracker.service.ts` | INSERT into `usage_records`, fan-out to analytics rollups | Touch wallet balances |
| `message.service.ts` | Assistant message lifecycle (placeholder → streaming → complete/error) | Compute credit cost |
| `sseHub.service.ts` | Push events to subscribed clients | Hold business state |
| `creditCalculator.service.ts` | Pure function: tokens + model + agent + plan → credits | Read DB |

**Invariants:**
1. Exactly **one** `usage_records` row per terminal job (`completed`, `failed`, `cancelled`, `timeout`).
2. Wallet hold is resolved exactly once (`confirm` xor `release`) before the worker function returns.
3. SSE `done` (or `error`) is the **last** event published; the channel is closed in `finally`.
4. The assistant message reaches a terminal status (`complete` or `error`) before usage is recorded.
5. Message id used for usage = the assistant placeholder id (NOT the user message id).

---

## 3. Job lifecycle (state machine)

```
queued
  ↓ worker picks up
processing      ← router decision computed, assistant placeholder created
  ↓
streaming       ← first chunk emitted to SSE
  ↓
  ├─→ completed   (clean finish event from provider)
  ├─→ failed      (provider error / worker exception)
  ├─→ cancelled   (POST /chat/:conversationId/cancel)
  └─→ timeout     (provider stream exceeds plan-level cap)
```

Persisted in `chat_jobs.status` and mirrored in `messages.status`.

### Status transitions written to DB

| From → To | When | DB writes |
|---|---|---|
| queued → processing | Worker dequeues, before router | `chat_jobs.status`, `started_at` |
| processing → streaming | First `chunk` event | `chat_jobs.status` |
| streaming → completed | Provider `finish` event | `chat_jobs.status`, `completed_at`, `result_message_id`; `messages.status='complete'`; usage row insert; `wallet.confirmDeduction` |
| any → failed | Provider error or thrown exception | `chat_jobs.status`, `error_code`, `error_message`; `messages.status='error'`; usage row insert (status=`failed`); `wallet.releaseHold` |
| any → cancelled | Cancel signal received | `chat_jobs.status`; `messages.status='error'`, `error_message='cancelled'`; usage row (status=`cancelled`, partial tokens); `wallet.releaseHold` |
| streaming → timeout | Stream wall clock > cap | Same as cancelled but `error_code='STREAM_TIMEOUT'` |

---

## 4. Wall-clock budget

Per-plan stream caps (added to `plans.limits.streamTimeoutMs`, default fallback in code):

| Plan | Stream timeout | Inactivity timeout (no chunk) |
|---|---|---|
| Free | 60s | 20s |
| Starter | 120s | 30s |
| Pro | 240s | 45s |
| Enterprise | 600s | 60s |

Implementation: `setTimeout` driven via `AbortController` already present in worker. Two timers — total stream and inactivity (reset on each `chunk`). Whichever fires first aborts the provider stream and transitions to `timeout`.

---

## 5. End-to-end sequence

```
[POST /chat]
  ├── plan + flag + rate-limit + sanitiser
  ├── walletService.placeHold(estimatedCost)         → returns walletHoldId
  ├── INSERT chat_jobs (status='queued', wallet_hold_id, planSnapshot)
  ├── chatQueue.add(payload)
  └── 200 { jobId, status: 'queued' }

[chat.worker]
  1. UPDATE chat_jobs SET status='processing'
  2. decision = runRouter(payload)
     └── publishes nothing yet; pure function on payload
  3. sse.publish('processing', { agentSlug, modelId, modelProvider })
  4. assistant = messageService.createAssistantPlaceholder()
  5. UPDATE chat_jobs SET status='streaming'
  6. history = messageService.getRecentMessages(<= maxContextMessages)
  7. for await event in streamCompletion(decision, messages, abortSignal, ctx):
        chunk        → message.append + sse('chunk')
        tool_call    → counters++ + sse('tool_call')
        tool_result  → capture engine + sse('tool_result')
        usage        → buffer (latest wins)
        finish       → buffer (latest wins)
        error        → goto FAIL
  8. cost = creditCalculator.calculateCost(actualTokens, agent, plan)
  9. walletService.confirmDeduction(walletHoldId, cost, …)
 10. messageService.finalise(assistant.id, status='complete', tokens, cost, latency)
 11. usageTracker.record({ … full payload … })       ← single source of truth
 12. UPDATE chat_jobs SET status='completed', completed_at, result_message_id
 13. sse.publish('usage', { tokens, credits })
 14. sse.publish('done', { messageId, conversationId, status })
 15. sseHub.close(jobId)

[FAIL path]
   1. UPDATE chat_jobs SET status='failed', error_code, error_message
   2. messageService.finalise(assistant.id, status='error', errorMessage)
   3. walletService.releaseHold(walletHoldId, reason)
   4. usageTracker.record({ status: 'failed', partial tokens, errorCode })
   5. sse.publish('error', { code, message, retryable })
   6. sseHub.close(jobId)
```

---

## 6. Tool-call accounting (what to count, where)

The router emits `tool_call` and `tool_result` events as the provider invokes tools. The worker must:

```
counters = {
  webSearchCount: 0,
  webSearchEngine: null,        // 'tavily' | 'brave' | 'native'
  codeExecutionCount: 0,
  fileReadCount: 0,
  imageAnalyseCount: 0,
}

on tool_call(toolId):
  counters[toolId + 'Count'] += 1

on tool_result(toolId, output):
  if toolId === 'web_search' and output.engine: counters.webSearchEngine = output.engine
```

These map directly to fields in `UsageRecord` (Module 6) and feature counters (Module 3). The worker does **not** increment Module 3 feature counters — that already happened in `requireFeatureWithLimit` middleware before the job was enqueued. Counts here are for analytics only.

---

## 7. Token accounting (cached vs fresh)

`streamCompletion` emits one or more `usage` events. The worker keeps the **last** one — providers may emit incremental usage; the final event after `finish` is authoritative.

```
{
  inputTokensFresh:   number,   // billed at full input rate
  inputTokensCached:  number,   // billed at provider cached-input rate
  outputTokens:       number,
  cacheWriteTokens:   number,   // Anthropic only; first-write surcharge
}
```

Fallback when provider gave no usage (e.g. SDK stream cut early):

```
inputFresh   = job.data.estimatedTokens
inputCached  = 0
output       = max(1, ceil(fullText.length / 4))    // rough char→token estimate
cacheWrite   = 0
```

This fallback is logged with `metadata.usageFallback = true` so analytics can exclude it from cache-hit-rate calculations.

`cacheHitLayer`:
- `'prompt'` if `inputTokensCached > 0`
- `'semantic'` if the upstream semantic-cache layer short-circuits the call (Layer 3 — see `LAYER3_AGENT_EXECUTION.md`)
- `'none'` otherwise

---

## 8. Cost & wallet — the contract

```
estimatedCost   = creditCalculator.estimate(prompt, modelId, agent, planDiscount)
actualCost      = creditCalculator.calculateCost({
                    inputTokens:  inputFresh + inputCached,
                    outputTokens,
                    modelId:      finish.modelUsed,         // NOT decision.modelId
                    agentSlug:    decision.agentSlug,
                    planDiscount: planSnapshot.creditDiscount,
                  })
```

> **Important:** the model used for cost MUST be the `finish.modelUsed` reported by the provider, not the original `decision.modelId`. Fallback routing can switch models mid-flight.

Wallet protocol:

| Outcome | Call |
|---|---|
| `completed` | `walletService.confirmDeduction(holdId, { actualCost, modelId, agentSlug, messageId, jobId, … })` |
| `failed` (provider error before any output) | `walletService.releaseHold(holdId, reason)` — full release |
| `failed` (provider error after partial output) | Same as above for now. **Future:** partial-charge policy on Pro+ once we instrument output-token-only billing for partials |
| `cancelled` | `walletService.releaseHold(holdId, 'user_cancelled')` |
| `timeout` | `walletService.releaseHold(holdId, 'stream_timeout')` |

`confirmDeduction` writes a `wallet_transactions` row; `releaseHold` writes a `release` row. Neither writes `usage_records`.

---

## 9. Module 6 write — exact payload

`usageTracker.record()` is called **once** per job and inserts one `usage_records` row. The full shape:

```ts
await usageTracker.record({
  // Identity
  userId, conversationId, messageId, requestId: jobId,

  // Selection
  modelId:        finish.modelUsed,
  modelProvider:  finish.provider,
  agentSlug:      decision.agentSlug,
  platform:       job.data.platform,

  // Outcome
  status:         'success' | 'failed' | 'cancelled' | 'timeout',   // persisted: align with LAYER2 §8 (`success` not `ok`)
  finishReason:   finish.reason,           // 'stop' | 'length' | 'content_filter' | 'tool_use' | 'error'
  errorCode:      null | string,           // 'PROVIDER_OVERLOAD' | 'STREAM_TIMEOUT' | 'INTERNAL_ERROR' | …

  // Tokens
  inputTokens:        inputFresh + inputCached,
  inputTokensFresh:   inputFresh,
  inputTokensCached:  inputCached,
  outputTokens,
  cacheWriteTokens,

  // Money
  estimatedCredits:   job.data.estimatedCredits,
  creditsDeducted:    actualCost,          // 0 on failed/cancelled
  creditRate:         creditCalculator.rateFor(modelUsed),
  agentMultiplier:    creditCalculator.multiplierFor(decision.agentSlug),
  planDiscount:       planSnapshot.creditDiscount,

  // Tools / features
  webSearchUsed:      webSearchCount > 0,
  webSearchCount,
  webSearchEngine,
  codeExecutionUsed:  codeExecutionCount > 0,
  codeExecutionCount,
  hadFiles:           job.data.attachedFileIds.length > 0,
  hadVoice:           false,

  // Cache
  semanticCacheHit:   inputCached > 0,
  cacheHitLayer:      'semantic' | 'prompt' | 'none',

  // Performance
  routerLatencyMs:    decision.routerLatencyMs,
  llmFirstTokenMs,                          // see §10
  llmTotalMs,                               // see §10
  totalRequestMs:     Date.now() - startedAt,

  // Bag
  metadata: {
    classifierSource: decision.classification.classifierSource,
    confidence:       decision.classification.confidence,
    intent:           decision.classification.intent,
    complexity:       decision.classification.complexity,
    usageFallback?:   true,
  },
});
```

`usageTracker.record()` is responsible for:
1. INSERT into `usage_records`.
2. INCR Redis daily/monthly user rollups (`analytics:user:{userId}:daily:{YYYYMMDD}` etc).
3. Emit `usage.recorded` domain event for downstream listeners (cost dashboard, anomaly alerts).

It is **idempotent on `requestId`** — calling it twice with the same `jobId` is a no-op (UNIQUE constraint on `usage_records.request_id`).

---

## 10. New latency timestamps the worker must capture

Add three timestamps inside the worker:

```
const startedAt        = Date.now();           // worker pickup
let firstChunkAt:  number | null = null;        // set on first 'chunk' event
let lastChunkAt:   number | null = null;        // updated on every 'chunk'
let providerStart: number | null = null;        // set right before for-await loop

llmFirstTokenMs = firstChunkAt ? firstChunkAt - providerStart : null
llmTotalMs      = lastChunkAt  ? lastChunkAt  - providerStart : null
```

`routerLatencyMs` is already produced by `runRouter`. `totalRequestMs = Date.now() - startedAt`.

---

## 11. Cancellation

`POST /api/v1/chat/:conversationId/cancel` writes `chat_jobs.cancel_requested = true` and publishes a Redis pub/sub on `chat:cancel:{jobId}`. The worker subscribes once at start; on receipt:

```
abortCtl.abort('user_cancelled')
```

The `streamCompletion` async iterator must propagate the `AbortSignal` into the provider SDK call. When abort fires, the iterator throws `AbortError`; worker catches, transitions to `cancelled`, follows the FAIL path with `status='cancelled'`.

---

## 12. Idempotency & retry

BullMQ `attempts` is set to **1** for chat jobs (no automatic retry — partial output already streamed to user). If the worker crashes mid-stream:

- `chat_jobs.status` stays in `'streaming'`. A janitor sweep (`workers/usage.cleanup.worker.ts`), scheduled with the wallet janitor on a **10-minute** cadence, finds jobs in `'processing'` / `'streaming'` with `started_at < now() - 30 minutes` (aligned with Module 4 wallet janitor and Module 8 message janitor), marks them `'failed'`, releases holds, writes a `failed` usage row with `errorCode='WORKER_LOST'`.
- The assistant message is left in `'streaming'` and the same janitor flips it to `'error'`.

This is a recovery path, not a retry — the user re-sends manually.

---

## 13. Observability — what to log per job

Single structured log line per terminal state:

```
logger.info({
  jobId, userId, conversationId,
  status, agent, model, provider,
  inputFresh, inputCached, output, cacheWrite,
  creditsEstimated, creditsActual,
  routerMs, firstTokenMs, totalMs,
  webSearchCount, codeExecutionCount,
  errorCode,
}, 'chat_job_finished');
```

Plus per-event debug logs gated by `LOG_LEVEL=debug`.

---

## 14. Acceptance checklist

- [ ] Exactly one `usage_records` row appears per `chat_jobs` row in terminal state.
- [ ] `wallet_transactions` confirm/release count == terminal `chat_jobs` count (no orphan holds).
- [ ] `usage_records.model_id == finish.model_used`, never `decision.model_id` when fallback fires.
- [ ] On forced abort, `usage_records.status='cancelled'` is written within 1s.
- [ ] On stream timeout, `usage_records.status='timeout'` and `error_code='STREAM_TIMEOUT'`.
- [ ] `llmFirstTokenMs` is non-null on all `'ok'` rows that streamed text.
- [ ] Re-emitting the same job (BullMQ `removeOnComplete=false` test) produces no duplicate usage row.
- [ ] Janitor sweep recovers a killed worker within 15 minutes.

---

## 15. Files touched / created

| File | Change |
|---|---|
| `src/workers/chat.worker.ts` | Add inactivity + total stream timers; capture `firstChunkAt`; switch cost calc to `finish.modelUsed`; ensure exact-once usage write on every terminal path; subscribe to cancel channel |
| `src/services/usageTracker.service.ts` | Add UNIQUE constraint enforcement on `request_id`; emit `usage.recorded` event; daily/monthly Redis rollups |
| `src/services/wallet.service.ts` | `releaseHold(reason)` — accept structured reasons; ensure `confirmDeduction` is idempotent on `(jobId)` |
| `src/services/message.service.ts` | `finalise()` accepts `errorMessage`; idempotent on terminal status |
| `src/workers/usage.cleanup.worker.ts` | Janitor sweep for orphaned `'streaming'` jobs > 15 min |
| `src/db/migrations/*` | UNIQUE INDEX `usage_records (request_id)`; columns `chat_jobs.cancel_requested`, `plans.limits.streamTimeoutMs` (already JSONB) |
| `src/router/index.ts` | Ensure `streamCompletion` emits a final `usage` event after `finish` and propagates `AbortSignal` |

---

*This doc is the contract for finishing the Module 7 worker. Once shipped, Layer 3 (agents, tools, semantic cache, artifacts pipeline) can build on a stable, durable usage signal.*
