# Grizon AI — Chat Integration Guide

> For full request/response schemas and example payloads, refer to the Postman collection.

---

## 1. Architecture Overview

Grizon AI uses an **async two-step chat pattern**:

```
Frontend                     Backend
   │                            │
   │  POST /chat  (enqueue)     │
   │ ─────────────────────────► │  Validates, queues job, returns jobId
   │ ◄─────────────────────────  │
   │  { jobId, streamUrl }       │
   │                            │
   │  GET /chat/stream/:jobId    │
   │ ─────────────────────────► │  Opens SSE connection
   │ ◄─────────────────────────  │  Streams events until "done"
```

**Never poll.** Always connect to the SSE stream immediately after receiving `jobId`.

---

## 2. Authentication

Every request requires:

```
Authorization: Bearer <access_token>
x-platform:    web
Content-Type:  application/json
```

See [auth-flow-nextjs.md](./auth-flow-nextjs.md) for the full token management guide.

---

## 3. Boot — Load the Catalogue

Before rendering the chat UI, fetch the catalogue. This returns all agents, models, and feature flags available to the current user's plan.

```
GET /api/v1/catalogue
```

Response shape:
```json
{
  "agents": [ { "slug": "chat", "displayName": "Chat", ... } ],
  "models": [ { "modelId": "claude-3-5-sonnet-...", "displayName": "...", "tier": "high", ... } ],
  "featureFlags": {
    "modelPicker": true,
    "fileUpload": true,
    "webSearch": false
  },
  "agentAccess": ["chat", "research", "code"],
  "modelAccess": ["claude-3-5-sonnet-...", "gpt-4o"]
}
```

Use this to:
- Populate the agent selector
- Populate the model picker (if `featureFlags.modelPicker` is true)
- Show/hide the file upload button (if `featureFlags.fileUpload` is true)

```
GET /api/v1/catalogue/agents/:slug    — load a single agent's detail
```

---

## 4. Conversations

All chat messages belong to a conversation. Create one before the first message.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/conversations` | Create a new conversation |
| GET | `/api/v1/conversations` | List all conversations |
| GET | `/api/v1/conversations/:id` | Get a single conversation |
| PATCH | `/api/v1/conversations/:id` | Update title etc. |
| DELETE | `/api/v1/conversations/:id` | Delete a conversation |
| POST | `/api/v1/conversations/:id/summarise` | Trigger summarisation |
| GET | `/api/v1/conversations/:id/messages` | List messages in a conversation |

---

## 5. Chat Flow

### Step 1 — Enqueue the message

```
POST /api/v1/chat
```

Request body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `conversationId` | UUID | Yes | Must exist |
| `clientMessageId` | UUID | Yes | Generate with `crypto.randomUUID()` — idempotency key |
| `content` | string | Yes | Max 20,000 characters |
| `mode` | `"auto"` \| `"agent"` | No | Default `"auto"` |
| `agentSlug` | string | When `mode="agent"` | Must be in `agentAccess` list |
| `modelId` | string | No | Requires `featureFlags.modelPicker = true` |
| `attachedFileIds` | UUID[] | No | File IDs from the upload endpoint |
| `options.temperature` | number 0–2 | No | |
| `options.customSystemPrompt` | string | No | Max 4,000 chars |
| `options.searchContextSize` | `"low"` \| `"medium"` \| `"high"` | No | |

Response (`201`):

```json
{
  "jobId": "job_abc123",
  "status": "queued",
  "streamUrl": "/api/v1/chat/stream/job_abc123"
}
```

### Step 2 — Connect to the SSE stream

Open immediately after receiving `jobId`. No polling.

```
GET /api/v1/chat/stream/:jobId
Accept: text/event-stream
```

---

## 6. SSE Events Reference

Each event arrives as:
```
event: <name>
data: { ...payload }
```

| Event | When | Payload |
|---|---|---|
| `queued` | Job is waiting in queue | `{ position: 0 }` |
| `processing` | Worker picked up the job | `{ agentSlug, modelId, modelProvider }` |
| `chunk` | Streaming text delta | `{ content: "..." }` |
| `tool_call` | Agent is calling a tool | `{ toolId, callId, arguments }` |
| `tool_result` | Tool finished | `{ callId, output, durationMs }` |
| `usage` | Token counts (before done) | `{ tokensUsed: { inputFresh, inputCached, output, cacheWrite } }` |
| `done` | Generation complete | `{ messageId, conversationId, status: "completed" }` |
| `error` | Generation failed | `{ code, message }` |
| `cancelled` | Job was cancelled | `{ reason: "user_cancelled" }` |
| `heartbeat` | Keep-alive ping (~30s) | `{}` |

Close the connection on `done`, `error`, or `cancelled`.

---

## 7. Cancel a Job

```
POST /api/v1/chat/:conversationId/cancel
```

Cancels the most recent active job for that conversation. Returns `{ jobId, status: "cancelled" }`.

### Check job status without streaming

```
GET /api/v1/chat/job/:jobId
```

Returns `{ jobId, status, agentSlug, modelId, ... }`. Use this to recover status after a dropped SSE connection.

---

## 8. File Uploads

Requires `featureFlags.fileUpload = true`.

```
POST /api/v1/files/upload        JSON body (contentBase64) — returns { file: { id, processingStatus, ... } }
GET  /api/v1/files/:id           poll processingStatus (pending | processing | ready | failed)
DELETE /api/v1/files/:id         delete a file (204)
```

Upload body:

```json
{
  "conversationId": "uuid-or-null",
  "fileName": "report.pdf",
  "fileType": "application/pdf",
  "fileSize": 204800,
  "contentBase64": "JVBERi0x..."
}
```

Poll every 2s until `processingStatus === "ready"` (max 60s). Pass ready file `id` values in `attachedFileIds` when enqueueing chat (`content` is required; file-only messages are not supported).

---

## 9. Wallet & Usage

```
GET  /api/v1/wallet                      current balance + credit info
GET  /api/v1/wallet/transactions         transaction history
GET  /api/v1/wallet/transactions/:id     single transaction
POST /api/v1/wallet/topup               add credits

