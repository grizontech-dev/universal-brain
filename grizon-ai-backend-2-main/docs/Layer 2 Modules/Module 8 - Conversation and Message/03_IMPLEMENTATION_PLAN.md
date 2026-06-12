# 03 — Implementation Plan

Concrete, ordered build for Module 8. Module 7's enqueue path needs a working `messageService.createUserMessage` before its `POST /chat` can land — so Module 8's services + migrations should ship first, even if its routes can wait.

## Files to Create

| Path | Purpose |
|---|---|
| `src/types/conversation.d.ts` | `Conversation`, `Message`, `MessageFile`, `Artifact`, `Citation`, plus the request/response DTOs |
| `src/services/conversation.service.ts` | `create`, `get`, `list`, `patch` (title/pin/archive/tags), `enqueueSummarise` |
| `src/services/message.service.ts` | `createUserMessage`, `createAssistantPlaceholder`, `append` (debounced 250 ms / 200 chars), `finalise`, `listForConversation` |
| `src/services/file.service.ts` | `create`, `markReady`, `markFailed`, `list`, `delete` |
| `src/services/artifact.service.ts` | `create` (computes `parent_id`, `version_number`, flips `is_latest`), `get`, `listVersions`, `fork`, `delete` |
| `src/services/storage.service.ts` | Uniform interface; local-volume implementation for Phase 1 (`STORAGE_DRIVER=local`); R2 driver added later (`STORAGE_DRIVER=r2`) |
| `src/services/summariser.service.ts` | Pure summarisation logic; called by Module 7's queue handler |
| `src/workers/summariser.worker.ts` | BullMQ subscriber on the `chat` queue with `name='summarise'`; handler calls `summariser.service.run(conversationId)` |
| `src/routes/user/conversation.routes.ts` | `GET /conversations`, `POST /conversations`, `GET/PATCH/DELETE /conversations/:id`, `POST /conversations/:id/summarise`, `GET /conversations/:id/messages` |
| `src/routes/user/file.routes.ts` | `POST /files/upload`, `GET /files/:id/status`, `DELETE /files/:id` |
| `src/routes/user/artifact.routes.ts` | `GET /artifacts`, `GET /artifacts/:id`, `GET /artifacts/:id/versions`, `POST /artifacts/:id/fork`, `DELETE /artifacts/:id` |
| `src/routes/admin/conversations.routes.ts` | `GET /admin/users/:id/conversations` |
| `src/controllers/user/{conversation,file,artifact}.controller.ts` | Thin per-route |
| `src/controllers/admin/conversations.controller.ts` | Thin |
| `src/events/conversation.events.ts` | Typed emitter (see `01_OVERVIEW.md`) |
| `src/db/migrations/022_conversations.sql` | Schema per [`02_CONVERSATIONS_MESSAGES_FILES.md §A`](02_CONVERSATIONS_MESSAGES_FILES.md) |
| `src/db/migrations/023_messages.sql` | Schema + `idx_messages_convo_created`, `idx_messages_job` |
| `src/db/migrations/024_files.sql` | Schema + `idx_files_user_convo` |
| `src/db/migrations/025_artifacts.sql` | Schema + `uq_artifacts_latest` partial unique |
| `src/db/migrations/026_message_cache_summaries.sql` | Single PK on `conversation_id` |
| `test/unit/services/conversation.service.test.ts` | CRUD + plan-limit guards |
| `test/unit/services/message.service.test.ts` | Streaming append debouncing, finalise updates conversation aggregates correctly |
| `test/unit/services/artifact.service.test.ts` | Versioning chain, `is_latest` exclusivity, plan cap enforcement |
| `test/unit/services/summariser.service.test.ts` | Idempotent re-run, threshold logic, summary insert + flag flip |
| `test/integration/routes/conversation.user.routes.test.ts` | All conversation routes + RBAC |
| `test/integration/routes/file.user.routes.test.ts` | Upload + status + delete; mocked storage and parser |
| `test/integration/routes/artifact.user.routes.test.ts` | Read, fork, version listing |
| `test/integration/routes/conversations.admin.routes.test.ts` | `requireAdmin` + audit row written |

