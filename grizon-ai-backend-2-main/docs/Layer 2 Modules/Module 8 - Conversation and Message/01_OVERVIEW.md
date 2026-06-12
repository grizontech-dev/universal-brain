# 01 — Overview

## Mission

Module 8 is the **conversation memory** of the product. Everything a user has ever said, every assistant reply, every uploaded file, every generated artifact — Module 8 owns the schema, the CRUD, the lifecycle, and the rules for keeping conversations within a model's context window.

Module 7 calls into Module 8 to create message rows; Module 6 reads its tables for analytics; Module 10 reads `conversations.summary_text` plus the most recent N messages to assemble prompts. None of those modules can persist conversation state without going through Module 8.

## Scope

### In scope
- Tables: `conversations`, `messages`, `files`, `artifacts`, plus `message_cache_summaries` (per-conversation summary cache for the prompt assembler)
- 4 services: `conversation.service.ts`, `message.service.ts`, `file.service.ts`, `artifact.service.ts`
- 9 user routes (conversations CRUD + summarise trigger, files upload/status/delete, artifacts read + version + fork + delete)
- 1 admin route (`GET /admin/users/:id/conversations`) for support
- Background summarisation logic (the algorithm; the BullMQ runner is Module 7's queue, the handler ships in Module 8)
- Title generation hook (kicked off after the first assistant message of a fresh conversation)
- Storage abstraction `storage.service.ts` (local volume today, R2 later)

### Out of scope
- LLM streaming, agent loop (Module 7)
- Smart routing of which agent / model to use (Module 10)
- Token classification + cost (Modules 4, 6)
- Sanitisation of user content (Module 9)
- Long-term semantic memory across conversations (Module 11 — out of this layer for now)
- Top-up / payment for storage overage (none today; per-plan caps enforced at upload)

## Inputs

| Source | What it carries |
|---|---|
| `req.user.id` (Module 1) | Owner. All non-admin queries pin `WHERE user_id = req.user.id`. |
| `req.plan.limits.*` (Module 2) | `maxContextMessages`, `maxFileSize`, `maxFilesPerChat`, `maxArtifactVersions` |
| `req.platform` (Module 1) | Stamped onto `conversations.platform` for audit |
| Module 7 worker | `messageService.append(messageId, chunk)` while streaming; `messageService.finalise(messageId, status, finishReason)` at end |
| Module 7 file worker | `fileService.markReady(fileId, extractedText, vectorIds)` after parse |

## Outputs

- Persisted: rows in any of the four tables
- Returned over HTTP: list / detail / version data via the universal envelope
- Emitted on `src/events/conversation.events.ts`:
  - `conversation.created` `{ conversationId, userId, platform }`
  - `conversation.archived` `{ conversationId, userId }`
  - `conversation.summarised` `{ conversationId, summarisedUpToMessageId, tokensSaved }`
  - `message.finalised` `{ messageId, status, agentSlug, modelId }` — picked up by Module 6 as a backstop in case the worker missed it
  - `file.uploaded` `{ fileId, userId, conversationId }` — Module 7 listens to enqueue the `file` job
  - `file.ready` `{ fileId }` — frontend listens via SSE bridge (future)
  - `artifact.created` `{ artifactId, conversationId, type }`

## Type Contracts

```ts
// src/types/conversation.d.ts
export interface Conversation {
  id: string;
  userId: string;
  title: string;
  titleGeneratedAt: string | null;     // null = user-edited or fresh
  defaultAgentSlug: string | null;
  defaultModelId: string | null;
  totalTokensUsed: number;
  messageCount: number;
  summarisedUpToMessageId: string | null;
  summaryText: string | null;
  status: 'active' | 'archived';
  pinnedAt: string | null;
  tags: string[];
  platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachedFileIds: string[];
  inputTokens: number;
  outputTokens: number;
  creditsDeducted: number;
  agentSlug: string | null;
  modelId: string | null;
  modelProvider: string | null;
  webSearchUsed: boolean;
  codeExecutionUsed: boolean;
  fileAnalysisUsed: boolean;
  voiceModeUsed: boolean;
  citations: Citation[];
  latencyMs: number | null;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  jobId: string | null;
  errorMessage: string | null;
  isIncludedInSummary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  index: number;                       // [1], [2] in content
  url: string;
  title: string;
  snippet: string;
}

export interface MessageFile {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string | null;            // null = conversation-level
  fileName: string;
  fileType: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'png' | 'jpg' | 'mp4';
  fileSize: number;
  storagePath: string;
  processingStatus: 'pending' | 'processing' | 'ready' | 'failed';
  extractedText: string | null;
  vectorised: boolean;
  uploadedAt: string;
}

export interface Artifact {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string;
  title: string;
  type: 'code' | 'html' | 'markdown' | 'excel' | 'csv' | 'docx' | 'image' | 'chart';
  parentId: string | null;
  versionNumber: number;
  contentHash: string | null;
  storagePath: string | null;
  contentText: string | null;
  createdByAgent: string;
  isLatest: boolean;
  createdAt: string;
}
```

## Plan-Shape Extension (touches Module 2)

None. The `plans.limits.*` JSONB already carries `maxContextMessages`, `maxFileSize`, `maxFilesPerChat`, `maxArtifactVersions`. Module 8 reads them via `req.plan.limits`.

## File Structure

```
src/
├── services/
│   ├── conversation.service.ts          ← create, get, list, patch (title/pin/archive), summarise trigger
│   ├── message.service.ts                ← createUserMessage, append (streaming), finalise, listForConversation
│   ├── file.service.ts                   ← upload (write to storage + insert row), markReady, list, delete
│   ├── artifact.service.ts               ← create (auto-version), get, listVersions, fork, delete
│   ├── storage.service.ts                ← uniform read/write — local volume today, R2 later
│   └── summariser.service.ts             ← runs the rolling-summary algorithm; called by Module 7 queue
├── routes/
│   ├── user/
│   │   ├── conversation.routes.ts        ← /api/v1/conversations/*
│   │   ├── file.routes.ts                ← /api/v1/files/*
│   │   └── artifact.routes.ts            ← /api/v1/artifacts/*
│   └── admin/
│       └── conversations.routes.ts       ← /api/v1/admin/users/:id/conversations
├── controllers/
│   ├── user/
│   │   ├── conversation.controller.ts
│   │   ├── file.controller.ts
│   │   └── artifact.controller.ts
│   └── admin/
│       └── conversations.controller.ts
├── workers/
│   └── summariser.worker.ts              ← BullMQ subscriber on chat queue (name='summarise'); handler delegates to summariser.service
├── events/
│   └── conversation.events.ts
└── db/
    └── migrations/
        ├── 022_conversations.sql
        ├── 023_messages.sql
        ├── 024_files.sql
        ├── 025_artifacts.sql
        └── 026_message_cache_summaries.sql
```

No middleware. Module 8 is purely service + routes.

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | `req.user.id`; admin role for support endpoint |
| Module 2 — Plan & Subscription | `req.plan.limits.*` for size / count caps |
| Module 3 — Feature Flags | `requireFeature('fileUpload' \| 'documentAnalysis' \| 'artifactVersioning')` per route |
| Module 7 — Message Queue | Title generation + summarisation + file parse all run as BullMQ jobs handled by workers in Module 7's queues |
| Module 9 — Sanitiser | Pre-handler validation for body size, prompt-injection patterns, file type/size |
| `src/infra/postgres.ts` | All four tables |
| `src/infra/qdrant.ts` | `files.vectorised=true` after the file worker embeds and writes vectors |
| `src/utils/{response,errors,logger}.ts` | Standard envelope, `AppError`, structured logs |

## Modules That Will Use Module 8

| Downstream module | How |
|---|---|
| Module 7 — chat enqueue | `messageService.createUserMessage` before enqueue; `messageService.append/finalise` from the worker |
| Module 7 — file queue | `fileService.markReady` (and `markFailed`) after parse |
| Module 6 — analytics | Read-only joins for `top_agents`, `top_models`, `feature_usage` |
| Module 10 — Smart Router | Reads `conversation.summary_text` + last N messages to assemble prompts |
| Frontend chat UI | Calls every `/conversations/*`, `/files/*`, `/artifacts/*` route |
