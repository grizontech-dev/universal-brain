# Layer 3 Task 1 — Streaming, Prompt Assembly & Cost Telemetry — Status Report

**Stage:** Implemented  
**Last updated:** 2026-05-08

## Summary

- **Prompt assembly:** Added [`src/prompt/assembler.ts`](../../src/prompt/assembler.ts) with `assemblePrompt(ctx)` and contracts for context truncation, token estimation, and Anthropic cache breakpoint shaping.
- **Telemetry table:** Added migration [`030_api_calls.sql`](../../src/db/migrations/030_api_calls.sql) with `api_calls` schema/indexes and additive `ai_models` pricing columns (`input_cost_per_1k`, `output_cost_per_1k`).
- **Worker integration:** Updated [`src/workers/chat.worker.ts`](../../src/workers/chat.worker.ts) to use prompt assembly and write additive `api_calls` telemetry (non-fatal on telemetry write failure).
- **Model resolution:** Updated [`src/router/modelSelector.ts`](../../src/router/modelSelector.ts) for DB-first model selection (`agents` + `agent_model_priorities` + `ai_models`) with existing in-memory fallback preserved.
- **Anthropic keepalive:** Extended [`src/models/providers/anthropic.ts`](../../src/models/providers/anthropic.ts) with Redis keepalive lifecycle and interval cleanup.
- **Provider compatibility updates:** Updated [`src/models/providers/types.ts`](../../src/models/providers/types.ts), [`src/models/providers/openai.ts`](../../src/models/providers/openai.ts), [`src/models/providers/xai.ts`](../../src/models/providers/xai.ts), and [`src/models/providers/deepseek.ts`](../../src/models/providers/deepseek.ts) for prompt-shape compatibility and missing-key graceful degradation logs.
- **Admin costs contracts:** Replaced legacy costs route with split endpoints in [`src/routes/admin/analytics.routes.ts`](../../src/routes/admin/analytics.routes.ts), controller wiring in [`src/controllers/admin/analytics.controller.ts`](../../src/controllers/admin/analytics.controller.ts), and SQL aggregation in [`src/services/analytics.service.ts`](../../src/services/analytics.service.ts).

## API Contract Status

- **Implemented endpoints (admin):**
  - `GET /api/v1/admin/analytics/costs/overview`
  - `GET /api/v1/admin/analytics/costs/by-model`
  - `GET /api/v1/admin/analytics/costs/by-agent`
- **Envelope:** Returned through shared `ok()` response helper.
- **Legacy path:** `/api/v1/admin/analytics/costs` replaced per Task 1 plan decision.

## Postman Status

- Updated [`grizon-ai-backend-2.postman_collection.json`](../../grizon-ai-backend-2.postman_collection.json):
  - Added folder **Module 23 - Admin Costs Contracts** with 3 requests:
    - `/api/v1/admin/analytics/costs/overview`
    - `/api/v1/admin/analytics/costs/by-model`
    - `/api/v1/admin/analytics/costs/by-agent`
  - Added basic test scripts for status and response shape.

## Verification Notes

- **Lint diagnostics on touched files:** no issues reported.
- **Typecheck:** local run blocked by missing dependency type resolution in current environment (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `exceljs`, `docx`), not by Task 1 code shape.

## Forward-compatibility for Task 2 / Task 3

- `api_calls.metadata` remains extensible for semantic cache and subagent attribution.
- Assembler output is structured to support later injected retrieved context.
- Worker telemetry is additive and leaves room for Task 3 cost attribution expansion.
