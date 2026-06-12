# Module 7 — Status Report

## Module

- Name: Message Queue System
- Source docs: `docs/Layer 2 Modules/Module 7 - Message Queue/`
- Report date: 2026-05-07

## Current Status

- Stage: Implemented (foundation + routes + workers + tests + Postman + prompt/doc sync)
- Documentation set: Complete (01-03 + README + status report)
- Code implementation: Live queue scaffolding and route surface added
- Runtime readiness: Requires Redis for BullMQ queues/workers and migration `021_chat_jobs.sql`

## Delivered Surface

### New files

- `src/config/queue.ts`
- `src/types/chatJob.d.ts`
- `src/types/fileJob.d.ts`
- `src/types/notificationJob.d.ts`
- `src/queues/chat.queue.ts`
- `src/queues/file.queue.ts`
- `src/queues/notification.queue.ts`
- `src/services/chatJob.service.ts`
- `src/services/sseHub.service.ts`
- `src/services/jobStatus.service.ts`
- `src/controllers/user/chat.controller.ts`
- `src/controllers/admin/queues.controller.ts`
- `src/routes/user/chat.routes.ts`
- `src/routes/admin/queues.routes.ts`
- `src/events/queue.events.ts`
- `src/workers/chat.worker.ts`
- `src/workers/file.worker.ts`
- `src/workers/notification.worker.ts`
- `src/workers/background.scheduler.ts` (wallet janitor + `usage.cleanup` on 10-minute tick)
- `src/workers/usage.cleanup.worker.ts` (stale chat job recovery)
- `src/config/streamLimits.ts`
- `src/db/migrations/021_chat_jobs.sql`
- `src/db/migrations/028_module7_module6_bridge.sql`

### Modified files

- `src/services/chatJob.service.ts` (user message + job row in one transaction; emit after commit)
- `src/services/message.service.ts` (`createUserMessageWithClient` for transactional callers)
- `src/routes/user/index.ts`
- `src/routes/admin/index.ts`
- `src/utils/errors.ts`
- `src/services/wallet.service.ts`
- `test/integration/middleware/creditBudget.middleware.test.ts`
- `test/integration/middleware/rateLimit.middleware.test.ts`
- `test/unit/services/chatJob.service.test.ts`
- `test/unit/services/message.service.test.ts` (user message transactional helper)
- `grizon-ai-backend-2.postman_collection.json`
- `docs/LLM_NEW_MODULE_PROMPT.md`
- `docs/Layer 2 Modules/Module 7 - Message Queue/README.md`
- `docs/Layer 2 Modules/Module 7 - Message Queue/02_QUEUES_WORKERS_AND_SSE.md`
- `docs/Layer 2 Modules/Module 7 - Message Queue/03_IMPLEMENTATION_PLAN.md`

## Live Routes

### User (`/api/v1/chat`)

- `POST /api/v1/chat`
- `GET /api/v1/chat/stream/:jobId`
- `GET /api/v1/chat/job/:jobId`
- `POST /api/v1/chat/:conversationId/cancel`

### Admin (`/api/v1/admin/system/queues`)

- `GET /api/v1/admin/system/queues`
- `POST /api/v1/admin/system/queues/:name/retry-failed`

## Notes

- `POST /api/v1/chat` (via `chatJobService.enqueueChat`) persists the user turn with `messageService.createUserMessageWithClient` in the same transaction as `INSERT chat_jobs`, then calls `chatQueue.add`; duplicate `(userId, conversationId, clientMessageId)` within 24h replays the existing job without a second user row. `message.finalised` is emitted for the user message after commit.
- Idempotent settle behavior in wallet now uses a hold settlement key to avoid double-deduct/double-refund on retries.
- Module 6 usage for chat is written only from `chat.worker.ts` (`usageTracker.record`); `usage_records.request_id` is unique (idempotent per job).
- Cooperative cancel: `chat_jobs.cancel_requested`, Redis channel `chat:cancel:{jobId}`, queued jobs still release the hold in the API after marking the job cancelled.
- Chat jobs use BullMQ `attempts: 1` (no auto-retry after partial SSE).
- Background schedulers start from `src/index.ts` unless `ENABLE_BACKGROUND_SCHEDULERS=false` (defaults off when `NODE_ENV=test`).
