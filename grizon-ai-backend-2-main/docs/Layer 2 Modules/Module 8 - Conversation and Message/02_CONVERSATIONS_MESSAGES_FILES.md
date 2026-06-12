# 02 — Tables, Lifecycle, Files, Summarisation, Routes

The full contract for Module 8: schema, message lifecycle, file pipeline, the summarisation algorithm, every HTTP route.

---

## A. Tables

DDL drafts. Indexes are mandatory; partial indexes called out where they materially affect query plans.

### `conversations`

```sql
CREATE TABLE conversations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                       TEXT NOT NULL DEFAULT 'New Conversation',
  title_generated_at          TIMESTAMPTZ,
  default_agent_slug          TEXT,
  default_model_id            TEXT,
  total_tokens_used           INT NOT NULL DEFAULT 0,
  message_count               INT NOT NULL DEFAULT 0,
  summarised_up_to_msg_id     UUID,
  summary_text                TEXT,
  status                      TEXT NOT NULL DEFAULT 'active',     -- active | archived
  pinned_at                   TIMESTAMPTZ,
  tags                        TEXT[] NOT NULL DEFAULT '{}',
  platform                    TEXT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_user_active ON conversations(user_id, last_message_at DESC) WHERE status = 'active';
CREATE INDEX idx_conversations_user_pinned ON conversations(user_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;
```

### `messages`

```sql
CREATE TABLE messages (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id          UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                     TEXT NOT NULL,                          -- user | assistant | system
  content                  TEXT NOT NULL,
  attached_file_ids        UUID[] NOT NULL DEFAULT '{}',
  input_tokens             INT NOT NULL DEFAULT 0,
  output_tokens            INT NOT NULL DEFAULT 0,
  credits_deducted         INT NOT NULL DEFAULT 0,
  agent_slug               TEXT,
  model_id                 TEXT,
  model_provider           TEXT,
  web_search_used          BOOLEAN NOT NULL DEFAULT false,
  code_execution_used      BOOLEAN NOT NULL DEFAULT false,
  file_analysis_used       BOOLEAN NOT NULL DEFAULT false,
  voice_mode_used          BOOLEAN NOT NULL DEFAULT false,
  citations                JSONB NOT NULL DEFAULT '[]',
  latency_ms               INT,
  status                   TEXT NOT NULL DEFAULT 'complete',       -- pending | streaming | complete | error
  job_id                   TEXT,
  error_message            TEXT,
  is_included_in_summary   BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_convo_created ON messages(conversation_id, created_at ASC);
CREATE INDEX idx_messages_job ON messages(job_id) WHERE job_id IS NOT NULL;
```

### `files`

```sql
CREATE TABLE files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES conversations(id) ON DELETE CASCADE,    -- nullable for orphan uploads
  message_id          UUID REFERENCES messages(id) ON DELETE SET NULL,
  file_name           TEXT NOT NULL,
  file_type           TEXT NOT NULL,
  file_size           BIGINT NOT NULL,
  storage_path        TEXT NOT NULL,
  processing_status   TEXT NOT NULL DEFAULT 'pending',                        -- pending | processing | ready | failed
  extracted_text      TEXT,
  vectorised          BOOLEAN NOT NULL DEFAULT false,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_user_convo ON files(user_id, conversation_id, uploaded_at DESC);
```

### `artifacts`

```sql
CREATE TABLE artifacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id        UUID REFERENCES messages(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL,                                            -- code | html | markdown | excel | csv | docx | image | chart
  parent_id         UUID REFERENCES artifacts(id),
  version_number    INT NOT NULL DEFAULT 1,
  content_hash      TEXT,
  storage_path      TEXT,
  content_text      TEXT,
  created_by_agent  TEXT NOT NULL,
  is_latest         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_artifacts_user_convo ON artifacts(user_id, conversation_id, created_at DESC);
CREATE INDEX idx_artifacts_chain ON artifacts(parent_id, version_number);
CREATE UNIQUE INDEX uq_artifacts_latest ON artifacts(parent_id) WHERE is_latest = true AND parent_id IS NOT NULL;
```

### `message_cache_summaries`

Per-conversation summary cache used by Module 10's prompt assembler when context has been compacted. One row per conversation.

