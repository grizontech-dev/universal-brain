# Layer 3 Task 8 (P5) — Observability — Status Report

**Last updated:** 2026-05-13  
**Plan:** [`LAYER3_TASK8_PLAN_P5_OBSERVABILITY.md`](LAYER3_TASK8_PLAN_P5_OBSERVABILITY.md)

## Delivered

| Area | Notes |
|------|--------|
| Tool Insights `tool_mode` | `GET /api/v1/admin/analytics/tool-invocations` — each item includes derived **`tool_mode`**: for **`web_search`**, values mirror `response_output.engine` (`tavily` \| `brave` \| `none`); other tools may surface `mode`, `provider`, or `source` from JSON output when present. Implementation: [`toolInvocationMode.ts`](../../src/utils/toolInvocationMode.ts), [`analytics.controller.ts`](../../src/controllers/admin/analytics.controller.ts). Admin UI: Tool Insights **View** drawer shows **Mode / engine**. |
| Cache ROI | `GET /api/v1/admin/analytics/costs/cache-roi?days=1..365` — [`analytics.controller.ts`](../../src/controllers/admin/analytics.controller.ts), [`analytics.service.ts`](../../src/services/analytics.service.ts). Semantic: `semantic_cache_hits` (`hits`, `saved_credits`). Prompt-cache USD **estimate**: `api_calls` joined to `ai_models`, `input_cached > 0`, discount factors **Anthropic 0.9**, **OpenAI 0.5**, **other providers 0** (documented assumption). Summary includes `totalUsdSpent`, `promptCacheUsdSaved`, `semanticCreditsSaved`, `savingsPercent` (prompt USD vs spend+savings). |
| Live metrics | `GET /api/v1/admin/analytics/live` — [`liveMetrics.service.ts`](../../src/services/liveMetrics.service.ts): Redis keys `metrics:cache:semantic:{date}`, `metrics:cache:prompt:{date}`, `metrics:provider:{id}:ok|err:{date}`, `metrics:agent:{slug}:calls:{date}` with **48h TTL**. Snapshot uses **`AGENT_CATALOGUE`** keys for agents. |
| Chat worker | [`chat.worker.ts`](../../src/workers/chat.worker.ts): `recordSemanticHit` on semantic cache completion; `recordLlmSuccess` after successful wallet confirm (provider ok, agent calls, prompt counter when `input_cached > 0`); `recordProviderFailure` on terminal failure except **user cancel**. All writes best-effort (errors swallowed inside service). |
| System health providers | **No change:** [`system.controller.ts`](../../src/controllers/admin/system.controller.ts) already returns [`providerHealth.snapshot()`](../../src/router/providerHealth.ts) as `providers` (P3). |

## Postman

[`grizon-ai-backend-2.postman_collection.json`](../../grizon-ai-backend-2.postman_collection.json): **Analytics Tool Invocations** (optional `tool_name=web_search`); **Analytics Costs Cache ROI**, **Analytics Live Metrics** (admin folder); **Module 23** entries with tests for ROI + live response shape.

## Operational notes

- Live counters require Redis; if unavailable, `GET .../live` returns zeros.
- Prompt-cache ROI is an **estimate** (billing rules vary); extend SQL if providers gain documented cache discounts.
- Docs path correction: cache ROI admin URL is under **`/api/v1/admin/analytics/`**, not `/admin/costs/...` alone.