## Files to Modify

| Path | Change |
|---|---|
| `src/routes/user/index.ts` | Mount `conversationRoutes`, `fileRoutes`, `artifactRoutes` under `/api/v1` |
| `src/routes/admin/index.ts` | Mount admin conversations under `/api/v1/admin` |
| `src/utils/errors.ts` | Add `Errors.conversationNotFound()`, `messageNotFound()`, `fileTooLarge(maxBytes)`, `fileTypeNotAllowed(allowed)`, `fileLimitPerChat(max)`, `fileNotReady()`, `artifactNotFound()`, `artifactVersionLimit(max)` |
| `src/config/storage.ts` | New file: `STORAGE_DRIVER` (env-based), `LOCAL_UPLOADS_DIR`, `R2_BUCKET`, etc. Wire into `storage.service.ts`. |
| `src/config/env.ts` | Add `STORAGE_DRIVER`, `LOCAL_UPLOADS_DIR` (default `./uploads`), `UNSTRUCTURED_API_URL`, `EMBEDDING_MODEL` (default `text-embedding-3-small`) |
| `docs/LLM_NEW_MODULE_PROMPT.md` | Add Postman groups: `Module 8 - User Conversation Contracts`, `Module 8 - User File Contracts`, `Module 8 - User Artifact Contracts`, `Module 8 - Admin Conversation Contracts`. |
| `grizon-ai-backend-2.postman_collection.json` | 9 user reqs + 1 admin req |

## Reused Utilities (do not re-implement)

- `src/infra/postgres.ts` — `withTransaction` for the message-finalise + conversation-aggregate update
- `src/infra/qdrant.ts` — vector writes for parsed files
- `src/infra/redis.ts` — BullMQ backing store for the summariser job
- `src/utils/{response,errors,logger}.ts`
- Module 9's `sanitiserMiddleware` — already validates body length and prompt-injection patterns

## Implementation Order

1. **Migrations 022–026** — apply, verify with `psql \\d conversations`, `\\d messages`, `\\d files`, `\\d artifacts`, `\\d message_cache_summaries`.
2. **Types** — exported DTOs every other file imports.
3. **`storage.service.ts`** — local driver only; R2 driver stays a stub. Unit-test with a tmp-dir.
4. **`message.service.ts`** — `createUserMessage`, `createAssistantPlaceholder`, `append` (debounced), `finalise` (transactional aggregate update). This unblocks Module 7's worker.
5. **`conversation.service.ts`** — CRUD + `enqueueSummarise`. Title-generation hook is a single line that emits `conversation.created` — the listener is added in step 9.
6. **`file.service.ts`** — `create` writes to storage + INSERT row + emits `file.uploaded`. `markReady` / `markFailed` are called by Module 7's file worker.
7. **`artifact.service.ts`** — `create` is the tricky one: computes `parent_id`, `version_number`, sets `is_latest=true`, and flips the previous latest in the same chain to `false`. All inside one transaction.
8. **`summariser.service.ts`** — pure logic; tests use a mocked provider. Threshold + algorithm per [02 §D](02_CONVERSATIONS_MESSAGES_FILES.md).
9. **`summariser.worker.ts`** — BullMQ subscriber. Job id is `'summarise:' + conversationId` to dedupe.
10. **Title generation listener** — listens for `conversation.created`; after the first assistant `message.finalised` for that conversation, enqueues a tiny job to rewrite the title using the cheapest model. Updates `conversations.title` + `title_generated_at`.
11. **User routes + controllers** — six conversation routes, three file routes, five artifact routes.
12. **Admin route** — single read-only endpoint. Audit row via Module 1's `auth_audit`.
13. **Wire into `src/routes/user/index.ts` and `src/routes/admin/index.ts`** — mount everything.
14. **Postman + status report** — final.

## Verification

