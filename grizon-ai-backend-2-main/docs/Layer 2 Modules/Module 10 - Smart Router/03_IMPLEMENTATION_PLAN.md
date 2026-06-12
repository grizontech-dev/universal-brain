# 03 — Implementation Plan

Concrete, ordered build for Module 10. Modules 1, 2, 3, 4, 6, 7, 8 are required upstream — Module 7's worker has a stub today that this module replaces. Module 9 is independent. Modules 11/12 do not depend on this and can ship in parallel.

## Files to Create

| Path | Purpose |
|---|---|
| `src/types/router.d.ts` | `ProviderId`, `Intent`, `Complexity`, `ToolId`, `ClassificationResult`, `ModelDescriptor`, `AgentDescriptor`, `ProviderHealth`, `RoutingDecision`, `ProviderEvent`, `ProviderMessage`, `ToolSpec` |
| `src/router/catalogue.ts` | `MODEL_CATALOGUE` (13 entries — see [02 §E](02_ROUTER_PIPELINE.md)) and `AGENT_CATALOGUE` (9 agents). Pure data, no I/O. |
| `src/router/classifier.ts` | `classify(content, attachedFileCount, conversationLength)` → `Promise<ClassificationResult>`. Heuristic first; LLM fallback via `provider.streamCompletion` with strict JSON; Redis cache by `sha256(content)` TTL 60 s. |
| `src/router/queryRewriter.ts` | `rewriteQuery(content, recentMessages, summaryText)` → `Promise<string \| null>`. Skipped when conversation has ≤1 message or intent is not `search`/`document`. 800 ms hard timeout. |
| `src/router/modelSelector.ts` | `selectModel(tier, planSnapshot, healthMap)` → `{ primary, fallbackChain }`. Plan filter → tier filter → health sort → provider-dedup. |
| `src/router/agentDispatcher.ts` | `pickAgent(intent, planSnapshot)` → `AgentDescriptor`. Walks `fallbackAgent` ladder until plan-allowed; ultimate fallback = `chat`. |
| `src/router/tools.ts` | `TOOL_CATALOGUE`, `resolveAllowedTools(classification, agent, plan)` → `ToolId[]`, `toolSpecsFor(toolIds)` → `ToolSpec[]` (provider-shaped tool definitions). |
| `src/router/providerHealth.ts` | Redis-backed circuit breaker. `recordSuccess(p)`, `recordFailure(p, err)`, `isOpen(p)`, `snapshot()` → `Map<ProviderId, ProviderHealth>`. |
| `src/router/index.ts` | `runRouter(payload)` orchestrates A→F; `streamCompletion(decision, messages, abortSignal)` runs failover loop (see [02 §G.6](02_ROUTER_PIPELINE.md)). Sole export consumed by `chat.worker.ts`. |
| `src/models/provider.ts` | `Provider` interface, `registerProvider`, `getProvider`. Imports the five adapters and registers them at module load. |
| `src/models/providers/anthropic.ts` | Native `@anthropic-ai/sdk` Messages API streaming; `cache_control` headers; `tool_use` block parsing; usage event mapping. |
| `src/models/providers/openai.ts` | `createOpenAIProvider({ id, baseURL, apiKey, capabilities })` — generic factory. `chat.completions.create({ stream: true })`; tool-call delta accumulation; cached-token usage. |
| `src/models/providers/google.ts` | `@google/generative-ai` `generateContentStream`; function-calling; `usageMetadata` mapping. |
| `src/models/providers/xai.ts` | 1 export: `xaiProvider = createOpenAIProvider({ id:'xai', baseURL: env.XAI_BASE_URL, apiKey: env.XAI_API_KEY, capabilities: { promptCache:false, vision:false } })`. |
| `src/models/providers/deepseek.ts` | Same pattern, `baseURL: 'https://api.deepseek.com/v1'`. |
| `src/agents/index.ts` | Re-exports `AGENT_CATALOGUE` from `router/catalogue.ts` so consumers can `import { AGENT_CATALOGUE } from '@/agents'`. |
| `src/agents/chat.agent.ts` | `systemPrompt`, `allowedTools: []`, `preferredTier: 'nano'`, `fallbackAgent: null`, `multiplierKey: 'chat'`. |
| `src/agents/research.agent.ts` | `allowedTools: ['web_search']`, `preferredTier: 'standard'`, `fallbackAgent: 'chat'`, `multiplierKey: 'research'`. |
| `src/agents/code.agent.ts` | `allowedTools: ['code_execution', 'file_read']`, `preferredTier: 'standard'`, `fallbackAgent: 'chat'`, `multiplierKey: 'code'`. |
| `src/agents/writer.agent.ts` | `allowedTools: ['file_gen']`, `preferredTier: 'standard'`, `fallbackAgent: 'chat'`, `multiplierKey: 'writer'`. |
| `src/agents/analyst.agent.ts` | `allowedTools: ['code_execution', 'file_read', 'file_gen']`, `preferredTier: 'premium'`, `fallbackAgent: 'chat'`, `multiplierKey: 'analyst'`. |
| `src/agents/architect.agent.ts` | `allowedTools: ['file_read']`, `preferredTier: 'premium'`, `fallbackAgent: 'writer'`, `multiplierKey: 'architect'`. |
| `src/agents/debugger.agent.ts` | `allowedTools: ['code_execution', 'file_read']`, `preferredTier: 'standard'`, `fallbackAgent: 'code'`, `multiplierKey: 'debugger'`. |
| `src/agents/ui.agent.ts` | `allowedTools: ['file_gen']`, `preferredTier: 'standard'`, `fallbackAgent: 'code'`, `multiplierKey: 'ui'`. |
| `src/agents/document.agent.ts` | `allowedTools: ['file_read', 'file_gen']`, `preferredTier: 'standard'`, `fallbackAgent: 'writer'`, `multiplierKey: 'document'`. |
| `src/tools/index.ts` | `TOOL_CATALOGUE`, `executeTool(toolId, args, ctx)` dispatcher (called from the agent loop in `chat.worker.ts`). |
| `src/tools/webSearch.tool.ts` | Tavily primary, Brave fallback. Returns `{ results: [{ url, title, snippet }], engine }`. |
| `src/tools/codeExecution.tool.ts` | Judge0 adapter. Stdin/stdout/stderr; 10 s timeout; sandbox language whitelist. |
| `src/tools/fileRead.tool.ts` | Reads from Module 8: `fileService.getReadyFile(id)` → returns extracted text or vector hits via Qdrant. |
| `src/tools/fileGen.tool.ts` | Generates files (xlsx via `exceljs`, docx via `docx`, md/pdf via existing utilities). Uploads to storage; returns `{ artifactId }` to the agent loop, which Module 8's `artifactService.createArtifact` persists. |
| `test/unit/router/classifier.test.ts` | Heuristic coverage: 30 prompts → expected intent/complexity. LLM fallback returns valid schema; cache hit on identical content; safe default on parse failure. |
| `test/unit/router/modelSelector.test.ts` | Plan filter; tier match; tier upgrade; provider dedup in fallback chain; throws `Errors.modelNotAllowed` when plan has no candidate. |
| `test/unit/router/agentDispatcher.test.ts` | Each intent maps to expected agent on a Free plan; ladder fallback when intent's primary blocked; ultimate fallback to `chat`. |
| `test/unit/router/providerHealth.test.ts` | Closed → open after 3 failures in 60 s; auto half-open after 30 s; success closes; failure during half-open re-opens with reset timer. |
| `test/unit/router/tools.test.ts` | `resolveAllowedTools` is the intersection of agent + classification + plan flag for every combination. |
| `test/unit/models/openai.adapter.test.ts` | Streaming token deltas; tool-call accumulation across deltas; cached-token usage parsing; abort signal propagation. |
| `test/unit/models/anthropic.adapter.test.ts` | Same shape; `cache_control` header injected when expected. |
| `test/unit/models/google.adapter.test.ts` | `usageMetadata` mapping. |
| `test/integration/router/runRouter.test.ts` | End-to-end with stub providers: manual override path; auto-route path; classifier-LLM-fallback path; provider exhausted (all open) → `Errors.providerExhausted`. |
| `test/integration/router/streamCompletion.test.ts` | Primary fails → fallback succeeds; mid-stream error → emits `error` event, no fallover; abort signal stops the stream cleanly. |

