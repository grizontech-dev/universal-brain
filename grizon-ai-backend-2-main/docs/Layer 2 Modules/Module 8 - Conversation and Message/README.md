# Module 8 — Conversation & Message Structure

> Owner of `conversations`, `messages`, `files`, and `artifacts` tables. CRUD APIs, file upload + parse, rolling summarisation.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §10](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, types (`Conversation`, `Message`, `MessageFile`, `Artifact`), file structure, dependencies |
| 2 | [02_CONVERSATIONS_MESSAGES_FILES.md](02_CONVERSATIONS_MESSAGES_FILES.md) | Table contracts, message lifecycle, file upload + parse pipeline, summarisation algorithm, route contracts (user + admin), error envelopes |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, migrations, tests, verification |

## Status

- **Stage:** Planning complete · implementation not started
- **Owner:** Backend
- **Last updated:** 2026-05-05

## Key Decisions

- **Module 8 owns four tables:** `conversations`, `messages`, `files`, `artifacts`. Module 7 writes message/artifact rows but does not own the schema.
- **Title generation is async.** A new conversation gets `title='New Conversation'` synchronously; a Module 7 `notification`-style background job rewrites it after the first assistant reply using the cheapest model.
- **Files have a strict whitelist** (PDF, DOCX, XLSX, CSV, TXT, PNG, JPG, MP4) and a per-plan size cap pulled from `plan.limits.maxFileSize`. Validation at the upload route (Module 9 size + type), parse + vectorise asynchronously via Module 7's `file` queue.
- **Summarisation is rolling.** At >85 % of model context window, the oldest contiguous span of messages is replaced with a single summary paragraph stored on `conversations.summary_text`; affected message rows get `is_included_in_summary=true`. The summary call uses the cheapest model on the user's plan.
- **Soft-delete only.** `DELETE /conversations/:id` flips `status='archived'` so admin support can retrieve conversations later. Hard delete is a separate (admin) tool.
- **Pagination is keyset, not offset.** Cursor-based on `(last_message_at desc, id desc)` for the conversation list and `(created_at asc, id asc)` for messages. Predictable performance at any scale.
- **Artifacts are immutable; edits create new versions.** `parent_id` + `version_number` chain. `is_latest=true` on exactly one row per chain.

## Surface

- **9 user routes** under `/api/v1/conversations/*`, `/api/v1/files/*`, `/api/v1/artifacts/*`
- **1 admin route** under `/api/v1/admin/users/:id/conversations`
- **0 middleware** added to the global pipeline
- **4 services:** `conversation.service.ts`, `message.service.ts`, `file.service.ts`, `artifact.service.ts`
- **1 worker handler:** `summariser.worker.ts` registered on Module 7's `chat` queue with `name: 'summarise'` (kept here so domain logic stays with Module 8)
- **4 tables:** `conversations`, `messages`, `files`, `artifacts`
- **Postman groups:** `Module 8 - User Conversation Contracts`, `Module 8 - User File Contracts`, `Module 8 - User Artifact Contracts`, `Module 8 - Admin Conversation Contracts`

## Dependencies

- Module 1 — `req.user.id` for ownership; admin role for support read access
- Module 2 — `req.plan.limits.maxFileSize`, `maxFilesPerChat`, `maxContextMessages`, `maxArtifactVersions`
- Module 3 — `requireFeature('fileUpload')`, `requireFeature('documentAnalysis')`, `requireFeature('artifactVersioning')` on respective routes
- Module 7 — `chatJob.service.enqueue` for background title generation; `file.queue` for parse + vectorise
- Module 9 — sanitiser validates request bodies and enforces per-plan message length / file size before Module 8 sees them
- Qdrant (`src/infra/qdrant.ts`) — vector index for parsed file content (`files.vectorised=true` flag)
- Local volume `/uploads` (Phase 1) → Cloudflare R2 (Phase 2) for file storage; abstracted behind `src/services/storage.service.ts`
