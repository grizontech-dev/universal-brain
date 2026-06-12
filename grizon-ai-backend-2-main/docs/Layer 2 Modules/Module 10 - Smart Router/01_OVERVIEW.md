# 01 — Overview

## Mission

Module 10 takes a `ChatJobPayload` (already authed, plan-frozen, credit-held, sanitised) and decides **what to actually call**: which agent's behavior to apply, which model to send the prompt to, which provider to hit, and which tools the agent is allowed to invoke. It then runs the LLM call with health-aware failover and returns a streaming iterator the worker pumps to SSE.

Without Module 10, every job would have to specify `agentSlug` and `modelId` explicitly, which the frontend doesn't know how to do well — and we'd have no way to fall over from a degraded provider mid-job. Module 10 is what makes "send a message" feel intelligent and resilient.

## Scope

### In scope
- `classifier.ts` — heuristic + cheap-LLM-fallback classification of intent / complexity / tool needs
- `queryRewriter.ts` — query rewrite (multi-message context compression, ambiguity resolution) for retrieval-heavy intents
- `modelSelector.ts` — `(complexity, planSnapshot, providerHealth) → modelId`
- `agentDispatcher.ts` — `(intent, planSnapshot) → agentSlug` with fallback to `chat`
- `router/index.ts` — orchestration: `runRouter(payload) → RoutingDecision`
- `src/models/provider.ts` — adapter contract: `streamCompletion(modelId, messages, tools, options) → AsyncIterable<ProviderEvent>`
- Five provider adapters: Anthropic (native Messages API), OpenAI (native), Google (native `@google/generative-ai`), xAI (OpenAI-compatible REST), DeepSeek (OpenAI-compatible REST)
- Provider-health circuit breaker (Redis-backed, per-provider)
- Agent registry (`src/agents/*`) — pure code definitions: system prompt, tool allow-list, default model tier
- Tool registry (`src/tools/*`) — `web_search` (Tavily/Brave), `code_execution` (Judge0), `file_read` (Module 8), `file_gen` (xlsx / docx / md generators)
- Telemetry hooks: every `RoutingDecision` populates Module 6's `routerLatencyMs`, `agentSlug`, `modelId`, `modelProvider`, `cacheHitLayer` fields