## Files to Modify

| Path | Change |
|---|---|
| `src/workers/chat.worker.ts` | Replace stub block (lines ~24-89) with: `runRouter(job.data)` → `streamCompletion(decision, messages, abortSignal)` → forward each `ProviderEvent` to `sseHub.publish`. Wallet `confirmDeduction` now uses real `decision.modelId` + `decision.agentSlug` and the provider's actual `inputTokens`/`outputTokens`. Usage record receives the full telemetry bundle. Pseudocode in [02 §H](02_ROUTER_PIPELINE.md). |
| `src/services/chatJob.service.ts` | None — already passes `agentSlug` and `modelId` through unchanged. |
| `src/utils/errors.ts` | Add `Errors.modelNotAllowed`, `Errors.agentNotAllowed`, `Errors.providerExhausted`, `Errors.classificationFailed` (logged-only, no HTTP), `Errors.contextOverflow`. |
| `src/services/creditCalculator.service.ts` (Module 4) | Verify `agentMultiplier(agentSlug)` covers all 9 multiplier keys (`chat`, `research`, `code`, `writer`, `analyst`, `architect`, `debugger`, `ui`, `document`). Add any missing rows to the multipliers seed migration; do **not** rename existing keys. Flag in PR. |
| `src/services/summariser.service.ts` (Module 8) | Switch from any direct provider call to `streamCompletion` from Module 10 with `agentSlug='chat'` and a synthetic `RoutingDecision` that pins `modelId` to `selectModel('nano', planSnapshot, …).primary.id`. Keep summariser logic; only swap the LLM call. |
| `src/config/env.ts` | Add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, plus optional `*_BASE_URL` overrides. All required at boot if any provider in catalogue references them — fail-fast with a clear list of missing keys. |
| `src/app.ts` | No middleware-pipeline change. No route mount. (Module 10 is worker-side.) |
| `docs/LLM_NEW_MODULE_PROMPT.md` | No Postman group entries (Module 10 has no HTTP surface). Add a one-line note in the *Middleware Stack* section: "Module 10 runs inside `chat.worker.ts` after the global pipeline; it does not add or reorder middleware." |
| `grizon-ai-backend-2.postman_collection.json` | No additions. |

