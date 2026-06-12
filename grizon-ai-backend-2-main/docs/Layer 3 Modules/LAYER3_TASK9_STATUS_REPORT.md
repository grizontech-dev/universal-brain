# Layer 3 Task 9 (P6) — Phase 4 — Status Report

**Last updated:** 2026-05-09  
**Plan:** [`LAYER3_TASK9_PLAN_P6_PHASE4.md`](LAYER3_TASK9_PLAN_P6_PHASE4.md)

## Delivered

| Area | Notes |
|------|--------|
| Manual summarise jobs | [`chat.worker.ts`](../../src/workers/chat.worker.ts) handles `job.name === "summarise"` early → [`summariserService.run`](../../src/services/summariser.service.ts). Queue typing: [`ChatQueueJobData`](../../src/types/chatJob.js), [`conversation.service.ts`](../../src/services/conversation.service.ts) enqueues typed [`SummariseJobPayload`](../../src/types/chatJob.js). |
| Model picker | [`chat.controller.ts`](../../src/controllers/user/chat.controller.ts): non-null `modelId` requires `featureFlags.modelPicker` and membership in `plan.modelAccess`. [`runRouter`](../../src/router/index.ts): [`resolveForceModelId`](../../src/router/index.ts) mirrors allowlist (applies to **auto** and **agent** mode when `modelId` is set). |
| Plan snapshots | [`planSerialize.planRowToPlan`](../../src/utils/planSerialize.ts) maps `model_access` → `modelAccess`; [`Plan`](../../src/types/plan.ts) documents Module 10 allowlist semantics. |
| Feature flag type | [`modelPicker`](../../src/types/feature.d.ts) on `FeatureFlags`. |
| Enterprise seed | Migration [`037_enterprise_model_picker.sql`](../../src/db/migrations/037_enterprise_model_picker.sql): enables `modelPicker` and seeds broad `model_access` for `slug = 'enterprise'` (adjust via admin as needed). |
| Agents | [`analyst.agent.ts`](../../src/agents/analyst.agent.ts): TASK9-style prompt, tool order, `maxIterations: 6`. [`architect.agent.ts`](../../src/agents/architect.agent.ts): frontier tier, expanded prompt, `maxIterations: 6`. [`ui.agent.ts`](../../src/agents/ui.agent.ts): `html_generate` only, TASK9 prompt, `postProcess` strips accidental raw HTML. |

## Postman

[`grizon-ai-backend-2.postman_collection.json`](../../grizon-ai-backend-2.postman_collection.json): Chat enqueue description (`modelId` / `modelPicker` / `modelAccess`); **Summarise Conversation** request under Module 8.

## Operational notes

- Existing subscriptions keep frozen `plan_snapshot` JSON until renewed/upgraded; **enterprise** tenants may need a snapshot refresh to receive `modelAccess` + `modelPicker` from the live plan row after migration **037**.
- Without Redis/workers running, summarise jobs remain queued (unchanged Module 8 behaviour).
