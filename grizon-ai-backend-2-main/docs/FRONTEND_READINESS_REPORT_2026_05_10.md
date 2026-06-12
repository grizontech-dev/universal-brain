# Frontend Readiness Report — 2026-05-10
## grizon-ai-backend-2 | Backend ↔ Frontend Integration Spec

> **Purpose:** Definitive ground-truth contract for frontend implementation.  
> Includes bug-fix verification, exact API schemas, SSE payload shapes, error codes, and known gaps.  
> **Do not rely on the architecture doc alone** — several details differ from the spec.

---

## Table of Contents

1. [Bug Fix Verification](#1-bug-fix-verification)
2. [Global Rules (Every Request)](#2-global-rules-every-request)
3. [Standard Response Envelope](#3-standard-response-envelope)
4. [Auth Endpoints](#4-auth-endpoints)
5. [Chat Endpoints & SSE Contract](#5-chat-endpoints--sse-contract)
6. [Conversation & Message Endpoints](#6-conversation--message-endpoints)
7. [Artifact Endpoints](#7-artifact-endpoints)
8. [File Upload Endpoints](#8-file-upload-endpoints)
9. [Wallet & Credits Endpoints](#9-wallet--credits-endpoints)
10. [Usage Endpoints](#10-usage-endpoints)
11. [Memory Endpoints](#11-memory-endpoints)
12. [Plan & Subscription Endpoints](#12-plan--subscription-endpoints)
13. [Catalogue Endpoints](#13-catalogue-endpoints)
14. [Response Headers Reference](#14-response-headers-reference)
15. [Error Code Reference](#15-error-code-reference)
16. [Known Frontend Gaps](#16-known-frontend-gaps)

---

## 1. Bug Fix Verification

All four P1–P4 bugs from the audit are **confirmed fixed**. Do not re-open them.

| Bug | File(s) Changed | Status |
|-----|----------------|--------|
| **Bug 1** — Keepalive leaked across sessions | `models/providers/anthropic.ts`, `types/router.ts`, `router/index.ts` | ✅ Fixed — key now `keepalive:job:<jobId>` |
| **Bug 2** — `semanticCacheHit` misidentified prompt cache | `workers/chat.worker.ts`, `services/usageTracker.service.ts`, `types/usage.d.ts`, migration `038` | ✅ Fixed — `semanticCacheHit: false` in LLM path; new `promptCacheHit` field |
| **Bug 3** — `computeCostUsd` ignored cached tokens | `workers/chat.worker.ts`, migration `039` | ✅ Fixed — `inputCachedRate` from `ai_models.input_cached_cost_per_1k` |
| **Bug 4** — Compaction discarded summariser result | `prompt/assembler.ts` | ✅ Fixed — `hydrateSession()` called after summariser; 85% hard limit added |

---

## 2. Global Rules (Every Request)

### Required Headers

```
Authorization: Bearer <access_token>     ← All protected endpoints
X-Platform: web                          ← Required on EVERY request (public or protected)
```

Valid `X-Platform` values: `web` · `admin` · `mobile-ios` · `mobile-android`

> The backend rejects requests without `X-Platform` with `VALIDATION_FAILED`.  
> Use `"web"` for the browser frontend.

### Base URL

All user routes are prefixed with `/api/v1`. All admin routes with `/api/v1/admin`.

### CORS

Origins are configured via the `ALLOWED_ORIGINS` environment variable (comma-separated).  
`credentials: true` is set — include `credentials: 'include'` on fetch calls.

---

## 3. Standard Response Envelope

Every response follows this shape:

**Success (2xx):**
```json
{
  "success": true,
  "message": "Human-readable operation message.",
  "data": { ... },
  "meta": {
    "request_id": "uuid",
    "pagination": {
      "page": 1,
      "page_size": 25,
      "total": 100,
      "total_pages": 4
    },
    "rate_limit": {
      "remaining_hour": 58,
      "remaining_day": 492,
      "reset_at": "2026-05-10T15:00:00.000Z"
    }
  }
}
```

**Error (4xx / 5xx):**
```json
{
  "success": false,
  "message": "Short user-facing message.",
  "error": {
    "code": "ERROR_CODE",
    "details": { }
  },
  "meta": { "request_id": "uuid" }
}
```

> Always read `error.code` for programmatic handling. `message` is for display only.

---

## 4. Auth Endpoints

### Public Endpoints (no `Authorization` header needed)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/auth/check-email` | Check if email exists |
| `POST` | `/api/v1/auth/register` | Create account |
| `POST` | `/api/v1/auth/login` | Email/password login |
| `POST` | `/api/v1/auth/google` | Google OAuth login/register |
| `POST` | `/api/v1/auth/refresh` | Refresh access token |
| `POST` | `/api/v1/auth/password/forgot` | Request password reset email |
| `POST` | `/api/v1/auth/password/reset` | Reset password with token |
| `POST` | `/api/v1/auth/email/verify/confirm` | Confirm email with token |
| `GET` | `/api/v1/plans` | Public plan listing |

---

### `POST /api/v1/auth/check-email`
```json
// Request
{ "email": "user@example.com", "captcha_token": "optional" }

// Response 200
{ "exists": true, "suggested_email": null }
```

---

### `POST /api/v1/auth/register`
```json
// Request
{
  "email": "user@example.com",       // valid email
  "password": "Min10Chars1digit",    // min 10 chars, must include letter + digit
  "name": "Jane Doe",                // 1–60 chars
  "bio": "Optional bio",             // 0–500 chars, optional
  "locale": "en-IN",                 // optional
  "timezone": "Asia/Kolkata"         // optional
}

// Response 200
{
  "user": { <UserObject> },
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 900                  // seconds
}
```

---

### `POST /api/v1/auth/login`
```json
// Request
{ "email": "user@example.com", "password": "..." }

// Response 200 — same shape as register
```

---

### `POST /api/v1/auth/google`
```json
// Request
{
  "id_token": "google-jwt-credential-string",
  "name": "optional display name",
  "timezone": "Asia/Kolkata",
  "locale": "en-IN"
}

// Response 200 — same shape as register
```

---

### `POST /api/v1/auth/refresh`
```json
// Request
{ "refresh_token": "eyJ..." }

// Response 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",   // rotated — discard old one
  "expires_in": 900
}
```

> Refresh tokens are **rotated on every use**. Store the new `refresh_token` returned.

---

### `POST /api/v1/auth/logout` _(protected)_
```json
// Request
{ "refresh_token": "eyJ..." }

// Response 204 — no body
```

---

### `GET /api/v1/auth/me` _(protected)_
```json
// Response 200
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Jane Doe",
  "bio": "string | null",
  "avatar_url": "string | null",
  "role": "user",
  "status": "active",
  "email_verified_at": "2026-05-10T12:00:00.000Z | null",
  "mfa_enabled": false,
  "has_password": true,
  "linked_providers": [
    { "provider": "google", "provider_email": "jane@gmail.com", "linked_at": "ISO8601" }
  ]
}
```

---

### `PATCH /api/v1/auth/me` _(protected)_
```json
// Request (all fields optional)
{
  "name": "Jane Smith",
  "bio": "Updated bio",
  "avatar_url": "https://example.com/avatar.png",
  "locale": "en-IN",
  "timezone": "Asia/Kolkata"
}

// Response 200 — updated UserObject
```

---

### `POST /api/v1/auth/password/change` _(protected)_
```json
// Request
{ "current_password": "OldPass1234", "new_password": "NewPass5678" }

// Response 200 — new tokens (all sessions revoked, re-login required)
{ "access_token": "...", "refresh_token": "...", "expires_in": 900 }
```

---

### `POST /api/v1/auth/password/forgot`
```json
// Request
{ "email": "user@example.com" }

// Response 200 — always succeeds (no enumeration)
{ "message": "If that email exists, a reset link has been sent." }
```

---

### `POST /api/v1/auth/password/reset`
```json
// Request
{ "token": "reset-token-from-email", "new_password": "NewPass1234" }

// Response 200
{ "message": "Password reset successfully." }
```

---

### `POST /api/v1/auth/email/verify/request` _(protected)_
```
// No request body needed
// Response 204
```

---

### `POST /api/v1/auth/email/verify/confirm`
```json
// Request
{ "token": "verification-token-from-email" }

// Response 200
{ "user": { <UserObject> }, "message": "Email verified." }
```

---

### `GET /api/v1/auth/sessions` _(protected)_
```json
// Response 200
[
  {
    "id": "uuid",
    "platform": "web",
    "device_name": "Chrome on macOS",
    "fingerprint": "abc123",
    "issued_at": "ISO8601",
    "expires_at": "ISO8601",
    "last_used_at": "ISO8601 | null"
  }
]
```

---

### `DELETE /api/v1/auth/sessions/:id` _(protected)_
```
// Response 204 — no body
```

---

### Google Link/Unlink _(protected)_
```
POST /api/v1/auth/google/link    { "id_token": "..." }  → 200 UserObject
DELETE /api/v1/auth/google/link                         → 204
```

---

## 5. Chat Endpoints & SSE Contract

### `POST /api/v1/chat` — Enqueue a message

```json
// Request
{
  "conversationId": "uuid",               // must exist and belong to user
  "clientMessageId": "uuid",             // idempotency — same UUID = replayed response
  "content": "string",                   // 1–20,000 chars
  "attachedFileIds": ["uuid"],           // optional, default []
  "mode": "auto",                        // "auto" | "agent", default "auto"
  "agentSlug": "research",              // required if mode="agent"; optional in mode="auto"
  "modelId": "claude-sonnet-4-6",       // only if plan.featureFlags.modelPicker = true
  "options": {
    "temperature": 0.7,                  // 0–2, only if plan.featureFlags.temperatureControl
    "customSystemPrompt": "...",         // only if plan.featureFlags.customSystemPrompt
    "searchContextSize": "medium"        // "low" | "medium" | "high"
  }
}

// Response 201
{
  "jobId": "uuid",
  "status": "queued",
  "streamUrl": "/api/v1/chat/stream/{jobId}"
}
```

> **Credit hold** is placed at enqueue time. If the job fails/cancels, the hold is released automatically.  
> **Idempotency**: sending the same `clientMessageId` twice returns the existing job without re-queuing.

---

### `GET /api/v1/chat/stream/:jobId` — SSE Stream

**Headers required:** `Authorization`, `X-Platform`  
**Content-Type returned:** `text/event-stream`

Connect immediately after receiving `streamUrl` from the enqueue response. The stream may already be in progress (events are buffered for 5 minutes and replayed on reconnect).

#### SSE Event Contract (exact field names from source code)

```
event: <event-name>
data: <json-payload>
```

---

**`queued`** — Job is waiting in queue (sent on connect if still queued)
```json
{ "position": 0 }
```

---

**`processing`** — Worker picked up the job, routing started
```json
{
  "agentSlug": "research",
  "modelId": "claude-sonnet-4-6",
  "modelProvider": "anthropic"
}
```

---

**`chunk`** — Streaming text token from the model
```json
{ "content": "partial text delta" }
```
> Append `content` to the displayed message. Do not replace.

---

**`tool_call`** — Agent is calling a tool (before execution)
```json
{
  "toolId": "web_search",
  "arguments": { "query": "..." },
  "callId": "tool-call-uuid"
}
```

---

**`tool_result`** — Tool execution completed
```json
{
  "callId": "tool-call-uuid",
  "output": { /* tool-specific JSON — see note below */ },
  "durationMs": 1234
}
```

> **Artifact detection from `tool_result`:** When a tool creates an artifact (e.g. `html_generate`, `file_gen`, `chart_generate`), the `output` object will contain an `artifactId` field:
> ```json
> { "callId": "...", "output": { "artifactId": "uuid", "title": "...", "previewAvailable": true }, "durationMs": 800 }
> ```
> The `artifact` SSE event type is reserved but **currently not emitted**. Artifact detection **must be done by inspecting `tool_result.output.artifactId`**.

---

**`usage`** — Final token and credit usage (sent just before `done`)
```json
{
  "tokensUsed": {
    "inputFresh": 1200,
    "inputCached": 3500,
    "output": 450,
    "cacheWrite": 120
  },
  "creditsDeducted": 0.42
}
```

---

**`done`** — Stream complete
```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "status": "completed"
}
```

> After `done`, call `GET /api/v1/conversations/:id/messages` or `GET /api/v1/artifacts` to load any created artifacts. The `done` payload does **not** include `artifactIds`.

---

**`error`** — Stream failed
```json
{
  "code": "PROVIDER_EXHAUSTED",
  "message": "All model providers are temporarily unavailable.",
  "retryable": false
}
```

---

**`cancelled`** — Stream cancelled by user
```json
{ "reason": "user_cancelled" }
```

---

**`heartbeat`** — Keep-alive ping (sent every ~30s)
```json
{}
```

#### SSE Terminal Events
`done`, `error`, `cancelled` are terminal — close the connection after receiving any of these.

#### SSE Reconnect Pattern
The hub buffers up to 256 events for 5 minutes. On reconnect with the same `jobId`:
- Already-received `chunk` events will replay — your handler must be idempotent (track full accumulated text, not append again).
- Or use `EventSource` with `lastEventId` if you add event IDs.

---

### `GET /api/v1/chat/job/:jobId` — Poll job status (non-SSE fallback)

```json
// Response 200
{
  "jobId": "uuid",
  "status": "queued | processing | streaming | completed | failed | cancelled | timeout",
  "agentSlug": "research | null",
  "modelId": "claude-sonnet-4-6 | null",
  "resultMessageId": "uuid | null",
  "artifactIds": [],
  "errorCode": "string | null",
  "errorMessage": "string | null",
  "startedAt": "ISO8601 | null",
  "completedAt": "ISO8601 | null"
}
```

---

### `POST /api/v1/chat/:conversationId/cancel`

```json
// No request body

// Response 200
{ "jobId": "uuid", "status": "cancelled" }
```

---

## 6. Conversation & Message Endpoints

### `GET /api/v1/conversations`

```
Query: cursor? (string), limit? (1–100, default 25)
```

```json
// Response 200 — data is an array in the standard envelope
{
  "data": [ <ConversationObject>, ... ],
  "meta": { "pagination": { "page": 1, "page_size": 25, "total": 100, "total_pages": 4 } }
}
```

**ConversationObject:**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "title": "My conversation | null",
  "titleGeneratedAt": "ISO8601 | null",
  "defaultAgentSlug": "research | null",
  "defaultModelId": "claude-sonnet-4-6 | null",
  "totalTokensUsed": 4200,
  "messageCount": 12,
  "summarisedUpToMsgId": "uuid | null",
  "summaryText": "string | null",
  "status": "active | archived",
  "pinnedAt": "ISO8601 | null",
  "tags": ["tag1", "tag2"],
  "platform": "web",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "lastMessageAt": "ISO8601"
}
```

---

### `POST /api/v1/conversations`

```json
// Request (all optional)
{
  "defaultAgentSlug": "research",
  "defaultModelId": null,
  "tags": ["work", "research"]
}

// Response 201
{ "conversation": <ConversationObject> }
```

---

### `GET /api/v1/conversations/:id`

```json
// Response 200
{
  "conversation": <ConversationObject>,
  "messages": [ <MessageObject>, ... ],
  "summary": {
    "text": "Summary of earlier conversation...",
    "coversUpToMessageId": "uuid"
  }
}
```

**MessageObject:**
```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "userId": "uuid",
  "role": "user | assistant",
  "content": "full message text",
  "attachedFileIds": ["uuid"],
  "inputTokens": 1200,
  "outputTokens": 450,
  "creditsDeducted": 0.42,
  "agentSlug": "research | null",
  "modelId": "claude-sonnet-4-6 | null",
  "modelProvider": "anthropic | null",
  "webSearchUsed": true,
  "codeExecutionUsed": false,
  "fileAnalysisUsed": false,
  "voiceModeUsed": false,
  "citations": [
    { "title": "Page Title", "url": "https://...", "snippet": "Excerpt..." }
  ],
  "latencyMs": 2341,
  "status": "pending | streaming | complete | error",
  "jobId": "uuid | null",
  "errorMessage": "string | null",
  "isIncludedInSummary": false,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

---

### `PATCH /api/v1/conversations/:id`

```json
// Request (all optional)
{
  "title": "New title",              // 1–120 chars
  "pinned": true,
  "status": "archived",
  "tags": ["work"]
}

// Response 200
{ "conversation": <ConversationObject> }
```

---

### `DELETE /api/v1/conversations/:id`
```
// Response 204 — archives (soft delete), does not permanently delete
```

---

### `POST /api/v1/conversations/:id/summarise`
```json
// No request body

// Response 202
{ "jobId": "uuid", "status": "queued" }
```

---

### `GET /api/v1/conversations/:id/messages`

```
Query: cursor? (string), limit? (1–100, default 25)
```

```json
// Response 200
{
  "data": [ <MessageObject>, ... ],
  "meta": { "pagination": { ... } }
}
```

---

## 7. Artifact Endpoints

> **Feature gate:** All artifact endpoints require `plan.featureFlags.artifactVersioning = true`.

### `GET /api/v1/artifacts`

```
Query: limit? (1–100, default 25)
```

```json
// Response 200
{ "artifacts": [ <ArtifactObject>, ... ] }
```

**ArtifactObject:**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "conversationId": "uuid",
  "messageId": "uuid | null",
  "title": "My Chart",
  "type": "html | code | markdown | csv | excel | docx | chart | text | image",
  "parentId": "uuid | null",       // null = first version
  "versionNumber": 1,
  "contentHash": "sha256 | null",
  "storagePath": "path/on/s3 | null",
  "contentText": "inline text content | null",
  "createdByAgent": "analyst",
  "isLatest": true,
  "previewHtml": "<html>...</html> | null",
  "previewGeneratedAt": "ISO8601 | null",
  "fileSize": 24576,
  "createdAt": "ISO8601"
}
```

> `fileSize` is the byte length of the artifact payload (binary in storage or inline `contentText`). `null` for legacy rows created before migration `056_artifacts_file_size`.

**Message enrichment (`ArtifactMeta` on `GET /conversations/:id` messages):** same slim fields as today plus optional `fileSize` (bytes) for Canvas display.

---

### `GET /api/v1/artifacts/:id`
```json
// Response 200
{ "artifact": <ArtifactObject> }
```
> If `contentText` is null and `storagePath` is set, the service fetches from S3 and returns it inline.

---

### `GET /api/v1/artifacts/:id/versions`
```json
// Response 200
{
  "versions": [
    {
      "id": "uuid",
      "parentId": "uuid | null",
      "versionNumber": 1,
      "contentHash": "string | null",
      "title": "string",
      "contentText": "string | null",
      "createdByAgent": "string",
      "createdAt": "ISO8601"
    }
  ]
}
```

---

### `POST /api/v1/artifacts/:id/fork`
Creates a new version of an artifact (user-initiated edit).
```json
// Request (optional)
{
  "title": "Updated chart",       // 1–240 chars
  "contentText": "new content"    // 0–200,000 chars
}

// Response 201
{ "artifact": <ArtifactObject> }
```

**Errors:** `ARTIFACT_VERSION_LIMIT` when plan's `maxArtifactVersions` is reached.

---

### `DELETE /api/v1/artifacts/:id`
```
// Response 204
```

---

## 8. File Upload Endpoints

> **Feature gate:** Requires `plan.featureFlags.fileUpload = true`.  
> **Encoding:** Files are sent as **base64 JSON** (not multipart form-data).

### `POST /api/v1/files/upload`

```json
// Request
{
  "conversationId": "uuid | null",
  "fileName": "report.pdf",              // 1–260 chars
  "fileType": "application/pdf",         // MIME type, see allowed list below
  "fileSize": 1048576,                   // bytes — must be ≤ plan.limits.maxFileSize
  "contentBase64": "JVBERi0xLjQ..."      // base64-encoded file content
}
```

**Allowed MIME types:**
```
application/pdf
application/vnd.openxmlformats-officedocument.wordprocessingml.document  (docx)
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet        (xlsx)
text/csv
text/plain
image/png
image/jpeg
video/mp4
```

```json
// Response 201
{
  "file": {
    "id": "uuid",
    "userId": "uuid",
    "conversationId": "uuid | null",
    "messageId": "uuid | null",
    "fileName": "report.pdf",
    "fileType": "application/pdf",
    "fileSize": 1048576,
    "storagePath": "uploads/user-id/...",
    "processingStatus": "pending | processing | ready | failed",
    "extractedText": "string | null",
    "vectorised": false,
    "errorMessage": "string | null",
    "uploadedAt": "ISO8601"
  }
}
```

> **Processing is async.** Poll `GET /api/v1/files/:id` until `processingStatus = "ready"` before using the file in a chat message. Passing a non-ready file ID to `/chat` returns `ATTACHED_FILE_NOT_READY`.

---

### `GET /api/v1/files/:id`
```json
// Response 200
{ "file": <FileObject> }
```

---

### `DELETE /api/v1/files/:id`
```
// Response 204
```

---

## 9. Wallet & Credits Endpoints

### `GET /api/v1/wallet`

```json
// Response 200
{
  "balance": 142.50,
  "pending": 5.00,           // credits held for in-flight jobs
  "spendable": 137.50,       // balance - pending
  "lifetimeEarned": 500.00,
  "lifetimeSpent": 357.50,
  "currency": "credits",
  "updatedAt": "ISO8601"
}
```

> Also check response headers: `X-Wallet-Balance`, `X-Wallet-Pending`, `X-Wallet-Spendable`.

---

### `GET /api/v1/wallet/transactions`

```
Query:
  page?      number (default 1)
  page_size? number (1–100, default 25)
  type?      "grant" | "deduct" | "topup" | "rollover" | "refund" | "adjustment"
  from?      ISO8601 date
  to?        ISO8601 date
```

```json
// Response 200
{
  "transactions": [
    {
      "id": "uuid",
      "type": "deduct",
      "amount": -2.50,
      "balanceAfter": 140.00,
      "messageId": "uuid | null",
      "jobId": "uuid | null",
      "agentSlug": "research | null",
      "modelId": "claude-sonnet-4-6 | null",
      "inputTokens": 1200,
      "outputTokens": 450,
      "creditRate": 0.003,
      "agentMultiplier": 1.2,
      "planDiscount": 1.0,
      "description": "Chat response",
      "createdAt": "ISO8601"
    }
  ],
  "pagination": { "page": 1, "page_size": 25, "total": 48 }
}
```

---

### `GET /api/v1/wallet/transactions/:id`
```json
// Response 200
{ "transaction": <TransactionObject> }
```

---

### `POST /api/v1/wallet/topup`

```json
// Request
{ "packageId": "topup_500_credits" }

// Response 200
{
  "orderId": "ORDER_ABC123",
  "creditsToAdd": 500,
  "amount": 49900,              // in paise (INR)
  "redirectUrl": "https://mercury.phonepe.com/transact/..."
}
```

> Redirect the user to `redirectUrl` to complete PhonePe payment. PhonePe redirects back to your callback URL after payment.

---

## 10. Usage Endpoints

### `GET /api/v1/usage/summary`

```
Query:
  periodStart? YYYY-MM-DD
  periodEnd?   YYYY-MM-DD
```

```json
// Response 200
{
  "periodStart": "2026-05-01",
  "periodEnd": "2026-05-10",
  "totalChats": 42,
  "totalTokens": 128400,
  "totalCredits": 38.20,
  "byModel": { "claude-sonnet-4-6": 24.10, "gpt-4o": 14.10 },
  "byAgent": { "research": 22.00, "chat": 10.20, "code": 6.00 }
}
```

---

### `GET /api/v1/usage/history`

```
Query: days? (1–90, default 30)
```

```json
// Response 200
{
  "days": 30,
  "points": [
    { "date": "2026-05-09", "chats": 5, "tokens": 14200, "credits": 4.30 },
    { "date": "2026-05-10", "chats": 3, "tokens": 9100, "credits": 2.80 }
  ]
}
```

---

## 11. Memory Endpoints

Long-term facts the AI has extracted about the user.

### `GET /api/v1/memory`

```
Query: page? (default 1), limit? (1–100, default 20)
```

```json
// Response 200
{
  "facts": [
    { "id": "uuid", "fact": "User prefers concise answers.", "confidence": 0.9, "created_at": "ISO8601" }
  ],
  "total": 14,
  "page": 1,
  "limit": 20
}
```

---

### `DELETE /api/v1/memory/:id` — Delete a single fact
```json
// Response 200
{ "deleted": true }
```

---

### `DELETE /api/v1/memory` — Purge all facts for the user
```json
// Response 200
{ "purged": true }
```

---

## 12. Plan & Subscription Endpoints

### `GET /api/v1/plans` _(public)_

```
Query: page? (default 1), pageSize? (1–100, default 20)
```

```json
// Response 200
{
  "plans": [
    {
      "id": "plan_free_v1",
      "name": "Free",
      "slug": "free",
      "status": "active",
      "isPublic": true,
      "isIntroductory": false,
      "pricing": { "monthly": 0, "annual": 0, "currency": "inr" },
      "credits": {
        "included": 100,
        "rollover": false,
        "maxRollover": null,
        "topupEnabled": false,
        "topupPackages": [],
        "creditDiscount": 1.0
      },
      "limits": {
        "hourly": 10,
        "daily": 50,
        "weekly": 200,
        "monthly": 500,
        "maxMessageContentLength": 5000,
        "maxContextMessages": 10,
        "maxFileSize": 0,
        "maxFilesPerChat": 0,
        "maxArtifactVersions": 1,
        "streamTimeoutMs": 60000,
        "streamInactivityTimeoutMs": 15000
      },
      "modelAccess": [],
      "agentAccess": ["chat", "writer"],
      "featureFlags": {
        "webSearch": false,
        "fileUpload": false,
        "codeExecution": false,
        "artifactVersioning": false,
        "modelPicker": false,
        "htmlPreview": false,
        "imageAnalyse": false,
        "chartGeneration": false,
        "weatherData": true,
        "stockData": false,
        "queryRewrite": true,
        "customSystemPrompt": false,
        "temperatureControl": false
      },
      "featureLimits": { "webSearch": { "daily": 20 }, "codeExecution": { "hourly": 0 } },
      "createdAt": "ISO8601",
      "archivedAt": null
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 4 }
}
```

---

### `GET /api/v1/subscription` _(protected)_

```json
// Response 200
{
  "subscription": {
    "id": "uuid",
    "planId": "plan_pro_v1",
    "planSnapshot": { <Plan object as above> },
    "billingCycle": "monthly",
    "status": "active",
    "currentPeriodStart": "ISO8601",
    "currentPeriodEnd": "ISO8601",
    "cancelAtPeriodEnd": false,
    "creditsGranted": 2000,
    "creditsRolledOver": 150,
    "createdAt": "ISO8601"
  }
}
```

---

### `POST /api/v1/subscription/upgrade` _(protected)_

```json
// Request
{ "planId": "plan_pro_v1", "billingCycle": "monthly" }

// Response 201
{ "subscription": <SubscriptionObject> }
```

---

### `POST /api/v1/subscription/cancel` _(protected)_

```json
// Request
{ "immediate": false }    // false = cancel at period end (default)

// Response 200
{
  "subscription": <SubscriptionObject>,
  "effectiveAt": "ISO8601"
}
```

---

## 13. Catalogue Endpoints

Returns the agents and models available for the authenticated user's plan.

### `GET /api/v1/catalogue` _(protected)_

```json
// Response 200
{
  "modes": {
    "auto": { "available": true },
    "agent": { "available": true }
  },
  "categories": [
    {
      "slug": "agents",
      "name": "Agents",
      "iconUrl": null,
      "sortOrder": 1,
      "agents": [
        {
          "slug": "research",
          "agentType": "specialized",
          "displayName": "Research",           // ⚠️ auto-generated from slug — see gap below
          "iconUrl": null,                     // ⚠️ always null currently
          "shortDescription": "Research assistant",   // ⚠️ auto-generated
          "longDescription": "Research assistant powered by smart routing.",
          "tags": [],
          "examplePrompts": [],
          "isAutoEligible": true,
          "maxContextTokens": 80000,
          "costMultiplier": 1,
          "primaryModel": {
            "modelId": "claude-sonnet-4-6",
            "displayName": "claude-sonnet-4-6",
            "provider": "anthropic",
            "iconUrl": null,
            "healthStatus": "healthy"
          },
          "isDirect": false
        }
      ]
    }
  ]
}
```

> ⚠️ **Gap:** `displayName`, `shortDescription`, `longDescription`, `iconUrl`, and `examplePrompts` are auto-generated from the agent slug. They are **not** sourced from a CMS or agent metadata file. The frontend should maintain its own display-name and icon mapping per agent slug until this is enriched on the backend.

---

### `GET /api/v1/catalogue/agents/:slug` _(protected)_

```json
// Response 200
{ "agent": <CatalogueAgentObject> }
```

---

## 14. Response Headers Reference

### Rate Limit Headers (on every authenticated response)

```
X-RateLimit-Hourly-Limit: 60
X-RateLimit-Hourly-Remaining: 57
X-RateLimit-Daily-Limit: 500
X-RateLimit-Daily-Remaining: 472
```

### Feature Limit Headers (when feature-gated routes are called)

```
X-Feature-WebSearch-Daily-Limit: 20
X-Feature-WebSearch-Daily-Remaining: 18
X-Feature-CodeExec-Hourly-Limit: 5
X-Feature-CodeExec-Hourly-Remaining: 5
```

### Wallet Headers (on `GET /api/v1/wallet`)

```
X-Wallet-Balance: 142.50
X-Wallet-Pending: 5.00
X-Wallet-Spendable: 137.50
```

### SSE Headers (on `GET /api/v1/chat/stream/:jobId`)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

---

## 15. Error Code Reference

### Auth & Session

| Code | HTTP | Trigger |
|------|------|---------|
| `NOT_AUTHENTICATED` | 401 | Missing/invalid token |
| `INVALID_TOKEN` | 401 | Malformed JWT |
| `TOKEN_EXPIRED` | 401 | JWT past expiry |
| `TOKEN_REVOKED` | 401 | Logged out elsewhere |
| `TOKEN_REUSED` | 401 | Refresh token replayed |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `ACCOUNT_LOCKED` | 423 | Brute-force lockout — `details.locked_until: ISO8601` |
| `INVALID_CURRENT_PASSWORD` | 401 | Wrong current password on change |
| `INVALID_OR_EXPIRED_TOKEN` | 400 | Reset/verify token expired |
| `USER_BANNED` | 403 | Account banned |
| `EMAIL_NOT_VERIFIED` | 403 | Email not confirmed |

### Validation

| Code | HTTP | Details |
|------|------|---------|
| `VALIDATION_FAILED` | 400 | `details.fields: [{ path, code, message }]` |
| `PLATFORM_MISMATCH` | 400 | Wrong `X-Platform` for this endpoint |
| `INVALID_EMAIL` | 400 | — |
| `EMAIL_TAKEN` | 409 | — |
| `PASSWORD_TOO_WEAK` | 400 | — |

### Resource

| Code | HTTP | — |
|------|------|---|
| `NOT_FOUND` | 404 | Generic not found |
| `CONVERSATION_NOT_FOUND` | 404 | — |
| `ARTIFACT_NOT_FOUND` | 404 | — |
| `JOB_NOT_FOUND` | 404 | — |
| `NO_ACTIVE_JOB` | 404 | Cancel with no active stream |

### Rate & Budget

| Code | HTTP | Details |
|------|------|---------|
| `TOO_MANY_REQUESTS` | 429 | — |
| `RATE_LIMIT_EXCEEDED` | 429 | `{ limitType, limit, resetAt, retryAfterSeconds }` |
| `RATE_LIMIT_COOLDOWN` | 429 | `{ cooldownUntil, retryAfterSeconds, reason }` (admin-applied cooldown; `reason` is `cooldown_active`) |
| `FEATURE_LIMIT_EXCEEDED` | 429 | `{ feature, window, limit, used, resetAt, upgradeUrl }` |
| `INSUFFICIENT_CREDITS` | 402 | `{ creditsNeeded, creditsAvailable, topupUrl }` |

### Features & Plans

| Code | HTTP | Details |
|------|------|---------|
| `FEATURE_NOT_AVAILABLE` | 403 | `{ feature, upgradeUrl: "/pricing" }` |
| `MODEL_NOT_ALLOWED` | 403 | `{ modelId, planId }` |
| `AGENT_NOT_ALLOWED` | 403 | `{ agentSlug, planId }` |
| `PLAN_NOT_FOUND` | 404 | — |
| `ALREADY_ON_PLAN` | 409 | — |
| `CANNOT_CANCEL_FREE_PLAN` | 400 | — |
| `SUBSCRIPTION_CONFLICT` | 409 | — |
| `INVALID_UPGRADE_TARGET` | 400 | Trying to upgrade to free |

### Files & Artifacts

| Code | HTTP | Details |
|------|------|---------|
| `FILE_TOO_LARGE` | 400 | `{ max, maxBytes }` |
| `FILE_TYPE_NOT_ALLOWED` | 400 | `{ allowed: [mime types] }` |
| `FILE_LIMIT_PER_CHAT` | 400 | `{ max: number }` |
| `ATTACHED_FILE_NOT_READY` | 409 | File still processing |
| `ARTIFACT_VERSION_LIMIT` | 400 | `{ max: number }` |

### Chat

| Code | HTTP | — |
|------|------|---|
| `MESSAGE_TOO_LONG` | 400 | `{ length, max, upgradeUrl }` |
| `REPEAT_MESSAGE` | 409 | Duplicate content |
| `PROMPT_INJECTION_REJECTED` | 400 | Sanitiser blocked it |
| `JOB_NOT_OWNED` | 403 | Job belongs to another user |
| `JOB_ENQUEUE_FAILED` | 500 | Queue error |
| `PROVIDER_EXHAUSTED` | 503 | All LLMs down |
| `CONTEXT_OVERFLOW` | 413 | Prompt too large |

---

## 16. Known Frontend Gaps

These are backend limitations the frontend team needs to work around or wait for.

### Gap 1 — `artifact` SSE Event Not Emitted ⚠️ WORKAROUND NEEDED

The SSE event type `"artifact"` is defined in the type system but **is never published**. When a tool creates an artifact during streaming, the notification comes through `tool_result`:

```json
// Listen for this in tool_result events:
{
  "callId": "...",
  "output": {
    "artifactId": "uuid",        // ← artifact was created
    "title": "My Chart",
    "previewAvailable": true
  },
  "durationMs": 820
}
```

**Frontend workaround:** After receiving `done`, call `GET /api/v1/artifacts?limit=5` to load any newly created artifacts. OR inspect each `tool_result.output` for an `artifactId` field during streaming and prefetch.

---

### Gap 2 — Catalogue Agent Metadata is Auto-Generated ⚠️ FRONTEND MAPPING NEEDED

`displayName`, `shortDescription`, `longDescription`, `iconUrl`, and `examplePrompts` in the catalogue response are all auto-generated from the agent slug. Icons are always `null`.

**Frontend workaround:** Maintain a local mapping file for display names, icons, and descriptions keyed by agent slug:

```typescript
const AGENT_DISPLAY = {
  chat:         { name: "Chat",             icon: "💬", desc: "General-purpose assistant" },
  research:     { name: "Research",         icon: "🔍", desc: "Web search with citations" },
  code:         { name: "Code Assistant",   icon: "💻", desc: "Write, debug, and refactor code" },
  writer:       { name: "Writer",           icon: "✍️", desc: "Blogs, emails, and copy" },
  analyst:      { name: "Data Analyst",     icon: "📊", desc: "CSV analysis and charts" },
  architect:    { name: "Architect",        icon: "🏗️", desc: "System design and diagrams" },
  debugger:     { name: "Debugger",         icon: "🐛", desc: "Root cause and fix" },
  document:     { name: "Document",         icon: "📄", desc: "Summarise and extract from files" },
  ui:           { name: "UI Generator",     icon: "🎨", desc: "HTML/CSS/JS preview" },
  deep_research:{ name: "Deep Research",    icon: "🔬", desc: "Extended research with sources" },
};
```

---

### Gap 3 — No `semantic_cache_optout` Preference API

The `users` table has a `semantic_cache_optout` column but there is no user-facing API endpoint to toggle it. If the frontend needs a "Do not cache my queries" privacy toggle, the backend endpoint does not yet exist.

---

### Gap 4 — No MFA Setup/Verify Endpoints

`GET /api/v1/auth/me` returns `mfa_enabled: boolean`, but there are no `POST /api/v1/auth/mfa/setup` or `POST /api/v1/auth/mfa/verify` endpoints. MFA UI cannot be built yet.

---

### Gap 5 — No Artifact Diff Endpoint

Artifact versioning exists (`/versions`) but there is no diff endpoint (`/diff?against=:id`). The frontend would need to compute diffs client-side by fetching two version `contentText` values.

---

### Gap 6 — SSE Reconnect — Events Replay Without IDs

The SSE hub replays up to 256 buffered events on reconnect. However, events do not have `id:` fields in the SSE frame. Native `EventSource` cannot use `Last-Event-ID` for deduplication. On reconnect, your `chunk` handler will receive duplicate deltas — accumulate the full text server-side (via `GET /api/v1/conversations/:id/messages`) rather than relying solely on SSE for final content.

---

### Gap 7 — File Upload: Base64 Only, No Multipart

All file uploads are base64-encoded JSON (not `multipart/form-data`). For large files this increases payload size ~33%. The `maxFileSize` limit in the plan applies to the **original** file size (not the base64 string).

---

*This document covers the backend state as of 2026-05-10 post P1–P4 bug fixes. File under `docs/` and keep alongside the architecture doc.*
