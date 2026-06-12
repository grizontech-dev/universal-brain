# Layer 3 Task 7 (P4) — Agent runtime gaps — Status Report

**Last updated:** 2026-05-09  
**Plan:** [`LAYER3_TASK7_PLAN_P4_AGENT_GAPS.md`](LAYER3_TASK7_PLAN_P4_AGENT_GAPS.md)

## Delivered

| Area | Notes |
|------|--------|
| `deep_research` agent | [`src/agents/deep_research.agent.ts`](src/agents/deep_research.agent.ts) — premium tier, fallback `research`, `maxIterations: 10`, tools `web_search`, `web_fetch`, `file_read`, `file_gen`. Registered in [`src/agents/index.ts`](src/agents/index.ts). |
| Credits | [`src/config/credits.ts`](src/config/credits.ts) — `AGENT_SLUG_TO_MULTIPLIER_KEY.deep_research` → `deepResearch` (2.0×). |
| Routing | [`pickAgent`](src/router/agentDispatcher.ts) — `search` + `complexity === complex"` + `agentAccess` includes `deep_research` + `featureFlags.deepResearch` → `deep_research`. [`runRouter`](src/router/index.ts) passes classification into `pickAgent`. |
| Auto tools | [`ambientToolsForAuto`](src/router/tools.ts) — `deep_research` gets ambient `web_fetch`, `file_gen`, `file_read` (flag-gated like other tools). |
| Citations | [`accumulateWebSearchCitations`](src/agents/researchSources.ts) from `web_search` tool results (URL-deduped). Worker appends **Sources** via `postProcess`, SSE chunk for trailing delta, [`messageService.finalise`](src/services/message.service.ts) receives `citations`. |
| Hooks | [`AgentDescriptor`](src/types/router.ts) — optional `preflight`, `postProcess`, `maxIterations`. Research agents implement short-query preflight + source appendix. |
| Preflight failure | [`chat.worker.ts`](src/workers/chat.worker.ts) — before assistant placeholder: hold released (`preflight_failed`), job failed, SSE `PREFLIGHT_FAILED`, usage + telemetry recorded. |
| Tool rounds cap | [`streamCompletion`](src/router/index.ts) — uses `getAgent(slug)?.maxIterations ?? 10` instead of a fixed `10`. |
| Tool whitelist | Unchanged from P1 — [`executeTool`](src/tools/executor.ts) / [`runToolsBatch`](src/tools/executor.ts) still enforce `allowedTools`. |

## Tests

| File | Coverage |
|------|-----------|
| [`test/unit/router/agentDispatcher.test.ts`](../../test/unit/router/agentDispatcher.test.ts) | Complex search → `deep_research`; flag off → `research`; simple complexity stays `research`. |
| [`test/unit/agents/researchSources.test.ts`](../../test/unit/agents/researchSources.test.ts) | Preflight, markdown appendix, dedupe, multiplier `deep_research` → 2.0. |

## Operational notes

- Plans must include **`deep_research`** in `agent_access` and enable **`deepResearch`** in feature flags for auto-routing and direct agent mode (see [`docs/AGENT_LLM_CATALOGUE.md`](../AGENT_LLM_CATALOGUE.md)).
- Free seed remains without deep research unless migrated/admin-updated.

## Postman

No API contract changes for this task; Postman collection unchanged.