## Reused Utilities (do not re-implement)

- `src/infra/redis.ts` — circuit-breaker state, classifier cache
- `src/utils/{response,errors,logger}.ts`
- Module 4's `creditCalculator.service.ts` — agent multipliers + model rates
- Module 6's `usageTracker.record` — single sink for telemetry
- Module 7's `sseHub.service.ts` — `ProviderEvent` → SSE event mapping
- Module 8's `messageService.getRecentMessages`, `fileService.getReadyFiles`, `artifactService.createArtifact`
- BullMQ `Job.signal` — passed to `streamCompletion` as `abortSignal`

## Implementation Order

1. **Types** — `src/types/router.d.ts`. Every other file in this module imports from here. Build fails fast if a contract drifts.
2. **Catalogue** — `router/catalogue.ts` (`MODEL_CATALOGUE`, `AGENT_CATALOGUE`). Pure data; trivial to review.
3. **Provider base** — `models/provider.ts` (interface + registry).
4. **OpenAI adapter** — `models/providers/openai.ts` as a factory. Implement streaming first; tool-call accumulation second; usage parsing last. Unit-test against a recorded stream.
5. **xAI + DeepSeek adapters** — 20 lines each, both reuse the OpenAI factory with `baseURL` swap. Smoke-test with a real key.
6. **Anthropic adapter** — `models/providers/anthropic.ts`. Cache control + tool blocks are the gotchas.
7. **Google adapter** — `models/providers/google.ts`. Function-call schema differs from OpenAI; isolate the conversion.
8. **Provider health** — `router/providerHealth.ts`. Pure Redis logic; unit-test the state machine.
9. **Agent registry** — nine agent files + `agents/index.ts`. Just data; copy paste the table.
10. **Tools** — `tools/webSearch.tool.ts`, `tools/codeExecution.tool.ts`, `tools/fileRead.tool.ts`, `tools/fileGen.tool.ts`. Each wraps an existing service or vendor SDK. **`webSearch` and `codeExecution` ship first** because the agent loop in step 12 depends on them; `fileGen` is last (tied to Module 8 artifact creation).
11. **Router stages** — in order: `classifier.ts` → `queryRewriter.ts` → `agentDispatcher.ts` → `modelSelector.ts` → `tools.ts`. Unit-test each in isolation before composing.
12. **Router orchestrator** — `router/index.ts` (`runRouter` + `streamCompletion`). This is where the agent loop (max 10 iterations, tool-call → tool-result → continue) lives. Integration-test against stub providers.
13. **Wire into worker** — modify `src/workers/chat.worker.ts`. Keep the existing wallet/usage/sseHub plumbing; replace only the stub LLM call. Run the existing Module 7 integration tests — they should pass without modification once Module 10 returns realistic provider events.
14. **Update Module 8 summariser** — swap to Module 10's `streamCompletion`. Re-run Module 8 integration tests.
15. **Errors + env** — add the five new factories; finalise env vars.
16. **Tests** — unit first, then integration, then end-to-end with one real provider key in dev.

