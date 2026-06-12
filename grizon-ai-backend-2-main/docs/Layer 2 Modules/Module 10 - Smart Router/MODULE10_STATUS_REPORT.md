# Module 10 — Smart Router — Status Report

**Stage:** Implemented (worker-time library)  
**Last updated:** 2026-05-06

## Summary

- **Router:** `runRouter`, `streamCompletion`, `buildNanoChatDecision` exported from [`src/router/index.ts`](../../../src/router/index.ts).
- **Providers:** Anthropic, OpenAI, Google (Generative AI), xAI, DeepSeek via [`src/models/provider.ts`](../../../src/models/provider.ts); adapters self-disable when API keys are missing.
- **Telemetry:** [`027_usage_records_router_telemetry.sql`](../../../src/db/migrations/027_usage_records_router_telemetry.sql) extends `usage_records` (`model_provider`, router fields, token breakdown, `metadata`). [`usageTracker.record`](../../../src/services/usageTracker.service.ts) updated accordingly.
- **Tools:** [`src/tools/`](../../../src/tools/) — web search (Tavily / Brave), Judge0 code execution, file read (Module 8), file generation (artifacts).
- **Tests:** Unit coverage under `test/unit/router/`; integration smoke unchanged for chat worker instantiation.

## Notes / follow-ups

- **Catalogue in code:** Model/agent catalogues live in [`src/router/catalogue.ts`](../../../src/router/catalogue.ts) and [`src/agents/`](../../../src/agents/). Admin overrides remain a Module 12 concern.
- **Agent multipliers:** Routing slugs (`research`, `code`, …) map to seed multiplier keys via [`AGENT_SLUG_TO_MULTIPLIER_KEY`](../../../src/config/credits.ts); `AGENT_MULTIPLIERS` keys unchanged.
- **Summariser:** [`summariser.service.ts`](../../../src/services/summariser.service.ts) remains deterministic; LLM summarisation via `buildNanoChatDecision` + `streamCompletion` can be wired when a plan snapshot is available at call sites.
- **Gemini tools:** Google adapter uses a flattened prompt MVP; native multi-turn tool calling can be expanded later.

## HTTP / Postman

- **0 routes** — no Postman updates.
