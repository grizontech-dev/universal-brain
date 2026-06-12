# 02 — Queues, Workers, SSE, Routes

End-to-end contracts: how `POST /chat` becomes a `jobId`, how the worker streams it back, how cancellation propagates, and how the admin manages stuck queues.

---

## A. Enqueue (`POST /chat`)

Base: `/api/v1/chat`. Bearer JWT required. Reaches the controller after the full pipeline (slots 1–12); `creditBudgetMiddleware` (slot 11) has already opened a hold and set `req.wallet.holdId`. Postman group: **Module 7 - User Chat Contracts**.

### Request body (validated by Module 9 with the schema below)

```ts
{
  conversationId:   string,                 // existing or freshly created (Module 8)
  clientMessageId:  string,                 // UUID v4; idempotency key
  content:          string,                 // already length-checked by sanitiser
  attachedFileIds?: string[],               // must be ready (Module 8 status='ready')
  agentSlug?:       string | null,          // null = auto-route via Module 10
  modelId?:         string | null,          // null = auto-select; gated by featureFlags.modelPicker
  options?: {
    temperature?:        number,            // gated by featureFlags.temperatureControl
    customSystemPrompt?: string,            // gated by featureFlags.customSystemPrompt
    searchContextSize?:  'low' | 'medium' | 'high'   // gated by featureFlags.webSearch
  }
}
```

### Server logic

```
1. Idempotency check:
   existing = SELECT * FROM chat_jobs
              WHERE user_id = $1 AND conversation_id = $2 AND client_message_id = $3
              AND created_at > now() - interval '24 hours'
   if existing → return 200 with existing.id (no double-enqueue, no double-charge)

2. Module 8: messageService.createUserMessage({ conversationId, content, role:'user', ... }) → messageId
3. Build ChatJobPayload (freezes req.plan snapshot, walletHoldId, attachedFileIds, options)
4. INSERT chat_jobs (id=newId, status='queued', user_id, conversation_id, client_message_id, ...)
5. chatQueue.add('process', payload, { jobId: newId, attempts: 3, backoff: { type:'exponential', delay: 5000 } })
6. emit chat.enqueued
7. Respond:
   201 { jobId: newId, status: 'queued', streamUrl: '/api/v1/chat/stream/<jobId>' }
```

If anything fails between steps 2–5, the controller calls `walletService.releaseHold(req.wallet.holdId, 'enqueue_failed')` so the hold is not orphaned.

### Errors (Module 7-specific, per `src/utils/errors.ts`)

| Code | HTTP | When |
|---|---|---|
| `CONVERSATION_NOT_FOUND` | 404 | `conversationId` not owned by caller |
| `ATTACHED_FILE_NOT_READY` | 409 | A file in `attachedFileIds` is still processing |
| `AGENT_NOT_ALLOWED` | 403 | `agentSlug` not in `req.plan.agentAccess` |
| `MODEL_NOT_ALLOWED` | 403 | `modelId` not in `req.plan.modelAccess` |
| `JOB_ENQUEUE_FAILED` | 500 | BullMQ insert failed; hold released |

`INSUFFICIENT_CREDITS` (402) and `RATE_LIMIT_EXCEEDED` (429) are raised earlier by Modules 4 and 5 and never reach this controller.

---

## B. Streaming (`GET /chat/stream/:jobId`)

Long-lived SSE connection. Bearer JWT required. The controller verifies `chat_jobs.user_id === req.user.id` before subscribing.

### Connection setup

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no       (disables nginx response buffering)
```

The controller calls `sseHub.subscribe(jobId, onEvent)`. As the worker emits events, they are written to the response stream as SSE frames:

```
event: chunk
data: {"content":"Sure, here's an example "}

event: chunk
data: {"content":"of how to..."}

