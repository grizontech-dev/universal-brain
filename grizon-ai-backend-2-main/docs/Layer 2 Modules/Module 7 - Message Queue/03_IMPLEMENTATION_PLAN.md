# 03 — Implementation Plan

Concrete, ordered build for Module 7. Modules 1, 2, 3, 4, 5 are required upstream. Modules 6, 8, 9, 10 can ship in parallel — Module 7 has clear seams to each.

## Files to Create

| Path | Purpose |
|---|---|
| `src/types/chatJob.d.ts` | `ChatJobPayload`, `ChatJobStatus`, `ChatJobRecord` |
| `src/types/fileJob.d.ts` | `FileJobPayload` |
| `src/types/notificationJob.d.ts` | `NotificationJobPayload` |
| `src/config/queue.ts` | `QUEUE_NAMES = ['chat','file','notification']`, `JOB_OPTS` per queue, `HEARTBEAT_MS = 15000`, `WORKER_CONCURRENCY` (env-driven) |
| `src/queues/chat.queue.ts` | BullMQ `Queue('chat', { connection: redis, defaultJobOptions })` |
| `src/queues/file.queue.ts` | same pattern |
| `src/queues/notification.queue.ts` | same pattern |
| `src/services/chatJob.service.ts` | `enqueueChat(payload)` — idempotent on `(userId, conversationId, clientMessageId)`. Uses single transaction: SELECT existing → INSERT chat_jobs → `chatQueue.add` |
| `src/services/sseHub.service.ts` | `subscribe(jobId, fn)`, `publish(jobId, event, data)`, `close(jobId)`. In-memory `Map<jobId, Subscriber[]>` + ring buffer `Map<jobId, Event[]>` |
| `src/services/jobStatus.service.ts` | `getJobSnapshot(jobId, requestingUserId)` — read `chat_jobs` + check ownership |
| `src/workers/chat.worker.ts` | The big one. See [02 §E](02_QUEUES_WORKERS_AND_SSE.md). Calls Module 10 router, Module 4 wallet, Module 6 usage, Module 8 message/artifact services. |
| `src/workers/file.worker.ts` | Unstructured.io parse → Qdrant embed |
| `src/workers/notification.worker.ts` | Mailer adapter; DLQ on max-attempts exhausted |
| `src/routes/user/chat.routes.ts` | 4 routes (POST, stream, status, cancel) |
| `src/routes/admin/queues.routes.ts` | 2 routes |
| `src/controllers/user/chat.controller.ts` | thin |
| `src/controllers/admin/queues.controller.ts` | thin |
| `src/events/queue.events.ts` | typed emitter |
| `src/db/migrations/021_chat_jobs.sql` | id TEXT PK, user_id, conversation_id, client_message_id, status, attempts, max_attempts, result_message_id, artifact_ids JSONB, error_*, started/completed/created. UNIQUE(user_id, conversation_id, client_message_id). Index (user_id, created_at desc). |
| `test/unit/services/chatJob.service.test.ts` | Idempotency: same (userId, convId, clientMsgId) returns the existing job; concurrent calls don't create duplicates |
| `test/unit/services/sseHub.service.test.ts` | Subscribe → publish → receive; ring buffer replay; close |
| `test/integration/routes/chat.user.routes.test.ts` | POST /chat returns jobId; GET /chat/stream/:jobId receives `processing` → `chunk` → `done`; cancel mid-stream |
| `test/integration/routes/queues.admin.routes.test.ts` | GET /admin/system/queues snapshot; POST retry-failed |
| `test/integration/workers/chat.worker.test.ts` | End-to-end with a stub provider; success path, retry path, cancel path |

## Files to Modify

