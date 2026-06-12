# 01 — Overview

## Mission

Module 7 turns `POST /chat` from a long-blocking HTTP call into a **fire-and-stream** operation. It accepts the user's message, passes the gateway gauntlet (auth, plan, feature, rate, credit, sanitise), enqueues a job, and returns a `jobId` in milliseconds. The worker then runs the smart router, calls the LLM, streams tokens through SSE, executes tool calls, persists the assistant message + artifacts, confirms the wallet deduction, and writes the usage record.

Without Module 7 the user would hold an HTTP connection open for 30+ seconds, mobile networks would time out, and a refresh would charge the user twice. Module 7 is what makes long-running LLM work feel reliable.

## Scope

### In scope
- `chat` queue + `chat.worker.ts` — runs the agent loop end-to-end
- `file` queue + `file.worker.ts` — parses/vectorises uploaded files (called from Module 8's `POST /files/upload`)
- `notification` queue + `notification.worker.ts` — async transactional emails / push (welcome, new-device, password-changed, etc.)
- `chat_jobs` table — status mirror; BullMQ alone can't be queried by `(userId, conversationId)` cheaply
- 3 user routes: `POST /chat`, `GET /chat/stream/:jobId`, `POST /chat/:conversationId/cancel`
- Polling fallback: `GET /chat/job/:jobId` (status snapshot, no streaming)
- 2 admin routes: `GET /admin/queues`, `POST /admin/queues/:name/retry-failed`
- `sseHub.service.ts` — process-local pub/sub between workers and SSE responders (Redis pub/sub when scaled to multiple API processes)
- Single-writer call to `usageTracker.record()` after every LLM call
- Wallet `confirmDeduction` / `releaseHold` after every job
- Janitor: orphan-hold release reuses the same 30-min window Module 4's plan documents

### Out of scope
- Smart Router internals (Module 10 — invoked by the worker)
- Agent loop internals (`src/agents/*` — invoked by the worker)
- Tool implementations (`src/tools/*` — invoked by agents)
- Rolling conversation summarisation (Module 8)
- Provider failover policy (`src/models/provider.ts` — invoked by the worker; failover lives there)
- Webhooks for chat completion to third parties (no programmatic API; first-party only)

## Inputs

| Source | What it carries |
|---|---|
| `req.user`, `req.session`, `req.platform` (Module 1) | Identity bundle persisted onto the job |
| `req.plan` (Module 2) | Frozen plan snapshot used inside the worker so a mid-flight upgrade doesn't change billing |
| `req.wallet.holdId` (Module 4) | The pending wallet hold opened by `creditBudgetMiddleware` at slot 11 |
| `req.body.content`, `attachedFileIds`, `agentSlug?`, `modelId?` | Validated by Module 9's `sanitiserMiddleware` (slot 12) before enqueue |
| `req.body.clientMessageId` | Idempotency key; if a job already exists for `(userId, conversationId, clientMessageId)` it is returned instead of a new one |

## Outputs

- **Enqueue response (HTTP):** universal envelope `{ data: { jobId, status: 'queued' } }`
- **SSE events** (see [02_QUEUES_WORKERS_AND_SSE.md §C](02_QUEUES_WORKERS_AND_SSE.md)):
  - `queued`, `processing`, `status`, `chunk`, `tool_call`, `tool_result`, `artifact`, `usage`, `done`, `error`, `heartbeat`
- **Persisted side-effects:**
  - One assistant `messages` row per job (Module 8)
  - Zero or more `artifacts` rows (Module 8 — owns the table)
  - One `wallet_transactions` row of `type='deduct'` (Module 4)
  - One `usage_records` row (Module 6)
  - `chat_jobs` row updated through its lifecycle
- **Events emitted on `src/events/queue.events.ts`:**
  - `chat.enqueued` `{ jobId, userId, conversationId }`
  - `chat.started` `{ jobId, agentSlug, modelId }`
  - `chat.completed` `{ jobId, status, durationMs }`
  - `chat.cancelled` `{ jobId, byActor }`

All HTTP responses use the universal envelope from [`Project Foundation/03_REQUEST_RESPONSE.md`](../../Project%20Foundation/03_REQUEST_RESPONSE.md). Errors use `Errors.*` from [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

## Type Contracts

```ts
// src/types/chatJob.d.ts
export interface ChatJobPayload {
  userId: string;
  conversationId: string;
  messageId: string;                 // pre-created user message row (Module 8)
  clientMessageId: string;           // idempotency key
  sessionId: string;                 // Module 1
  platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
  planSnapshot: Plan;                // frozen (Module 2)
  walletHoldId: string;              // from creditBudgetMiddleware (Module 4)
  content: string;
  attachedFileIds: string[];
  agentSlug: string | null;          // null = auto-route
  modelId: string | null;            // null = auto-select
  options: {
    temperature?: number;            // Power-user; gated by Module 3 featureFlags.temperatureControl
    customSystemPrompt?: string;     // Power-user; gated by featureFlags.customSystemPrompt
    searchContextSize?: 'low' | 'medium' | 'high';
  };
  estimatedTokens: number;           // used by creditBudgetMiddleware before enqueue
}

export type ChatJobStatus =
  | 'queued' | 'processing' | 'streaming' | 'completed' | 'failed' | 'cancelled';

export interface ChatJobRecord {
  id: string;                        // = BullMQ job id; mirrored as chat_jobs.id
  userId: string;
  conversationId: string;
  status: ChatJobStatus;
  attempts: number;
  maxAttempts: number;               // 3 default, 1 for code-execution-heavy agents
  resultMessageId: string | null;    // assistant messages.id when completed
  artifactIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
```

```ts
// src/types/fileJob.d.ts
export interface FileJobPayload {
  userId: string;
  fileId: string;                    // files.id (Module 8)
  storagePath: string;
  fileType: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'png' | 'jpg' | 'mp4';
  fileSize: number;
}
```

```ts
// src/types/notificationJob.d.ts
export interface NotificationJobPayload {
  userId: string;
  template: 'welcome' | 'new_device' | 'password_changed' | 'banned' | 'topup_succeeded' | 'rate_limit_flagged';
  vars: Record<string, string | number>;
  channels: Array<'email' | 'push'>; // push reserved for future
}
```

## Plan-Shape Extension (touches Module 2)

None. The frozen `req.plan` snapshot already carries everything the worker needs (`creditDiscount`, `featureFlags`, `featureLimits`, `limits`, `modelAccess`, `agentAccess`).

## File Structure

```
src/
├── config/
│   └── queue.ts                          ← QUEUE_NAMES, JOB_OPTS (attempts, backoff), HEARTBEAT_MS, WORKER_CONCURRENCY
├── queues/
│   ├── chat.queue.ts                     ← BullMQ Queue('chat', …)
│   ├── file.queue.ts
│   └── notification.queue.ts
├── workers/
│   ├── chat.worker.ts                    ← Agent loop + provider stream + tool calls + wallet confirm + usage record
│   ├── file.worker.ts                    ← Unstructured.io parse + Qdrant embed
│   └── notification.worker.ts            ← Calls mailer adapter
├── services/
│   ├── chatJob.service.ts                ← enqueue(payload) → returns jobId; idempotent on (userId, conversationId, clientMessageId)
│   ├── sseHub.service.ts                 ← Process-local emitter; subscribers keyed on jobId. Swap to Redis pub/sub when scaling.
│   └── jobStatus.service.ts              ← read-side helper for /chat/job/:jobId snapshot
├── routes/
│   ├── user/
│   │   └── chat.routes.ts                ← POST /chat, GET /chat/stream/:jobId, GET /chat/job/:jobId, POST /chat/:conversationId/cancel
│   └── admin/
│       └── queues.routes.ts              ← /api/v1/admin/queues/*
├── controllers/
│   ├── user/
│   │   └── chat.controller.ts
│   └── admin/
│       └── queues.controller.ts
├── events/
│   └── queue.events.ts                   ← typed emitter
└── db/
    └── migrations/
        └── 021_chat_jobs.sql             ← chat_jobs table; PK = job id (text); UNIQUE (user_id, conversation_id, client_message_id)
```

No middleware added — the queue layer reuses the existing pipeline (slots 1–12 from [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md)).

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | `req.user.id`, `req.session.id`, plus the SSE response carries `req.user.id` for authorisation on `GET /chat/stream/:jobId` |
| Module 2 — Plan & Subscription | Frozen `req.plan` snapshot serialised into the job; worker uses it for `modelAccess`, `agentAccess`, `creditDiscount` |
| Module 3 — Feature Flags | `requireFeatureWithLimit` (webSearch, codeExecution) on `POST /chat` if the body asks for those features. `requireFeature` for `temperatureControl`, `customSystemPrompt`, `modelPicker` |
| Module 4 — Credit Wallet | `creditBudgetMiddleware` opens the hold; worker calls `confirmDeduction` / `releaseHold`. Exception path: orphaned holds released by Module 4's janitor. |
| Module 5 — Rate Limit | Slot 10; over-quota requests 429 before Module 7 sees them |
| Module 6 — Usage Tracking | Single-writer of `usage_records` from `chat.worker.ts` |
| Module 8 — Conversation & Message | Worker writes the assistant `messages` row, artifacts, and rolls summary if context is too long |
| Module 9 — Sanitiser | Slot 12; `POST /chat` body is validated by `sanitiserMiddleware` before enqueue |
| Module 10 — Smart Router | Worker calls router's `classify`, `selectModel`, `dispatchAgent` once at start of job |
| `src/models/provider.ts` | Streaming + retry / failover at the LLM call site |
| `src/agents/*`, `src/tools/*` | Invoked by the worker |
| `src/infra/redis.ts` | BullMQ backing store + future SSE pub/sub |
| `src/utils/{response,errors,logger}.ts` | Standard envelope, `AppError`, structured logs |

## Modules That Will Use Module 7

| Downstream module | How |
|---|---|
| Module 8 — `POST /files/upload` | Enqueues a `file` job to parse + vectorise |
| Module 1 — Auth events (`auth.registered`, `auth.banned`, `auth.password_changed`, etc.) | Each emit triggers a `notification` job |
| Module 4 — Top-up succeeded | Triggers `notification` job for the receipt email |
| Frontend chat UI | Calls `POST /chat`, opens an EventSource on `/chat/stream/:jobId`, falls back to `GET /chat/job/:jobId` if SSE is blocked |