event: heartbeat
data: {}
```

A heartbeat is sent every **15 seconds** of idle stream time so intermediaries (nginx, Cloudflare, ISPs) don't kill the connection.

### Event protocol (in emission order, per job)

| `event` | Payload | When |
|---|---|---|
| `queued` | `{ position }` | Right after subscribe if the job is still in the queue |
| `processing` | `{ agentSlug, modelId, modelProvider }` | Worker has classified, selected, and started the LLM call |
| `status` | `{ phase: 'web_search_searching' \| 'web_search_synthesizing' \| 'tool_executing' \| 'compacting_context' }` | Optional progress hints during long phases |
| `chunk` | `{ content: string }` | Token-by-token output from the LLM |
| `tool_call` | `{ name, args, callId }` | LLM requested a tool (web_search, code_execute, …) |
| `tool_result` | `{ callId, summary, latencyMs }` | Tool finished; full result is injected into the agent loop, only a brief summary streams to client |
| `artifact` | `{ artifactId, type, title, latest: boolean }` | A new artifact (or version) was created |
| `usage` | `{ tokensUsed: { inputFresh, inputCached, output, cacheWrite }, creditsDeducted, walletBalanceAfter }` | After `wallet.confirmDeduction` succeeds |
| `done` | `{ messageId, conversationId, status: 'completed' }` | Final event on success |
| `error` | `{ code, message }` | Final event on failure (job will not retry further) |
| `cancelled` | `{ reason }` | Client called the cancel endpoint or admin force-cancelled |
| `heartbeat` | `{}` | Every 15 s of idle |

After `done`, `error`, or `cancelled`, the server closes the SSE response. The client should not reconnect on those events.

### Resumability

If the client reconnects to `/chat/stream/:jobId` after a network blip:
- The hub replays buffered events from a small in-memory ring (last 256 events per job, dropped after 5 min post-completion).
- For longer disconnects, the client falls back to `GET /chat/job/:jobId` to get the final state and the assistant message via `GET /conversations/:id/messages`.

---

## C. Polling fallback (`GET /chat/job/:jobId`)

Bearer JWT. Returns the current snapshot, **not** a stream. Suitable for clients on networks that strip SSE.

**200 OK** (universal envelope, `data` shape):
```ts
{
  jobId, status,
  agentSlug:  string | null,
  modelId:    string | null,
  resultMessageId: string | null,
  artifactIds: string[],
  errorCode:  string | null,
  errorMessage: string | null,
  startedAt, completedAt
}
```

**Errors:** `404 NOT_FOUND` if not owned; `403 USER_BANNED` standard.

---

## D. Cancel (`POST /chat/:conversationId/cancel`)

Cancels the **most recently enqueued, not-yet-completed** job for that conversation owned by the caller.

### Server logic

```
1. job = SELECT * FROM chat_jobs
         WHERE user_id = $1 AND conversation_id = $2 AND status IN ('queued','processing','streaming')
         ORDER BY created_at DESC LIMIT 1
   if not found → 404 NO_ACTIVE_JOB