| Path | Change |
|---|---|
| `src/app.ts` | No middleware-pipeline change. Mount user `/chat/*` and admin `/queues/*` route files. |
| `src/routes/user/index.ts` | `userRoutes.use('/chat', chatRoutes)` |
| `src/routes/admin/index.ts` | `adminRoutes.use('/queues', adminQueuesRoutes)` |
| `src/utils/errors.ts` | Add `Errors.conversationNotFound()`, `Errors.attachedFileNotReady()`, `Errors.agentNotAllowed()`, `Errors.modelNotAllowed()`, `Errors.jobEnqueueFailed()`, `Errors.jobNotFound()`, `Errors.jobNotOwned()`, `Errors.noActiveJob()`, `Errors.invalidQueueName()` |
| `src/services/wallet.service.ts` (Module 4) | `confirmDeduction` and `releaseHold` must be idempotent on `holdId`. If Module 4 already shipped them idempotent, no change. Otherwise add the idempotency guard now — flag in PR. |
| `src/services/auth.service.ts` (Module 1) | `register` / `login_new_device` / `password_changed` / `banned` already emit events; ensure each emit triggers `notificationQueue.add(template, vars)`. Wire the listener in `src/events/index.ts`. |
| `docs/LLM_NEW_MODULE_PROMPT.md` | Add Postman groups `Module 7 - User Chat Contracts` and `Module 7 - Admin Queues Contracts` under "Postman groups currently include". |
| `grizon-ai-backend-2.postman_collection.json` | 4 user + 2 admin requests. |

## Reused Utilities (do not re-implement)

- `src/infra/redis.ts` — BullMQ connection
- `src/infra/postgres.ts` — `withTransaction` for the enqueue tx
- `src/utils/{response,errors,logger}.ts`
- Module 4's `walletService.confirmDeduction` / `releaseHold`
- Module 6's `usageTracker.record`
- Module 8's `messageService.createUserMessage` / `createAssistantMessage`, `artifactService.createArtifact`
- Module 9's `sanitiserMiddleware` (already at slot 12; just register the `/chat` body schema)
- Module 10's `router.classify`, `router.dispatchAgent`, `router.selectModel`
- `src/models/provider.ts` for streaming + failover

## Implementation Order

1. **Migration 021** — `chat_jobs` table with indexes. Verify with `psql \\d chat_jobs`.
2. **Types** — three `.d.ts` files; this is the contract every other Module-7 file imports.
3. **`config/queue.ts`** — pure data; `JOB_OPTS` reads `WORKER_CONCURRENCY` from env.
4. **Queue files** — three thin BullMQ Queue instances. No logic.
5. **`sseHub.service.ts`** — process-local emitter + ring buffer. Unit-test before wiring anything to it.
6. **`chatJob.service.ts → enqueueChat`** — idempotent insert + `chatQueue.add`. Unit-test concurrency.
7. **`jobStatus.service.ts`** — read snapshot; ownership check.
8. **Error helpers** — add the nine new `Errors.*` factories.
9. **User route + controller (`POST /chat`, `GET /chat/stream/:jobId`, `GET /chat/job/:jobId`, `POST /chat/:conversationId/cancel`)** — controller is thin; controller calls `chatJobService.enqueueChat`, then the SSE stream is just a controller that subscribes to the hub.
10. **Notification worker** — smallest worker; ship first to validate the `infra/redis` BullMQ wiring and the mailer adapter. Hook to Module 1's emitted auth events.
11. **File worker** — parse + embed; wire to Module 8's `POST /files/upload` once Module 8 lands. Until then, ship with a stub test using a sample PDF.
12. **`chat.worker.ts`** — last because it pulls from every other module:
    - Smart router (Module 10) — if not yet shipped, stub `router.classify` to return a fixed `agentSlug='chat'` + `modelId='claude-haiku-4-5'`.
    - Provider — implement Anthropic streaming first; OpenAI / Google parallel.
    - Tool executor — start with web_search via Module 8's tool registry stub.
    - Wallet confirm — call Module 4's `confirmDeduction`.
    - Usage record — call Module 6's `usageTracker.record`.
13. **Admin routes** — short queue snapshot + retry endpoint.
14. **Tests** — unit first; then integration with a stub provider in `test/integration/workers/chat.worker.test.ts`.
15. **Postman + status report** — final.

## Verification