GET  /api/v1/usage/summary               credit usage summary for current period
GET  /api/v1/usage/history               per-message usage history
```

Check wallet balance before or after sending messages. A `402` from `/chat` means the user is out of credits.

---

## 10. Complete sendMessage Implementation

```ts
const api = axios.create({ baseURL: '/api/v1' })

// attach token + platform headers via interceptor (see auth guide)

async function sendMessage({
  conversationId,
  content,
  agentSlug,
  modelId,
  attachedFileIds = [],
  onChunk,
  onDone,
  onError,
}: SendMessageArgs) {
  // 1. Enqueue
  const { data } = await api.post('/chat', {
    conversationId,
    clientMessageId: crypto.randomUUID(),
    content,
    mode: agentSlug ? 'agent' : 'auto',
    agentSlug: agentSlug ?? null,
    modelId: modelId ?? null,
    attachedFileIds,
  })

  const { jobId } = data.data

  // 2. Stream
  const es = new EventSource(`/api/v1/chat/stream/${jobId}`, {
    withCredentials: true,
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })

  let fullContent = ''

  es.addEventListener('chunk', (e) => {
    const { content } = JSON.parse(e.data)
    fullContent += content
    onChunk(content)
  })

  es.addEventListener('done', (e) => {
    es.close()
    onDone({ fullContent, ...JSON.parse(e.data) })
  })

  es.addEventListener('error', (e) => {
    es.close()
    onError(JSON.parse(e.data))
  })

  es.addEventListener('cancelled', () => {
    es.close()
  })

  return { jobId, cancel: () => api.post(`/chat/${conversationId}/cancel`) }
}
```

> **Note:** The native browser `EventSource` doesn't support custom headers. Use `@microsoft/fetch-event-source` or a similar library to attach the `Authorization` header.

---

## 11. Error Codes

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `NOT_AUTHENTICATED` | Missing or expired access token → refresh |
| 402 | `INSUFFICIENT_CREDITS` | User out of credits |
| 403 | `AGENT_NOT_ALLOWED` | Agent not on user's plan |
| 403 | `MODEL_NOT_ALLOWED` | Model not on user's plan |
| 403 | `FEATURE_NOT_AVAILABLE` | Feature flag disabled for plan |
| 422 | `VALIDATION_ERROR` | Invalid request body |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |

---

## 12. Quick Reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/catalogue` | Agents, models, feature flags for current plan |
| GET | `/api/v1/catalogue/agents/:slug` | Single agent detail |
| POST | `/api/v1/conversations` | Create conversation |
| GET | `/api/v1/conversations` | List conversations |
| GET | `/api/v1/conversations/:id/messages` | Message history |
| DELETE | `/api/v1/conversations/:id` | Delete conversation |
| POST | `/api/v1/chat` | Enqueue chat message → returns jobId |
| GET | `/api/v1/chat/stream/:jobId` | SSE stream |
| GET | `/api/v1/chat/job/:jobId` | Poll job status |
| POST | `/api/v1/chat/:conversationId/cancel` | Cancel active job |
| POST | `/api/v1/files/upload` | Upload attachment |
| GET | `/api/v1/wallet` | Credit balance |
| GET | `/api/v1/usage/summary` | Usage summary |