2. UPDATE chat_jobs SET status='cancelled', completed_at = now() WHERE id = job.id
3. chatQueue.removeRepeatableByKey(jobKey)  (if still queued)
   else: signal worker via Redis pub/sub key 'chat:cancel:<jobId>' (worker's polling cancel-flag)
4. walletService.releaseHold(job.wallet_hold_id, 'user_cancelled')  (idempotent)
5. emit chat.cancelled
6. sseHub.publish(jobId, { event: 'cancelled', data: { reason: 'user_cancelled' } })
7. Respond 200 { jobId, status: 'cancelled' }
```

Worker behaviour on cancel: it checks the cancel flag at every chunk-write boundary, breaks the provider stream, and exits the agent loop without writing the assistant message. Already-streamed text is **not** persisted.

Timeout semantics:
- `USER_CANCELLED` is only emitted for explicit user/admin cancel.
- `STREAM_TIMEOUT` is emitted when stream timers expire.
- Total timeout starts with the plan `streamTimeoutMs` and is extended to `streamPostFirstChunkTimeoutMs` after first chunk.
- Inactivity timeout (`streamInactivityTimeoutMs`) remains active throughout streaming and tool execution.

---

## E. Worker Lifecycle (`chat.worker.ts`)

```
on(job 'process'):
  ctx = setupContext(job.data)                         // logger child, jobId, userId
  try {
    UPDATE chat_jobs SET status='processing', started_at=now()
    sseHub.publish(jobId, 'processing', { agentSlug, modelId })

    ── Smart Router (Module 10) ──────────────────────
    classification = await router.classify(content, options)
    agent          = router.dispatchAgent(classification, planSnapshot.agentAccess)
    model          = router.selectModel(classification, planSnapshot.modelAccess)

    ── Agent loop ────────────────────────────────────
    iter = 0
    while iter++ < MAX_ITERATIONS (10):
      stream = provider.callStreaming({ model, messages, tools, options })
      for chunk of stream:
        if cancelFlag(jobId) → break loop
        if chunk.type === 'text':
          sseHub.publish(jobId, 'chunk', { content: chunk.text })
        if chunk.type === 'tool_call':
          sseHub.publish(jobId, 'tool_call', { name, args, callId })
          result = await tool.execute(args, ctx)
          sseHub.publish(jobId, 'tool_result', { callId, summary })
          inject result into next iteration's messages
          continue
        if chunk.type === 'finish':
          break loop

    ── Persist ───────────────────────────────────────
    assistantMessageId = await messageService.createAssistantMessage(...)
    artifacts          = await artifactService.createIfAny(ctx.collectedArtifacts)
    sseHub.publish(jobId, 'artifact', ...)            // per artifact

    ── Wallet confirm ────────────────────────────────
    actualCost = creditCalculator.calculateCost({ ...tokens, planDiscount, modelId, agentSlug })
    await walletService.confirmDeduction(walletHoldId, { actualCost, ...tokens, modelId, agentSlug, jobId, messageId: assistantMessageId })

    ── Usage record (single writer) ──────────────────
    await usageTracker.record({ ... })                // see Module 6 contract

    ── Done ──────────────────────────────────────────
    UPDATE chat_jobs SET status='completed', completed_at=now(), result_message_id=assistantMessageId, artifact_ids=...
    sseHub.publish(jobId, 'usage', { tokensUsed, creditsDeducted, walletBalanceAfter })
    sseHub.publish(jobId, 'done', { messageId: assistantMessageId, conversationId, status: 'completed' })
    emit chat.completed
  } catch (err) {
    if attempts < maxAttempts && retryable(err):
      throw err                                        // BullMQ retries with backoff
    UPDATE chat_jobs SET status='failed', completed_at=now(), error_code=mapErr(err), error_message=err.message
    await walletService.releaseHold(walletHoldId, 'worker_failed')
    sseHub.publish(jobId, 'error', { code: mapErr(err), message: 'Something went wrong on our side. We have been notified.' })
    emit chat.completed (status='failed')
    logger.error('chat_worker_failed', { jobId, err })
  } finally {
    sseHub.close(jobId)                                // after a 5-min retention for late subscribers
  }
```

Retryable errors: provider 5xx, network timeouts. **Non-retryable:** validation, content-policy, `INVALID_API_KEY` from provider, deliberate cancel.

---

## F. File Worker (`file.worker.ts`)

Triggered when Module 8's `POST /files/upload` enqueues a `file` job.

```
on(job 'process'):
  file = SELECT * FROM files WHERE id = $1
  text = await unstructured.parse(file.storage_path, file.file_type)
  UPDATE files SET extracted_text = text, processing_status='vectorising'

  if file.size_within_vector_threshold:
    embeds = await embedder.embed(text)
    await qdrant.upsert({ collection: `user_${userId}`, points: embeds })
    UPDATE files SET vectorised = true

  UPDATE files SET processing_status='ready'
  emit file.ready
```

On failure: `processing_status='failed'`, `error_message` set; user sees the failure on `GET /files/:id/status`.

---

## G. Notification Worker (`notification.worker.ts`)

Pulls a job, calls `mailer.send(template, vars)`. On failure, retries with exponential backoff up to 5 attempts, then dead-letters into `notification:dlq` for admin inspection.

No direct user / admin routes. Notifications are triggered by other modules' events (e.g. `auth.registered` → welcome email).

---

## H. Admin Routes

Base: `/api/v1/admin/system/queues`. `requireAdmin`. Postman group: **Module 7 - Admin Queues Contracts**.

### `GET /admin/system/queues`

Snapshot of all three queues.

**200 OK**
```ts
{
  queues: [
    { name: 'chat',         active: 12, waiting: 3, completed: 41210, failed: 7, delayed: 0 },
    { name: 'file',         active: 1,  waiting: 0, completed: 9201,  failed: 2, delayed: 0 },
    { name: 'notification', active: 0,  waiting: 0, completed: 18432, failed: 0, delayed: 0 }
  ]
}
```

### `POST /admin/system/queues/:name/retry-failed`

Body `{ reason: string }` (audited). Retries every job in the failed bin for the named queue. Returns the count.

**200 OK** `{ retried: 7 }`

**Errors:** `400 INVALID_QUEUE_NAME`, `400 REASON_REQUIRED`.

---

## I. SSE Hub & Multi-Process Future

Today the API runs in a single process; `sseHub.service.ts` is a process-local `EventEmitter` with a per-jobId ring buffer. When we add a second API process or split the worker into its own host:

- Replace the local emitter with a Redis pub/sub channel `sse:job:<jobId>` that the worker publishes to and any API process can subscribe to.
- The ring buffer moves to a Redis Stream (`XADD … MAXLEN ~ 256`) so reconnects can replay the last few events from any process.
- No route or client change required — the hub interface stays the same.

The **client never sees this transition.**

---

## J. Error Code Reference (Module 7-specific)

| Code | HTTP | Source |
|---|---|---|
| `CONVERSATION_NOT_FOUND` | 404 | `POST /chat` |
| `ATTACHED_FILE_NOT_READY` | 409 | `POST /chat` |
| `AGENT_NOT_ALLOWED` | 403 | `POST /chat` |
| `MODEL_NOT_ALLOWED` | 403 | `POST /chat` |
| `JOB_ENQUEUE_FAILED` | 500 | `POST /chat` (BullMQ failure) |
| `JOB_NOT_FOUND` | 404 | `GET /chat/stream/:jobId`, `GET /chat/job/:jobId` |
| `JOB_NOT_OWNED` | 403 | SSE / status (caller doesn't own the job) |
| `NO_ACTIVE_JOB` | 404 | `POST /chat/:conversationId/cancel` |
| `INVALID_QUEUE_NAME` | 400 | `POST /admin/system/queues/:name/retry-failed` |

All registered in `src/utils/errors.ts` as `Errors.*` factories per [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

---

## K. Security Notes

| Concern | Mitigation |
|---|---|
| User reads another user's stream | SSE controller checks `chat_jobs.user_id === req.user.id` before subscribing. Job ids are unguessable UUIDv7. |
| Replay attack on enqueue | `(userId, conversationId, clientMessageId)` UNIQUE-checked over 24 h. |
| Stream poisoning | Workers only call `sseHub.publish(jobId, ...)` on jobs they own. Hub validates job ownership by job id existing in BullMQ. |
| Provider key leak via tool result | Tool results are summarised to ≤ 500 chars before publishing on SSE; full result stays in worker memory for the agent loop. |
| Wallet over-deduct on retry | `confirmDeduction` is idempotent on `(walletHoldId)`; second call sees the hold already settled and returns no-op. |
| Worker crash mid-run | Hold released by Module 4's janitor after 30 min. `chat_jobs.status` left at `processing` until janitor flips it to `failed`. |
| Cancel race vs done | UPDATE … SET status='cancelled' WHERE status IN ('queued','processing','streaming') — if worker already wrote `completed`, cancel is a no-op (`404 NO_ACTIVE_JOB`). |
| SSE token in URL | We use Bearer JWT in headers, not query param. Nginx must NOT log the `Authorization` header (already redacted via `LOG_REDACT` config). |