### Out of scope
- HTTP surface (no routes — Module 10 is invoked from `chat.worker.ts`; admin testing surface is Module 12)
- Wallet hold / confirm / release (Module 4 — worker calls confirm after Module 10's stream finishes)
- Usage record persistence (Module 6 — worker writes the row using fields Module 10 produced)
- SSE event publishing (Module 7's `sseHub`)
- BullMQ retry / cancel / DLQ (Module 7)
- Conversation persistence + summarisation (Module 8)
- Rate limiting & feature counters (Modules 5 & 3 — already enforced at request time)
- Model credit rates & agent multipliers as **data** — those live in Module 4's `creditCalculator.service.ts`. Module 10 only reads the model→provider mapping and tier metadata.
- Semantic cache (future module — `cacheHitLayer='semantic'` is a Module 10 hook, not its responsibility today)

## Inputs

| Source | What it carries |
|---|---|
| `ChatJobPayload` (Module 7) | The full request; specifically `content`, `attachedFileIds`, `agentSlug?`, `modelId?`, `options.searchContextSize?`, `options.temperature?`, `options.customSystemPrompt?`, `planSnapshot`, `userId`, `conversationId` |
| `messageService.getRecentMessages(conversationId, N)` (Module 8) | Last N messages plus `summaryText` if present, used for query rewriting and context window calculation |
| `fileService.getReadyFiles(attachedFileIds)` (Module 8) | Extracted text + vector pointers for files attached to *this* message; gates `needsFileRead` |
| Redis `router:health:{provider}` | Circuit-breaker state per provider (`closed` \| `open` \| `half_open` + `openedAt`) |
| Provider env keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, plus `*_BASE_URL` overrides for self-hosted gateways |

## Outputs

The router exports two functions to the worker:

```ts
// src/router/index.ts
export interface RoutingDecision {
  classification: ClassificationResult;        // intent, complexity, needsX, confidence
  agentSlug: string;                           // chosen agent
  modelId: string;                             // chosen model
  modelProvider: ProviderId;                   // 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek'
  fallbackChain: Array<{ modelId: string; provider: ProviderId }>; // tried in order if primary fails
  rewrittenQuery: string | null;               // null when rewrite was skipped
  systemPrompt: string;                        // composed: agent prompt + (optional) custom system prompt
  allowedTools: ToolId[];                      // intersection of agent allow-list and plan featureFlags
  source: 'manual' | 'auto';                   // 'manual' if request body specified agentSlug+modelId
  routerLatencyMs: number;                     // for Module 6
}

export async function runRouter(payload: ChatJobPayload): Promise<RoutingDecision>;

export function streamCompletion(
  decision: RoutingDecision,
  messages: ProviderMessage[],
  abortSignal: AbortSignal,
): AsyncIterable<ProviderEvent>;
```

ProviderEvent is the unified streaming protocol the worker forwards to `sseHub`:

```ts
export type ProviderEvent =
  | { type: 'chunk';        delta: string }
  | { type: 'tool_call';    toolId: ToolId; arguments: unknown; callId: string }
  | { type: 'tool_result';  callId: string; output: unknown; durationMs: number }
  | { type: 'usage';        inputTokensFresh: number; inputTokensCached: number; outputTokens: number; cacheWriteTokens: number }
  | { type: 'finish';       reason: 'stop' | 'length' | 'content_filter' | 'tool_use' | 'error'; modelUsed: string; provider: ProviderId }
  | { type: 'error';        code: string; message: string; retryable: boolean };
```

The worker maps these 1:1 to SSE events Module 7 already defines.

## Type Contracts

```ts
// src/types/router.d.ts

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek';

export type Intent =
  | 'search' | 'code' | 'write' | 'analyse' | 'design' | 'debug' | 'ui' | 'chat' | 'document';

export type Complexity = 'simple' | 'medium' | 'complex' | 'reasoning';

export type ToolId = 'web_search' | 'code_execution' | 'file_read' | 'file_gen';

export type FileGenKind = 'excel' | 'docx' | 'markdown' | 'pdf' | 'image';

export interface ClassificationResult {
  intent: Intent;
  complexity: Complexity;
  needsWebSearch: boolean;
  needsCodeExecution: boolean;
  needsFileRead: boolean;
  needsFileGen: FileGenKind[];
  searchContextSize: 'low' | 'medium' | 'high';
  suggestedAgent: string;
  confidence: number;                          // 0..1
  classifierSource: 'heuristic' | 'llm';       // for telemetry
}

export interface ModelDescriptor {
  id: string;                                  // 'claude-sonnet-4-6'
  provider: ProviderId;
  tier: 'nano' | 'standard' | 'premium' | 'frontier' | 'reasoning';
  contextWindow: number;                       // tokens
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsPromptCache: boolean;
  supportsVision: boolean;
  active: boolean;                             // admin toggle (Module 12)
}

export interface AgentDescriptor {
  slug: string;                                // 'research'
  systemPrompt: string;                        // immutable in code; admin overrides land in Module 12 (later)
  allowedTools: ToolId[];
  preferredTier: 'nano' | 'standard' | 'premium' | 'frontier' | 'reasoning';
  fallbackAgent: string | null;                // when plan blocks this agent, dispatcher picks fallback
  multiplierKey: string;                       // for creditCalculator (e.g. 'research')
}

export interface ProviderHealth {
  provider: ProviderId;
  state: 'closed' | 'open' | 'half_open';
  openedAt: string | null;                     // ISO; null when closed
  failuresInWindow: number;                    // last 60s
  lastErrorCode: string | null;
}
```

## Plan-Shape Extension (touches Module 2)

None. `Plan.modelAccess: string[]`, `Plan.agentAccess: string[]`, and `Plan.featureFlags` are already adequate. Module 10 reads them; Module 12 (later) is where admin edits them.

## File Structure

```
src/
├── router/
│   ├── classifier.ts                ← heuristic-then-LLM classification; emits ClassificationResult
│   ├── queryRewriter.ts             ← rewrites the user query when intent='search' and conversation>1 message
│   ├── modelSelector.ts             ← (complexity, plan, health) → ModelDescriptor + fallback chain
│   ├── agentDispatcher.ts           ← (intent, plan) → AgentDescriptor with fallback
│   ├── catalogue.ts                 ← MODEL_CATALOGUE, AGENT_CATALOGUE — single source of truth in code
│   ├── providerHealth.ts            ← Redis-backed circuit breaker (record success/failure, isOpen)
│   ├── tools.ts                     ← TOOL_CATALOGUE; resolves intent flags + plan featureFlags into allowedTools
│   └── index.ts                     ← runRouter(), streamCompletion(); sole export to chat.worker.ts
├── models/
│   ├── provider.ts                  ← Provider interface, registerProvider(), getProvider(), unified streamCompletion
│   └── providers/
│       ├── anthropic.ts             ← native Messages API; prompt-cache headers; tool_use blocks
│       ├── openai.ts                ← native chat.completions stream; reused by xAI / DeepSeek with base-URL swap
│       ├── google.ts                ← @google/generative-ai; function-calling; vision
│       ├── xai.ts                   ← thin wrapper: openai adapter + baseURL=https://api.x.ai/v1
│       └── deepseek.ts              ← thin wrapper: openai adapter + baseURL=https://api.deepseek.com/v1
├── agents/
│   ├── index.ts                     ← AGENT_CATALOGUE export
│   ├── chat.agent.ts
│   ├── research.agent.ts
│   ├── code.agent.ts
│   ├── writer.agent.ts
│   ├── analyst.agent.ts
│   ├── architect.agent.ts
│   ├── debugger.agent.ts
│   ├── ui.agent.ts
│   └── document.agent.ts
├── tools/
│   ├── index.ts                     ← TOOL_CATALOGUE
│   ├── webSearch.tool.ts            ← Tavily primary, Brave fallback
│   ├── codeExecution.tool.ts        ← Judge0 adapter
│   ├── fileRead.tool.ts             ← reads from Module 8 storage + Qdrant
│   └── fileGen.tool.ts              ← xlsx / docx / md / pdf generators
└── types/
    └── router.d.ts                  ← types exported above
```

No new migration. No middleware change. No HTTP route.

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | `userId`, `sessionId` already serialised on the payload |
| Module 2 — Plan & Subscription | `planSnapshot.modelAccess`, `planSnapshot.agentAccess`, `planSnapshot.featureFlags` are the gates |
| Module 3 — Feature Flags | `featureFlags.modelPicker` allows manual `modelId`; `featureFlags.temperatureControl` allows `options.temperature`; `featureFlags.customSystemPrompt` allows custom prompt |
| Module 4 — Wallet | Multiplier table read by `creditCalculator.service.ts`. Module 10 hands `agentSlug` + `modelId` to the worker; the worker calls `confirmDeduction` after the stream finishes |
| Module 5 — Rate Limit | Already passed at request time — irrelevant inside Module 10 |
| Module 6 — Usage Tracking | Module 10 *produces* `agentSlug`, `modelId`, `modelProvider`, `routerLatencyMs`, `cacheHitLayer`, `webSearchEngine`, `webSearchCount`, `codeExecutionCount`, `inputTokensFresh`, `inputTokensCached`, `cacheWriteTokens` — worker writes the row |
| Module 7 — Message Queue | Sole runtime caller. Module 10 must not crash the worker — every error path returns a `ProviderEvent` of `type: 'error'` with `retryable` set correctly |
| Module 8 — Conversation & Message | `messageService.getRecentMessages(conversationId, N)` for context; `fileService.getReadyFiles(ids)` for file-aware routing; `summariser.service.ts` *uses* Module 10 to summarise |
| `src/infra/redis.ts` | Circuit-breaker state, classifier-cache for repeated identical prompts (TTL 60 s) |
| `src/utils/{response,errors,logger}.ts` | `Errors.modelNotAllowed`, `Errors.agentNotAllowed`, `Errors.providerExhausted`, `Errors.classificationFailed`, `Errors.contextOverflow` |

## Modules That Will Use Module 10

| Downstream module | How |
|---|---|
| Module 7 — `chat.worker.ts` | Replaces stub: `const decision = await runRouter(job.data); for await (const ev of streamCompletion(decision, ...)) { … }` |
| Module 8 — `summariser.service.ts` | Calls `streamCompletion` directly with a fixed agent + cheapest model (no classification) |
| Module 12 (future) | `POST /admin/agents/:id/test` previews routing for a synthetic payload; uses `runRouter` with `dryRun=true` so no provider call is made |