## Verification

```bash
npm run build
npm test -- test/unit/router/classifier.test.ts
npm test -- test/unit/router/modelSelector.test.ts
npm test -- test/unit/router/agentDispatcher.test.ts
npm test -- test/unit/router/providerHealth.test.ts
npm test -- test/unit/router/tools.test.ts
npm test -- test/unit/models/openai.adapter.test.ts
npm test -- test/unit/models/anthropic.adapter.test.ts
npm test -- test/unit/models/google.adapter.test.ts
npm test -- test/integration/router/runRouter.test.ts
npm test -- test/integration/router/streamCompletion.test.ts
# Module 7 worker tests must still pass with the new router in place:
npm test -- test/integration/workers/chat.worker.test.ts
npm test -- test/integration/routes/chat.user.routes.test.ts
```

Manual smoke (with at least Anthropic + one OpenAI-compatible key in dev):

1. As a Pro user, `POST /api/v1/chat { conversationId, clientMessageId, content: 'What's the capital of France?' }` → SSE shows `processing { agentSlug:'chat', modelId:'claude-haiku-4-5', modelProvider:'anthropic' }` (heuristic intent='chat', complexity='simple') → tokens stream → `usage` → `done`. `usage_records` row has `agentSlug='chat'`, `modelProvider='anthropic'`, `routerLatencyMs<10`.
2. `POST /chat { content: 'Search the latest news on the AI Act and summarise the top 3 changes' }` → SSE shows `agentSlug:'research'`, `modelId:'claude-sonnet-4-6'` (or equivalent standard-tier), and an early `tool_call { toolId:'web_search' }` event. `metadata.classifierSource='heuristic'`, `webSearchUsed=true`.
3. `POST /chat { content: 'Generate an Excel of revenue by month for the past year' }` → `agentSlug:'document'`, `needsFileGen:['excel']`, ends with `artifact` SSE event and a row in `artifacts`.
4. Manual override path: `POST /chat { agentSlug:'analyst', modelId:'gpt-4o', content:'…' }` for a Pro user (Pro plan has both in `agentAccess` / `modelAccess`) → `decision.source='manual'`, classifier still runs but is ignored for routing. Same body for a Free user → 403 `MODEL_NOT_ALLOWED`.
5. **Failover smoke:** set `ANTHROPIC_API_KEY=invalid`. `POST /chat { content:'Hello' }` → primary fails fast (401, non-retryable from Anthropic) → fallback to OpenAI → tokens stream successfully. `usage_records.modelProvider='openai'`, `metadata.fallbacksTried=1`. Restore the key.
6. **Circuit-breaker smoke:** kill Anthropic three times in 60 s (point base URL at a 502-returning stub). Fourth `POST /chat` skips Anthropic entirely without trying it. After 30 s, the next request half-opens and tries again.
7. **All-providers-open:** open the circuit on every provider in the user's plan. `POST /chat` → SSE `error` event with `code:'PROVIDER_EXHAUSTED'`. `chat_jobs.status='failed'`. Hold released.
8. **Manual classifier-cache hit:** send the same `content` twice within 60 s from different conversations → second job's `metadata.classifierSource='heuristic'` if heuristic-classified, OR `metadata.classifierLLMCacheHit=true` if LLM-classified. `routerLatencyMs` is much smaller on the second call.
9. **Reasoning-tier override:** `POST /chat { modelId:'o1', content:'Prove that …' }` for an Enterprise user → `tools:[]` enforced (o1 doesn't support tools), `temperature` ignored, response streams. Confirm in `usage_records.modelId='o1'`.

## Risks / Notes

- **Single classifier call per job is a tradeoff.** The classifier produces tool-need flags from the user's first message only. If the conversation evolves (e.g. turn 5 needs web_search but turn 1 didn't), the agent loop can still invoke `web_search` mid-stream — the classifier flags only decide what tools are *registered* with the provider. Tool registration is per-job; an unregistered tool can't be called. We accept that some jobs may classify wrong and forfeit a tool. Revisit if `tool_unavailable_post_classification` log gets noisy.
- **Mid-stream failover is not supported.** Once a provider has yielded any `chunk` event, we don't switch — the partial response is committed. If the provider then errors, the worker emits `error` and BullMQ retries the whole job (Module 7). This matches Module 7's existing decision; no partial-resume.
- **Catalogue lives in code, not DB.** Admin can't change `MODEL_CATALOGUE` from the panel today. Module 12 will move `active`, `tier`, `contextWindow` to a `models` table later — until then, model rate changes ship via deploy. This is acceptable for a launch surface; flag in `MODULE10_STATUS_REPORT.md` once written.
- **Provider keys at boot.** Adapters self-disable when their `*_API_KEY` is unset (don't crash the process). Boot logs which providers are active. Health snapshot reports them as `state='disabled'` for clarity. Catalogue entries pointing at disabled providers are filtered out of `MODEL_CATALOGUE` at load time so the selector never picks them.
- **OpenAI-compatible drift.** xAI and DeepSeek implement *most* of the OpenAI spec but occasionally differ on usage-payload field names (e.g. `prompt_tokens_details.cached_tokens`). The `createOpenAIProvider` factory takes a `usageMapper` override; default is OpenAI's; xAI/DeepSeek override on first divergence we observe.
- **Reasoning models (o1, deepseek-reasoner)** are tool-incompatible. The selector will pick them when `complexity='reasoning'`, but the agent dispatcher will produce an agent with no tools. If the user's intent demands a tool (e.g. `intent='search'` but `complexity='reasoning'`) we *downgrade complexity* to `complex` to keep tools usable. Document in `02_ROUTER_PIPELINE.md` when implementing — the selector enforces this with `if (toolsRequired && model.tier === 'reasoning') skip`.
- **Classifier model is system-paid.** It runs on the cheapest available nano regardless of the user's plan. Adds a fixed ~$0.0001 per ambiguous prompt. Track total classifier-LLM spend in `usage_records.metadata.classifierProvider` so finance can attribute it.
- **Catalogue + plans must agree.** If admin's plan editor allows `modelAccess: ['gpt-5']` but `gpt-5` isn't in `MODEL_CATALOGUE`, the selector throws. Add a check in Module 2's plan validator: every `modelAccess` entry must exist in the catalogue. Cross-module test in `test/integration/plan/catalogue.consistency.test.ts`.
- **Tool registry coupling.** `tools/fileGen.tool.ts` calls Module 8's `artifactService.createArtifact`. If Module 8 isn't deployed, file_gen returns an `error` tool result — caught by the agent loop and surfaced in the assistant message. No worker crash.
- **Latency budget for classifier-LLM call.** 600 ms p95. Hard timeout at 1.2 s with `AbortController`; on timeout, fall back to the safe default (`chat`/`medium`). Don't let a slow classifier delay the user-visible first token.
