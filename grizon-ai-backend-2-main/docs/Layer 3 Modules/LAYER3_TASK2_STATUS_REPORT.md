# Layer 3 Task 2 — Memory Architecture & Semantic Cache — Status Report

**Stage:** Implemented  
**Last updated:** 2026-05-08

## Summary

- **DB foundations:** Added [`031_memory_facts.sql`](../../src/db/migrations/031_memory_facts.sql) and [`032_semantic_cache_hits.sql`](../../src/db/migrations/032_semantic_cache_hits.sql), including additive `users.semantic_cache_optout`.
- **Qdrant + embeddings infra:** Added [`src/infra/qdrant.ts`](../../src/infra/qdrant.ts) and [`src/lib/embeddings.ts`](../../src/lib/embeddings.ts).
- **Semantic cache module:** Added [`src/cache/semantic.cache.ts`](../../src/cache/semantic.cache.ts) with eligibility gates, lookup/write, TTL checks, and cache-hit persistence helper.
- **Memory modules:** Added [`src/memory/session.memory.ts`](../../src/memory/session.memory.ts) and [`src/memory/vector.memory.ts`](../../src/memory/vector.memory.ts) for warm session context and long-term fact recall/persistence.
- **Prompt integration:** Updated [`src/prompt/assembler.ts`](../../src/prompt/assembler.ts) to inject recalled memory under `KNOWN ABOUT USER:` in fresh suffix.
- **Worker integration:** Updated [`src/workers/chat.worker.ts`](../../src/workers/chat.worker.ts) for:
  - semantic cache pre-check and short-circuit path
  - session hydration/persistence
  - memory recall before prompt assembly
  - fire-and-forget fact extraction and semantic cache write on successful completion.
- **User memory API:** Added:
  - [`src/controllers/user/memory.controller.ts`](../../src/controllers/user/memory.controller.ts)
  - [`src/routes/user/memory.routes.ts`](../../src/routes/user/memory.routes.ts)
  - mount in [`src/routes/user/index.ts`](../../src/routes/user/index.ts) at `/api/v1/memory`.

## API Surface

- `GET /api/v1/memory`
- `DELETE /api/v1/memory/:id`
- `DELETE /api/v1/memory`

All endpoints use existing auth middleware (`req.user`) and standard response envelope helpers.

## Postman

- Updated [`grizon-ai-backend-2.postman_collection.json`](../../grizon-ai-backend-2.postman_collection.json) with **Module 18 - User Memory Contracts**:
  - list memory facts
  - delete one fact
  - purge all facts

## Notes / deviations

- Task spec references `src/lib/qdrant.ts`; implementation uses [`src/infra/qdrant.ts`](../../src/infra/qdrant.ts) to match existing repo convention (`src/infra/redis.ts`, `src/db/pool.ts`).
- Memory/cache operations are fail-open/logged so chat job completion remains unaffected by Qdrant or extraction failures.
