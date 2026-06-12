# Module 8 Status Report

## Module

- Name: Conversation and Message
- Scope: conversations, messages, files, artifacts
- Stage: Implemented (initial integration)

## Delivered Files

- Added migrations: `023_conversations.sql`, `024_messages.sql`, `025_files.sql`, `026_artifacts.sql`, `056_artifacts_file_size.sql` (`artifacts.file_size` for Canvas/display)
- Added services: `conversation.service.ts`, `message.service.ts`, `file.service.ts`, `artifact.service.ts`, `storage.service.ts`, `summariser.service.ts`
- Added routes/controllers:
  - User: conversations, files, artifacts
  - Admin: user conversations listing
- Added events/types:
  - `conversation.events.ts`
  - `types/conversation.d.ts`
- Added config:
  - `config/storage.ts`
  - extended `config/env.ts` for storage/embedding settings

## Route Surface

- User:
  - `GET /api/v1/conversations`
  - `POST /api/v1/conversations`
  - `GET /api/v1/conversations/:id`
  - `PATCH /api/v1/conversations/:id`
  - `DELETE /api/v1/conversations/:id`
  - `POST /api/v1/conversations/:id/summarise`
  - `GET /api/v1/conversations/:id/messages`
  - `POST /api/v1/files/upload`
  - `GET /api/v1/files/:id/status`
  - `DELETE /api/v1/files/:id`
  - `GET /api/v1/artifacts`
  - `GET /api/v1/artifacts/:id`
  - `GET /api/v1/artifacts/:id/versions`
  - `POST /api/v1/artifacts/:id/fork`
  - `DELETE /api/v1/artifacts/:id`
- Admin:
  - `GET /api/v1/admin/users/:id/conversations`

## Error Codes Added

- `MESSAGE_NOT_FOUND`
- `FILE_TOO_LARGE`
- `FILE_TYPE_NOT_ALLOWED`
- `FILE_LIMIT_PER_CHAT`
- `FILE_NOT_READY`
- `ARTIFACT_NOT_FOUND`
- `ARTIFACT_VERSION_LIMIT`

## Tests Added

- Unit:
  - `test/unit/services/conversation.service.test.ts`
  - `test/unit/services/message.service.test.ts` (includes `createUserMessageWithClient`)
  - `test/unit/services/chatJob.service.test.ts` (enqueue persists user message + idempotent replay)
  - `test/unit/services/artifact.service.test.ts`
  - `test/unit/services/summariser.service.test.ts`
- Integration:
  - `test/integration/routes/conversation.user.routes.test.ts`
  - `test/integration/routes/conversations.admin.routes.test.ts`

## Postman

- Updated `grizon-ai-backend-2.postman_collection.json` with:
  - Module 8 - User Conversation Contracts
  - Module 8 - User File Contracts
  - Module 8 - User Artifact Contracts
  - Module 8 - Admin Conversation Contracts

## Notes

- `POST /api/v1/chat` enqueue path aligns with Module 8 §B: user messages are written before the assistant placeholder is created by the worker (`messageService.createUserMessageWithClient` inside `chatJobService.enqueueChat`).
- `message_cache_summaries` was intentionally excluded per implementation decision.
- Delete endpoint behavior follows existing pattern: `204 No Content`.