```bash
npm run migrate                                            # 022-026
npm run build
npm test -- test/unit/services/conversation.service.test.ts
npm test -- test/unit/services/message.service.test.ts
npm test -- test/unit/services/artifact.service.test.ts
npm test -- test/unit/services/summariser.service.test.ts
npm test -- test/integration/routes/conversation.user.routes.test.ts
npm test -- test/integration/routes/file.user.routes.test.ts
npm test -- test/integration/routes/artifact.user.routes.test.ts
npm test -- test/integration/routes/conversations.admin.routes.test.ts
```

Manual smoke (Module 7 + Module 8 together):

1. `POST /conversations { defaultModelId: null, defaultAgentSlug: null }` → fresh row, `title='New Conversation'`.
2. `POST /chat { conversationId, content: 'hello', clientMessageId: <uuid> }` → returns `jobId`. Verify `messages` has a `role='user'` row and a `role='assistant'` row with `status='streaming'`.
3. Open SSE on `/chat/stream/:jobId` — see token chunks updating the assistant message's `content`. After `done`, `messages.status='complete'` and `conversations.total_tokens_used` matches the sum.
4. After ~5 seconds, `GET /conversations/:id` shows the title rewritten by the title-generation hook.
5. Send 30 more chat messages until `total_tokens_used > 0.85 * model_window`. Wait for the `summarise` job; verify `message_cache_summaries` has a row, the older messages have `is_included_in_summary=true`, and `conversations.total_tokens_used` dropped.
6. `POST /files/upload` with a 4 MB PDF → `processing_status='pending'`. Module 7's file worker parses; status flips to `ready`. Vectors visible in Qdrant collection `user_{userId}_files`.
7. As Pro user, upload an 11 MB PDF → `400 FILE_TOO_LARGE` envelope.
8. As FREE user, upload anything → `403 FEATURE_NOT_AVAILABLE` (gated by Module 3's `fileUpload` flag).
9. Generate a code artifact via the chat agent. Then call `POST /artifacts/:id/fork` with new content → version 2 row, `is_latest` flipped on version 1, version 2 returned.
10. As admin, `GET /admin/users/:userId/conversations` → list visible. Verify `auth_audit` row written with `event_type='admin_viewed_conversations'`.

## Risks / Notes

- **Single-writer of `messages` for the assistant role:** only Module 7's `chat.worker.ts` may insert/update assistant messages. Module 8's services expose `createAssistantPlaceholder` / `append` / `finalise`, but the **caller** is always the worker. If anything else tries to write to assistant rows, fix the violator. Document in `chat.worker.ts` file-level JSDoc.
- **Append debouncing window:** 250 ms / 200 chars is a heuristic. Long output bursts will write ~4 times per second per active stream; at 100 concurrent streams that's 400 writes/sec — comfortable for Postgres but worth profiling. If it becomes hot, batch via a per-message in-memory buffer flushed every 250 ms.
- **Summariser cost charged to user:** the summariser runs the cheapest model on the user's plan, but it's still a paid call. If users object to "extra" billing for compaction, consider absorbing it via a system credit pool. Out of scope today — flag in the status report.
- **File parsing failure recovery:** today, on `markFailed`, the user can delete + re-upload. No automatic retry. If parse failures climb, add a `retry_count` column on `files` and a backoff worker. Don't pre-build.
- **Storage driver swap:** the local→R2 migration is a config flip + a 1-time copy script. Schema doesn't change. Document the script in this module's status report when it's written.
- **Rolling summary fidelity:** 250-word summaries lose nuance for highly technical conversations. If user feedback confirms it, expand the summariser prompt to "preserve every code block verbatim" and bump to 400 words. The prompt is the only knob — no schema work.
- **Cross-cursor pagination ordering ties:** keyset on `(last_message_at desc, id desc)` is stable as long as `last_message_at` is updated only by `messageService.finalise`. Other paths (`PATCH` to pin, archive) must not touch it.
- **Postman bloat:** four new groups for one module. Group them under a "Module 8" parent folder in the collection if Postman supports it; otherwise keep flat per [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md) convention.
