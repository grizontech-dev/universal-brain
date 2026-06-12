# Layer 3 Task 3 — Files, Artifacts, Subagents — Status Report

**Stage:** Implemented  
**Last updated:** 2026-05-08

## Summary

- **Migrations:** Added [`033_file_chunks.sql`](../../src/db/migrations/033_file_chunks.sql), [`034_subagent_runs.sql`](../../src/db/migrations/034_subagent_runs.sql), and [`035_artifacts_preview.sql`](../../src/db/migrations/035_artifacts_preview.sql).
- **File ingestion pipeline:** Replaced stub in [`src/workers/file.worker.ts`](../../src/workers/file.worker.ts) with processing lifecycle (processing -> ready/failed), chunking, embeddings, Qdrant upserts, and `file_chunks` persistence.
- **Upload enqueue wiring:** Updated [`src/controllers/user/file.controller.ts`](../../src/controllers/user/file.controller.ts) to enqueue file ingestion jobs on upload.
- **Retriever + tooling:** Added [`src/files/retriever.ts`](../../src/files/retriever.ts) and wired [`src/tools/fileRead.tool.ts`](../../src/tools/fileRead.tool.ts) for semantic (`sub_query`) and ordered chunk retrieval.
- **Artifact preview pipeline:** Added [`src/artifacts/artifact.storage.ts`](../../src/artifacts/artifact.storage.ts) and [`src/artifacts/preview.ts`](../../src/artifacts/preview.ts), then extended [`src/services/artifact.service.ts`](../../src/services/artifact.service.ts) for large-content offload and preview generation.
- **Subagent runtime:** Added [`src/runtime/subagent.ts`](../../src/runtime/subagent.ts), integrated multi-result web search summarisation in [`src/tools/webSearch.tool.ts`](../../src/tools/webSearch.tool.ts), and propagated subagent cost metadata in [`src/workers/chat.worker.ts`](../../src/workers/chat.worker.ts).

## API contract updates

- **File polling route:** now `GET /api/v1/files/:id` (replacing `/api/v1/files/:id/status`) in [`src/routes/user/file.routes.ts`](../../src/routes/user/file.routes.ts).
- **Artifact response fields:** `GET /api/v1/artifacts/:id` now includes `artifact.previewHtml` and `artifact.previewGeneratedAt` from service mapping.

## Postman updates

- Updated [`grizon-ai-backend-2.postman_collection.json`](../../grizon-ai-backend-2.postman_collection.json):
  - File polling request switched to `/api/v1/files/:id`.
  - Module 8 artifact contracts now include `GET /api/v1/artifacts/:id` preview assertion for markdown artifacts.
  - Added manual file ingestion validation scenario entry.

## Notes

- Task 3 spec references `src/lib/qdrant.ts`; implementation continues using [`src/infra/qdrant.ts`](../../src/infra/qdrant.ts) to remain aligned with repository infra conventions.
- Worker and subagent paths are best-effort/fail-open where required, to avoid user-facing hard failures from ingestion/summarisation dependencies.
