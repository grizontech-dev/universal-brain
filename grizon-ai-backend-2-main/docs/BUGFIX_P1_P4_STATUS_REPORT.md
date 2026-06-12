# BUGFIX P1–P4 Status Report

**Spec:** [BUG_FIXES_P1_P4.md](./BUG_FIXES_P1_P4.md)  
**Status:** Implemented (2026-05-10)

## Summary

| Bug | Topic | Key changes |
|-----|--------|-------------|
| 2 | Semantic vs prompt cache telemetry | `usage_records.prompt_cache_hit`; LLM paths set `semanticCacheHit: false`, `promptCacheHit: inputCached > 0`; semantic path unchanged for semantic flag + explicit `promptCacheHit: false`. |
| 3 | Platform LLM cost | `ai_models.input_cached_cost_per_1k`; `computeCostUsd` includes cached input at DB rate; semantic `api_calls` cost still excludes phantom LLM cache tokens. |
| 1 | Anthropic keepalive | `keepalive:job:<jobId>` via `ProviderStreamParams.jobId` from router `StreamContext`. |
| 4 | Prompt compaction | Summary-aware `hydrateSession` (DB: `summary_text` + messages with `is_included_in_summary = false`); Redis invalidation after summariser commit; assembler reload with `bypassCache`; 85% hard limit + `threshold * 1.1` summariser buffer. |

## Migrations

- `038_usage_prompt_cache_hit.sql`
- `039_ai_models_cached_rate.sql`

## Verification notes

- `npm run typecheck` passes.
- `npm run test -- test/unit` passes (240 tests in main tree pattern).
- Manual §Testing Checklist in `BUG_FIXES_P1_P4.md` remains recommended for staging (DB migrations, Redis, Anthropic prompt cache, long conversations).

## Deviations from written spec text

- `ProviderStreamParams` is defined in `src/models/providers/types.ts` (not `src/types/router.ts`).
- Bug 4 required enhancing `hydrateSession` (spec assumed it already merged summaries).
- `hydrateSession(conversationId, { bypassCache: true })` used after compaction so Redis cannot serve an unstripped transcript when summariser is skipped (borderline overflow).