```sql
CREATE TABLE message_cache_summaries (
  conversation_id           UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  summary_text              TEXT NOT NULL,
  covers_up_to_message_id   UUID NOT NULL REFERENCES messages(id),
  token_count               INT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## B. Message Lifecycle (worker integration)

A user-sent message and an assistant reply have different lifecycles. Module 7 calls into Module 8 at four points:

```
User sends POST /chat (Module 7's controller, before enqueue):
  messageService.createUserMessage({ conversationId, content, attachedFileIds, ... })
    → INSERT messages (role='user', status='complete')
    → conversations.message_count += 1, last_message_at = now(), updated_at = now()
    → emit message.finalised (role='user')
  returns { messageId }

Worker starts streaming the assistant reply:
  messageService.createAssistantPlaceholder({ conversationId, jobId, agentSlug, modelId, ... })
    → INSERT messages (role='assistant', status='streaming', content='')
  returns { messageId }

Worker streams tokens:
  messageService.append(messageId, chunk)            ← buffered every 250ms or 200 chars to limit DB writes
    → UPDATE messages SET content = content || $2, updated_at = now() WHERE id = $1

Worker finishes (success | error | cancelled):
  messageService.finalise({
    messageId,
    status:        'complete' | 'error',
    finalContent,                          ← in case the buffer had a tail
    inputTokens, outputTokens, creditsDeducted,
    citations, agentSlug, modelId, modelProvider,
    webSearchUsed, codeExecutionUsed, fileAnalysisUsed, voiceModeUsed,
    latencyMs, errorMessage
  })
    → UPDATE messages SET ...
    → conversations.total_tokens_used += inputTokens + outputTokens
    → conversations.message_count += 1, last_message_at = now()
    → emit message.finalised
```

`createAssistantPlaceholder` returns the row id immediately so SSE chunks can carry `messageId` from the first event. If the worker crashes between placeholder and finalise, a janitor (registered in Module 7's worker manager) flips `status='error'` for any `streaming` message older than 30 min — the same TTL as the wallet-hold janitor.

### Idempotency

`messages.id` is generated by Postgres; the client's idempotency key lives on `chat_jobs` (Module 7). A duplicate `POST /chat` returns the existing `jobId`, so no second user-message row is written.

---

## C. File Upload Pipeline

```
Frontend → POST /api/v1/files/upload (JSON body, not multipart)

Request body:
  { conversationId?, fileName, fileType, fileSize, contentBase64 }

Validation (Module 8 controller):
  - fileType ∈ allowlist (PDF, DOCX, XLSX, CSV, TXT, PNG, JPG — video/mp4 disabled)
  - fileSize <= req.plan.limits.maxFileSize
  - per-conversation count (when conversationId set): active files < req.plan.limits.maxFilesPerChat

Module 8 controller:
  binary = Buffer.from(contentBase64, 'base64')
  storage = await storageService.write(binary, { userId, fileType })
  fileService.create({ userId, conversationId, fileName, fileType, fileSize, storagePath:storage.path })
    → INSERT files (status='pending')
    → emit file.uploaded
  Module 7's file.queue picks up the event listener and enqueues a FileJob.

Module 7's file.worker:
  - Calls Unstructured.io to extract text (PDF, DOCX, XLSX) or reads CSV/TXT as UTF-8
  - PNG/JPG uploads are accepted at the controller but fail in the worker (`unsupported_mime`) until vision is implemented
  - Embeds text via OpenAI text-embedding-3-small
  - Writes vectors to Qdrant collection user_{userId}_files with payload { fileId, fileName, page }
  - fileService.markReady(fileId, { extractedText, vectorised:true })
    → UPDATE files SET processing_status='ready', extracted_text=$1, vectorised=true

If Unstructured / Qdrant fail:
  fileService.markFailed(fileId, errorMessage)
    → UPDATE files SET processing_status='failed', vectorised=false
```

Frontend polls `GET /files/:id` every 2s (max 60s) until `processingStatus` is `ready` or `failed`. SSE bridge for file completion is reserved for a later phase.

### Plan caps

| Plan       | maxFileSize                       | maxFilesPerChat |
| ---------- | --------------------------------- | --------------- |
| Free       | (fileUpload disabled by Module 3) | —               |
| Starter    | 5 MB                              | 5               |
| Pro        | 10 MB                             | 10              |
| Enterprise | 100 MB                            | 50              |

Pulled from `req.plan.limits` on every upload — never hard-coded in Module 8.

---

## D. Rolling Summarisation Algorithm

Triggered on every assistant `messageService.finalise` call. The threshold check runs synchronously in the worker; the actual summary call is enqueued to Module 7's `chat` queue with `name='summarise'` so it doesn't block the user's reply.

```
On finalise(messageId, ...):
  conv = SELECT * FROM conversations WHERE id = (SELECT conversation_id FROM messages WHERE id = $1)
  modelContextWindow = MODEL_CONTEXT[conv.default_model_id ?? 'claude-sonnet-4-6']

  if conv.total_tokens_used > 0.85 * modelContextWindow:
    enqueueSummariseJob({ conversationId: conv.id })

  else if conv.total_tokens_used > 0.60 * modelContextWindow and !conv.user_warned_long:
    emit conversation.long_warning   ← frontend shows banner; SSE bridge

Summariser job (in workers/summariser.worker.ts):
  msgs = SELECT * FROM messages
         WHERE conversation_id = $1
           AND is_included_in_summary = false
         ORDER BY created_at ASC
  if msgs.length < 8 → return  (not worth summarising)

  oldestSpan = msgs[0..floor(msgs.length / 2)]                       ← compact the older half
  prompt = "Summarise these messages in 250 words, preserving key decisions, code snippets referenced, user preferences, and any pending tasks. Cite by message index where useful."
  summary = await provider.complete({
    model: cheapestModelOnPlan(planSnapshot),
    system: prompt,
    messages: oldestSpan.map(toLlmFormat)
  })

  BEGIN;
    UPDATE messages SET is_included_in_summary = true WHERE id = ANY($oldestSpan.ids);
    INSERT INTO message_cache_summaries (conversation_id, summary_text, covers_up_to_message_id, token_count)
      VALUES ($conv.id, summary, oldestSpan.last.id, $newTokens)
      ON CONFLICT (conversation_id) DO UPDATE
        SET summary_text = EXCLUDED.summary_text,
            covers_up_to_message_id = EXCLUDED.covers_up_to_message_id,
            token_count = EXCLUDED.token_count,
            updated_at = now();
    UPDATE conversations
      SET summary_text = summary,
          summarised_up_to_msg_id = oldestSpan.last.id,
          total_tokens_used = total_tokens_used - sum(oldestSpan.tokens) + $newTokens,
          updated_at = now()
      WHERE id = $conv.id;
  COMMIT;

  emit conversation.summarised { conversationId, tokensSaved: sum(oldestSpan.tokens) - $newTokens }
```

The algorithm is **idempotent** — re-running after a crash either no-ops (no rows with `is_included_in_summary=false` left) or recompacts the next half. Cost of summarisation is charged to the conversation owner via the same `wallet.confirmDeduction` path the chat worker uses (a separate, smaller `wallet_transactions` row).

---

## E. User API Routes

Base: `/api/v1`. Bearer JWT required. All queries are pinned to `req.user.id`.

### `GET /conversations?cursor=&limit=`

Keyset pagination on `(last_message_at desc, id desc)`. Default `limit=25`, max `100`.

**200 OK**

```ts
{
  data: [
    {
      id, title, lastMessagePreview: string,    // first 120 chars of last message
      lastMessageAt, messageCount,
      totalCreditsSpent: number,                // SUM messages.credits_deducted, cached on conversation
      attachedFilesCount: number,
      hasArtifacts: boolean,
      agentUsed: string | null,
      status, pinnedAt
    }
  ],
  meta: {
    pagination: { nextCursor: string | null, hasMore: boolean, limit: number }
  }
}
```

### `POST /conversations`

Create a fresh conversation. Optional initial settings.

**Body**

```ts
{ defaultAgentSlug?: string | null, defaultModelId?: string | null, tags?: string[] }
```

`defaultModelId` is gated by `featureFlags.modelPicker`.

**201 Created** → full `Conversation`.

### `GET /conversations/:id`

Returns the conversation + the most recent `req.plan.limits.maxContextMessages` messages.

**200 OK**

```ts
{
  conversation: Conversation,
  messages: Message[],          // sorted ASC by created_at
  summary: { text: string, coversUpToMessageId: string } | null
}
```

### `PATCH /conversations/:id`

Update title / pin / archive / tags.

**Body** (any subset)

```ts
{ title?: string, pinned?: boolean, status?: 'active' | 'archived', tags?: string[] }
```

Title length capped at 120 chars by the sanitiser. `status='archived'` is the soft delete.

### `DELETE /conversations/:id`

Equivalent to `PATCH { status: 'archived' }`. Frontend convenience.

**204** (envelope-shaped 200 with empty `data`).

### `POST /conversations/:id/summarise`

Manually trigger the summariser job. Useful for power users to consolidate before a long thread continues.

**202 Accepted** → `{ jobId, queuePosition }` (BullMQ job).

### `GET /conversations/:id/messages?cursor=&limit=`

Older-pages traversal. Cursor on `(created_at asc, id asc)`.

### Files

```
POST   /files/upload            (JSON: contentBase64)
GET    /files/:id               (poll processingStatus)
DELETE /files/:id
```

Detailed in §C.

### Artifacts

```
GET    /artifacts                  → list user's artifacts (latest version only by default)
GET    /artifacts/:id              → artifact content
GET    /artifacts/:id/versions     → version history (gated by featureFlags.artifactVersioning)
POST   /artifacts/:id/fork         → create new version (sets parent_id, increments version_number, flips is_latest)
DELETE /artifacts/:id              → delete (cascade deletes children of this chain only if no foreign refs)
```

Version-history responses include `parentId`, `versionNumber`, `isLatest` so the diff view in the frontend can construct the chain.

---

## F. Admin API Routes

Base: `/api/v1/admin`. Postman group: **Module 8 - Admin Conversation Contracts**.

### `GET /admin/users/:id/conversations?status=&cursor=&limit=`

Read-only support endpoint. Returns the user's conversation list with extra columns (`platform`, `last_login_at` from join with `users`).

**Authorisation:** `requireAdmin`. Audited as `auth_audit('admin_viewed_conversations', metadata={ subject_user_id })`.

---

## G. Error Code Reference

| Code                     | HTTP | Source                                              |
| ------------------------ | ---- | --------------------------------------------------- |
| `VALIDATION_FAILED`      | 400  | Body / param validation (Zod)                       |
| `CONVERSATION_NOT_FOUND` | 404  | Wrong id or not owned                               |
| `MESSAGE_NOT_FOUND`      | 404  |                                                     |
| `FILE_TOO_LARGE`         | 400  | `> plan.limits.maxFileSize`                         |
| `FILE_TYPE_NOT_ALLOWED`  | 400  | Outside whitelist                                   |
| `FILE_LIMIT_PER_CHAT`    | 400  | Too many files for conversation                     |
| `FILE_NOT_READY`         | 409  | Tried to attach a file still parsing                |
| `ARTIFACT_NOT_FOUND`     | 404  |                                                     |
| `ARTIFACT_VERSION_LIMIT` | 400  | `> plan.limits.maxArtifactVersions`                 |
| `FEATURE_NOT_AVAILABLE`  | 403  | Module 3 gate (e.g. fileUpload, artifactVersioning) |

Each registered in `src/utils/errors.ts` per [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

---

## H. Security Notes

| Concern                            | Mitigation                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-user read                    | Every non-admin query is `WHERE user_id = req.user.id`. Routes never accept `userId` in query strings.                                                                                                                                                        |
| File-path traversal                | `storageService.write` generates the path from `userId + uuid + ext`; never accepts caller-supplied filenames as the on-disk name.                                                                                                                            |
| Stored XSS via message content     | Module 9 strips `<script>` and event handlers from inbound HTML. Output to client is plain text JSON; the frontend renders Markdown safely (via `marked` with `sanitize:true`).                                                                               |
| File-content leakage between users | Qdrant collection is namespaced `user_{userId}_files`; cross-user search is impossible at the index level.                                                                                                                                                    |
| Soft-delete recovery abuse         | Archived conversations remain readable by admin via the support endpoint, never by other users. Hard-delete is a separate admin tool with explicit confirmation.                                                                                              |
| Title generation prompt injection  | The first user message is included in the title-generation prompt with the constant suffix `Respond ONLY with a 4-8 word title, no quotes.`; output is truncated at 120 chars and stripped of newlines / control characters before save.                      |
| Summary-cache replay               | The summariser is idempotent and the `message_cache_summaries.conversation_id` PK ensures only one row per conversation. Two concurrent summariser jobs for the same conversation are deduped by BullMQ's `jobId = 'summarise:' + conversationId` constraint. |
| Artifact version explosion         | Per-plan `maxArtifactVersions` enforced before each fork. On overflow, the oldest non-latest version's `storage_path` is reclaimed by a daily cleanup worker.                                                                                                 |