```bash
npm run migrate                                          # apply 021
npm run build
npm test -- test/unit/services/chatJob.service.test.ts
npm test -- test/unit/services/sseHub.service.test.ts
npm test -- test/integration/routes/chat.user.routes.test.ts
npm test -- test/integration/workers/chat.worker.test.ts
npm test -- test/integration/routes/queues.admin.routes.test.ts
```

Manual smoke (with a real provider key in dev):

1. As a Pro user, `POST /api/v1/chat { conversationId, clientMessageId, content: 'Hello' }` → 201 with `jobId`.
2. Open `EventSource('/api/v1/chat/stream/<jobId>')` in the browser dev console with the Bearer token in the `Authorization` header (use a fetch-based EventSource shim if the standard one can't set headers — note in client docs).
3. Observe events: `processing` → many `chunk` → `usage` → `done`.
4. Verify `chat_jobs` row is `status='completed'`, `result_message_id` is set; `messages` row exists; `wallet_transactions` has a `deduct` row; `usage_records` has one row.
5. Repeat the POST with the **same** `clientMessageId` → server returns the original `jobId`, no new BullMQ job, no extra hold.
6. New POST → mid-stream call `POST /chat/<convId>/cancel` → SSE receives `cancelled`; `wallet_transactions` shows a `refund` row; no assistant message persisted.
7. Force the provider to error (set `ANTHROPIC_API_KEY=bad`) → SSE receives `error` after retries exhausted; `chat_jobs.status='failed'`; hold released; `usage_records` row written with `status='failed'`.
8. As admin, `GET /api/v1/admin/system/queues` → reasonable counts. Force a job into the failed bin (kill provider mid-call thrice) and `POST /api/v1/admin/system/queues/chat/retry-failed { reason: 'transient outage' }` → those jobs return to active.
9. Stop Redis → POST /chat returns `500 INTERNAL_ERROR` envelope (Redis down means BullMQ unavailable; we don't fall back). Hold is **not** opened (controller calls `enqueueChat` after the middleware; if BullMQ throws, it explicitly releases the hold first).

## Risks / Notes

- **Multi-process scaling:** the in-memory `sseHub` works only in single-process mode. Document this in `LLM_NEW_MODULE_PROMPT.md` once we add a second API process; swap to Redis pub/sub at that time. Worker stream events to Redis Streams `XADD sse:job:<jobId> *` for replay.
- **Long conversations + provider streaming:** if the provider drops the connection mid-stream, BullMQ retries the *whole* job. We do not partial-resume from the last token. Acceptable today (rare in practice); revisit if `chat_worker_partial_drop` log line gets noisy.
- **Tool-call loops:** worker caps at `MAX_ITERATIONS = 10`. Beyond that the agent loop returns "I couldn't complete that" with whatever was streamed so far. Tests cover the cap.
- **Cancel before worker reads cancel-flag:** there is a small window (≤ 50 ms) where a chunk may stream after the cancel was published. The client must accept that `cancelled` may arrive after the last `chunk`; the assistant message is not persisted regardless.
- **Order of operations on success path:** wallet confirm → usage record → chat_jobs row update → SSE `usage` + `done`. If wallet confirm fails (extremely unlikely with idempotency), the worker falls back to `releaseHold`, marks the job `failed`, and emits `error`. The SSE client distinguishes via the final event.
- **Provider tokens in logs:** redact `Authorization` and any raw provider response body in worker logs. The `logger` config already redacts; verify with `npm test -- test/unit/utils/logger.test.ts` once.
- **Idempotency window:** 24 h. After that, the same `clientMessageId` enqueues a new job (rare; mostly affects long-lived browser sessions). Document in client SDK README.
- **DLQ for notifications:** 5 attempts then `notification:dlq`. No automatic alarm; admin checks `GET /admin/system/queues` and runs `retry-failed` manually. Add an auto-alert later via Module 6's `analytics/errors`.
- **Worker concurrency:** start at `WORKER_CONCURRENCY=4` per queue. Profile under load before raising. Each chat worker holds a streaming HTTP connection to the provider, so concurrency × providers × API processes = total open sockets.
