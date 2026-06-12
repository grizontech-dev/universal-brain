# Module 10 — Smart Router

> Worker-time decision engine: turns a `ChatJobPayload` into `(agent, model, provider, tools, rewrittenQuery)` and runs the LLM call with health-aware failover.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §12](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, type contracts (`ClassificationResult`, `RoutingDecision`, `ProviderResponse`), file structure, dependencies |
| 2 | [02_ROUTER_PIPELINE.md](02_ROUTER_PIPELINE.md) | Classifier, query rewriter, model selector with plan/health gates, agent dispatcher, provider adapters (Anthropic, OpenAI, Google, xAI, DeepSeek), failover, telemetry |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, tests, verification |

## Status

- **Stage:** Implemented — `chat.worker.ts` uses `runRouter` + `streamCompletion` (see [`MODULE10_STATUS_REPORT.md`](MODULE10_STATUS_REPORT.md)).
- **Owner:** Backend
- **Last updated:** 2026-05-06

## Key Decisions

- **Router runs inside the worker, not at request time.** Classification + model selection happen on the BullMQ thread so latency isn't on the user's HTTP path and routing decisions are recorded with full context. Module 5 / Module 4 / Module 9 still gate at request time as today.
- **Two-stage classifier.** A deterministic heuristic (regex + length + attached-files signals) handles the obvious 70% of traffic in <2 ms. Ambiguous prompts fall through to a cheap classifier LLM call (Haiku-tier) with a strict JSON schema. The heuristic decision is always recorded so we can iterate on coverage offline.
- **Model selection is plan-filtered first, then complexity-mapped, then health-filtered.** A user's `plan.modelAccess` is the hard gate — we never auto-route to a model the user can't access. Within the allowed set, the cheapest model that matches the complexity tier wins. Provider-health filter runs last so a healthy `claude-sonnet-4-6` is preferred over an unhealthy `gpt-4o` even if both are allowed.
- **Manual override (`modelId` / `agentSlug` from the request body) bypasses classification but still passes plan-access and feature-flag checks** — already enforced at request time by Modules 2 and 3, re-validated at worker time in case the plan snapshot changes.
- **Provider layer is OpenAI-compatible by default.** Anthropic and Google have native SDKs (Messages API and `@google/generative-ai`); xAI and DeepSeek expose OpenAI-compatible REST and reuse the OpenAI adapter with a base-URL swap. Five adapters total, one shared streaming interface.
- **Circuit breaker per provider, not per model.** A single 5xx run from `gpt-4o` opens the circuit on `openai`; subsequent OpenAI-hosted models in the same job auto-fail over to the next provider in the fallback chain. Half-open after 30 s, closes on first success.
- **Agent definitions live in `src/agents/*` as plain TypeScript modules**, not in the database — they encode behavior (system prompt, tool list, allowed-model-tiers, multiplier reference). Agent multipliers are read from Module 4's `creditCalculator.service.ts` (database-backed). This keeps "what the agent does" in code (reviewable) and "what it costs" in admin-editable config.
- **Single classifier-LLM call per job.** Tool decisions (web_search / code_exec / file_read) are emitted by the classifier in one shot. Mid-stream tool calls during the agent loop are still allowed; the classifier's `needs*` flags only decide which tools the agent loop is even *permitted* to invoke.
- **No DB writes from Module 10 directly.** Routing decisions land on the existing `usage_records` row (Module 6 already has `agentSlug`, `modelId`, `modelProvider`, `routerLatencyMs`). Provider-health state is Redis-only (`router:health:{provider}`); admin overrides go through Module 12's `/admin/models` and `/admin/system/providers` (separate module).

## Surface

- **0 HTTP routes** — the router is a worker-time library, called from `chat.worker.ts`.
- **0 middleware** added to the global pipeline.
- **5 router files** (`src/router/{classifier,queryRewriter,modelSelector,agentDispatcher,index}.ts`)
- **1 provider abstraction** (`src/models/provider.ts`) + **5 adapters** (`src/models/providers/{anthropic,openai,google,xai,deepseek}.ts`)
- **1 agent registry** (`src/agents/index.ts` + per-agent files: `chat`, `research`, `code`, `writer`, `analyst`, `architect`, `debugger`, `ui`, `document`)
- **0 new tables.** Routing telemetry rides on Module 6's `usage_records`. Provider health is in Redis.
- **Postman groups:** *none* (no HTTP surface).

## Dependencies

- Module 1 — `req.user.id` already on the job payload
- Module 2 — `planSnapshot.modelAccess` and `planSnapshot.agentAccess` are the access gates
- Module 3 — `planSnapshot.featureFlags` (`webSearch`, `codeExecution`, `fileAnalysis`, `voiceMode`, `temperatureControl`, `customSystemPrompt`, `modelPicker`) decide what the classifier is allowed to enable
- Module 4 — agent multipliers and model credit rates read by `creditCalculator.service.ts` (worker calls Module 4 at confirm time, not at routing time)
- Module 6 — `usageTracker.record()` is the single sink for routing telemetry; Module 10 *populates* fields, never writes the row itself
- Module 7 — host worker; Module 10 exports a single `runRouter(payload)` function that returns a `RoutingDecision` and a `streamCompletion(decision)` async iterator
- Module 8 — `messageService.getRecentMessages(conversationId, limit)` for context windowing; `attachedFileIds` resolved through `fileService.getReadyFile(id)` for file-aware routing
- `src/infra/redis.ts` — provider-health circuit-breaker state
- `src/utils/{response,errors,logger}.ts` — `Errors.modelNotAllowed`, `Errors.agentNotAllowed`, `Errors.providerExhausted`, `Errors.classificationFailed`

## Modules That Will Use Module 10

| Caller | How |
|---|---|
| Module 7 — `chat.worker.ts` | Replaces the current stub. Calls `runRouter(payload)` then iterates `streamCompletion(decision)` to publish `chunk` events through `sseHub`. |
| Module 8 — `summariser.service.ts` | Uses Module 10's provider layer to call the cheapest available model with a fixed `agentSlug='summariser'` (no classification). |
| Module 12 — `POST /admin/agents/:id/test` (future) | Calls `runRouter` with a synthetic payload to preview routing decisions; never charges credits. |
