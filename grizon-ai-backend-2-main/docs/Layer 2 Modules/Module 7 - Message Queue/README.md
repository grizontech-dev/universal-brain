# Module 7 — Message Queue System

> Async chat / file / notification jobs via BullMQ; SSE streaming back to the client.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §9](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, types (`ChatJob`, `FileJob`, `NotificationJob`), file structure, dependencies |
| 2 | [02_QUEUES_WORKERS_AND_SSE.md](02_QUEUES_WORKERS_AND_SSE.md) | Enqueue contract, worker lifecycle, credit hold/confirm/release, SSE event protocol, retry/cancel/janitor, route contracts |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, BullMQ wiring, tests, verification |

## Status

- **Stage:** Implemented (queue foundation + routes + workers + docs artifacts)
- **Owner:** Backend
- **Last updated:** 2026-05-05

## Key Decisions

- **BullMQ on Redis.** Three queues: `chat`, `file`, `notification`. Workers can scale horizontally; today they run in-process alongside the API.
- **`POST /chat` returns `jobId` immediately.** All LLM work happens off the request thread. Frontend reconnects via SSE on `GET /chat/stream/:jobId` to receive tokens, status, artifacts, and the final usage payload.
- **Single writer of `usage_records`.** Module 7's chat worker is the only place that calls `usageTracker.record()` (see Module 6). No other module ever writes to that table.
- **Wallet hold/confirm pattern (locked).** `creditBudgetMiddleware` opens the hold at request time (slot 11). The worker calls `wallet.confirmDeduction(holdId, actualCost)` on success or `wallet.releaseHold(holdId, reason)` on failure. Janitor cleans up orphans after 30 min.
- **Idempotent enqueue.** `(userId, conversationId, clientMessageId)` is the dedupe key — refreshes / retries from the client never produce double charges.
- **SSE first, polling fallback.** `GET /chat/stream/:jobId` is the primary path. `GET /chat/job/:jobId` returns the latest status snapshot for clients on networks that strip SSE (e.g. some corporate proxies).
- **Cancel propagates.** `POST /chat/:conversationId/cancel` revokes the hold, marks the job `cancelled`, and the worker exits its provider stream cleanly.
- **Heartbeat every 15 s** on the SSE stream so intermediaries don't kill idle connections.

## Surface

- **3 user routes** under `/api/v1/chat/*`
- **2 admin routes** under `/api/v1/admin/system/queues/*`
- **0 middleware** added to the global pipeline (the credit hold is already at slot 11 from Module 4)
- **3 BullMQ queues** + **3 workers**
- **2 services:** `chatJob.service.ts` (enqueue), `sseHub.service.ts` (subscriber registry)
- **1 table:** `chat_jobs` (status mirror — BullMQ data alone isn't enough for cross-process queries)
- **Postman groups:** `Module 7 - User Chat Contracts`, `Module 7 - Admin Queues Contracts`

## Dependencies

- Module 1 — `req.user.id`, `req.session.id` recorded on the job
- Module 2 — frozen `req.plan` snapshot serialised onto the job (so worker uses the same plan even if the user upgrades mid-flight)
- Module 3 — `requireFeatureWithLimit('webSearch' | 'codeExecution')` runs *before* the enqueue route handler
- Module 4 — `creditBudgetMiddleware` opens the hold; `wallet.service.ts` confirm/release from the worker
- Module 5 — runs at slot 10; denied requests never reach Module 7's enqueue
- Module 6 — `usageTracker.record()` after every LLM call (single-writer)
- Module 8 — `conversation.service.ts` + `message.service.ts` are touched both at enqueue (create user message) and from the worker (create assistant message)
- Module 9 — `sanitiserMiddleware` (slot 12) validates the `/chat` body before enqueue
- Module 10 — Smart Router runs **inside the chat worker**, not at request time, so routing decisions are recorded with full context
- Provider SDKs in `src/models/provider.ts` (Anthropic, OpenAI, Google) — called by the worker
- Tools in `src/tools/*` — invoked by agents when the worker streams a tool-call
