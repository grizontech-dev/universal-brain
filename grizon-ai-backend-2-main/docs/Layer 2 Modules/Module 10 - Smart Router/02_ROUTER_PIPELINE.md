# 02 — Router Pipeline, Providers, Failover

End-to-end contracts: how a `ChatJobPayload` becomes a `RoutingDecision`, how the provider stream is run with failover, and how telemetry feeds Module 6.

The pipeline runs **inside `chat.worker.ts`** on the BullMQ thread, after the worker has read the job and before any wallet/usage write.

```
ChatJobPayload
   │
   ▼  ┌─────────────────────────────────────────────────────────────┐
      │ A. Manual override?                                         │
      │    if payload.agentSlug && payload.modelId                  │
      │       → revalidate plan access, skip B / C / D, jump to F   │
      └─────────────────────────────────────────────────────────────┘
   │
   ▼  ┌─────────────────────────────────────────────────────────────┐
      │ B. Classifier (heuristic → LLM fallback)                    │
      │    → ClassificationResult                                   │
      └─────────────────────────────────────────────────────────────┘
   │
   ▼  ┌─────────────────────────────────────────────────────────────┐
      │ C. Query rewriter (only if intent ∈ {search, document})     │
      │    → rewrittenQuery (or null)                               │
      └─────────────────────────────────────────────────────────────┘
   │
   ▼  ┌─────────────────────────────────────────────────────────────┐
      │ D. Agent dispatcher (intent + planSnapshot.agentAccess)     │
      │    → AgentDescriptor                                        │
      └─────────────────────────────────────────────────────────────┘
   │
   ▼  ┌─────────────────────────────────────────────────────────────┐
      │ E. Model selector                                           │
      │    (agent.preferredTier, planSnapshot.modelAccess,          │
      │     providerHealth) → primary + fallbackChain               │
      └─────────────────────────────────────────────────────────────┘
   │
   ▼  ┌─────────────────────────────────────────────────────────────┐
      │ F. Tool resolver                                            │
      │    intersection(agent.allowedTools, plan.featureFlags,      │
      │                 classification.needsX) → allowedTools       │
      └─────────────────────────────────────────────────────────────┘
   │
   ▼  RoutingDecision  ──→  streamCompletion()  ──→  AsyncIterable<ProviderEvent>
```

---

## A. Manual Override

When the request body carries both `agentSlug` and `modelId` and the plan allows `featureFlags.modelPicker`:

```ts
1. Re-validate plan.modelAccess.includes(modelId)        → else Errors.modelNotAllowed
2. Re-validate plan.agentAccess.includes(agentSlug)      → else Errors.agentNotAllowed
3. Skip classifier & dispatcher; build RoutingDecision with:
     classification = { intent: 'chat', complexity: 'medium', confidence: 1, classifierSource: 'heuristic' (synthetic), … }
     source = 'manual'
4. Still run model selector to pick fallbackChain from the same tier (in case the chosen model is unhealthy).
```

`agentSlug` alone (no `modelId`) → run the dispatcher's plan-revalidation only, then proceed to E with `agent.preferredTier`.
`modelId` alone (no `agentSlug`) → classifier still runs, dispatcher picks an agent, then selector is forced to the requested model.

---

## B. Classifier

### B.1 Heuristic stage

Pure code; no I/O. Targets <2 ms p95.

```ts
// src/router/classifier.ts (sketch)

const URL_RE = /\bhttps?:\/\/\S+/i;
const CODE_RE = /```|`[^`]+`|^\s*(class|function|def|import|const|let|var)\b/m;
const FILE_GEN_RE = /\b(create|generate|make|export)\s+(an?\s+)?(excel|xlsx|spreadsheet|word|docx|pdf|markdown|md)\b/i;
const REASONING_RE = /\b(think step by step|reason through|prove|derive|complexity|big-?o)\b/i;

function heuristic(content: string, attachedFileCount: number, conversationLength: number): ClassificationResult | null {
  const flags = {
    hasUrl: URL_RE.test(content),
    hasCode: CODE_RE.test(content),
    hasFileGen: FILE_GEN_RE.test(content),
    isLong: content.length > 500,
    isShort: content.length < 60,
    isReasoning: REASONING_RE.test(content),
    hasAttachments: attachedFileCount > 0,
  };

  // High-confidence shortcuts
  if (flags.isShort && !flags.hasCode && !flags.hasFileGen && !flags.hasAttachments && conversationLength < 4) {
    return { intent: 'chat', complexity: 'simple', needsWebSearch: false, …, confidence: 0.9, classifierSource: 'heuristic' };
  }
  if (flags.hasCode || /\b(bug|error|stack ?trace|exception)\b/i.test(content)) {
    return { intent: 'debug', complexity: 'medium', …, confidence: 0.85, classifierSource: 'heuristic' };
  }
  if (flags.hasFileGen) {
    return { intent: 'document', needsFileGen: detectKinds(content), complexity: 'medium', …, confidence: 0.9, classifierSource: 'heuristic' };
  }
  if (flags.hasUrl || /\b(latest|today|news|current|recent|2026|search)\b/i.test(content)) {
    return { intent: 'search', needsWebSearch: true, searchContextSize: flags.isLong ? 'medium' : 'low', complexity: 'medium', …, confidence: 0.8, classifierSource: 'heuristic' };
  }
  if (flags.isReasoning) {
    return { intent: 'analyse', complexity: 'reasoning', …, confidence: 0.75, classifierSource: 'heuristic' };
  }

  return null; // ambiguous → fall through to LLM stage
}
```

### B.2 LLM fallback stage

When the heuristic returns `null` (≈30% of traffic). Uses the cheapest available **nano-tier** model the system has access to (not the user's plan — this is system-paid) with strict JSON mode.

```ts
const CLASSIFIER_MODEL = pickNanoForClassifier();   // first healthy of: gpt-4o-mini, claude-haiku-4-5, gemini-flash-lite, deepseek-chat
const CLASSIFIER_PROMPT = `
Classify the user's request. Return ONLY valid JSON matching this schema:
{
  "intent": "search|code|write|analyse|design|debug|ui|chat|document",
  "complexity": "simple|medium|complex|reasoning",
  "needsWebSearch": boolean,
  "needsCodeExecution": boolean,
  "needsFileRead": boolean,
  "needsFileGen": ["excel"|"docx"|"markdown"|"pdf"|"image"],
  "searchContextSize": "low|medium|high",
  "suggestedAgent": "chat|research|code|writer|analyst|architect|debugger|ui|document",
  "confidence": 0.0..1.0
}`;
```

**Caching:** the classifier prompt is cached by `sha256(content)` in Redis with TTL 60 s. Identical prompts within 60 s (common during reload-spam) skip the LLM call.

**Failure path:** if the classifier itself errors (provider down, JSON parse fail), fall back to a safe default: `{ intent:'chat', complexity:'medium', confidence:0, classifierSource:'llm' }` and log `router_classifier_fallback`. Job continues — never block on classifier failure.

### B.3 Telemetry

`classifierSource` and `confidence` ride to Module 6 via the `usage_records` row (worker copies them onto `metadata`). Used offline to grow the heuristic's coverage.

---

## C. Query Rewriter

Runs only when:
- `intent ∈ { search, document }`, AND
- `messageService.getRecentMessages(conversationId, 6).length > 1`, AND
- `planSnapshot.featureFlags.queryRewrite !== false` (default on).

```ts
async function rewriteQuery(originalContent, recentMessages, summaryText): Promise<string | null> {
  // Cheapest healthy nano model.
  const messages = [
    { role: 'system', content: 'Rewrite the user\'s last message into a self-contained query that includes any context from prior turns. Keep it under 200 tokens. Return only the rewritten query, no preamble.' },
    ...recentMessages.map(m => ({ role: m.role, content: m.content })),
  ];
  const out = await provider.streamCompletion(NANO_MODEL_ID, messages, { tools: [], stream: false }).collect();
  return out.text.trim() || null;
}
```

Returns `null` on failure — worker uses original `content`. Latency budget: 800 ms; abort on timeout.

---

## D. Agent Dispatcher

Pure mapping table with a fallback ladder.

```ts
const AGENT_FOR_INTENT: Record<Intent, string> = {
  search:   'research',
  code:     'code',
  write:    'writer',
  analyse:  'analyst',
  design:   'architect',
  debug:    'debugger',
  ui:       'ui',
  document: 'document',
  chat:     'chat',
};

function pickAgent(intent: Intent, planSnapshot: Plan): AgentDescriptor {
  let candidate = AGENT_FOR_INTENT[intent];
  while (!planSnapshot.agentAccess.includes(candidate)) {
    const desc = AGENT_CATALOGUE[candidate];
    if (!desc.fallbackAgent) return AGENT_CATALOGUE['chat'];   // ultimate fallback
    candidate = desc.fallbackAgent;
  }
  return AGENT_CATALOGUE[candidate];
}
```

Fallback ladders defined in `AGENT_CATALOGUE`:

| Intent    | Primary    | Fallback    | Final  |
|-----------|------------|-------------|--------|
| search    | research   | chat        | chat   |
| code      | code       | chat        | chat   |
| write     | writer     | chat        | chat   |
| analyse   | analyst    | chat        | chat   |
| design    | architect  | writer      | chat   |
| debug     | debugger   | code        | chat   |
| ui        | ui         | code        | chat   |
| document  | document   | writer      | chat   |
| chat      | chat       | —           | chat   |

`chat` agent is always in every plan's `agentAccess` (enforced by Module 2 plan validator — note in Module 2 status report).

---

## E. Model Selector

Three filters applied in order:

```ts
function selectModel(tier: Tier, planSnapshot: Plan, healthMap: Map<ProviderId, ProviderHealth>): {
  primary: ModelDescriptor;
  fallbackChain: ModelDescriptor[];
} {
  // 1. Plan filter
  const planAllowed = MODEL_CATALOGUE.filter(m => planSnapshot.modelAccess.includes(m.id) && m.active);

  // 2. Tier filter — match preferredTier first, allow one tier higher if no match
  const tierMatched = planAllowed.filter(m => m.tier === tier);
  const candidates  = tierMatched.length > 0 ? tierMatched : planAllowed.filter(m => isHigherOrEqual(m.tier, tier));
  if (candidates.length === 0) throw Errors.modelNotAllowed({ tier, planId: planSnapshot.id });

  // 3. Health filter — closed > half_open > open
  const sorted = candidates.sort((a, b) => healthRank(healthMap.get(a.provider)) - healthRank(healthMap.get(b.provider)));

  return { primary: sorted[0], fallbackChain: sorted.slice(1, 4) };  // up to 3 fallbacks
}
```

**Tier order:** `nano < standard < premium < frontier < reasoning`. The selector will *upgrade* (e.g. select `standard` when `nano` is unavailable in the user's plan) but never downgrade silently.

**Provider variety:** the selector prefers fallback chains that span providers (e.g. primary `claude-sonnet-4-6` (anthropic) → fallback `gpt-4o` (openai) → `gemini-2.5-pro` (google)) rather than chaining within one provider, so a single provider outage doesn't exhaust the chain. Implemented via `dedupBy(m => m.provider)` after sort.

### Model catalogue (initial)

| ID | Provider | Tier | Context | Tools | Cache | Vision |
|---|---|---|---|---|---|---|
| `claude-haiku-4-5`     | anthropic | nano       | 200k | ✓ | ✓ | ✓ |
| `claude-sonnet-4-6`    | anthropic | standard   | 200k | ✓ | ✓ | ✓ |
| `claude-opus-4-7`      | anthropic | frontier   | 200k | ✓ | ✓ | ✓ |
| `gpt-4o-mini`          | openai    | nano       | 128k | ✓ | ✓ | ✓ |
| `gpt-4o`               | openai    | premium    | 128k | ✓ | ✓ | ✓ |
| `o1`                   | openai    | reasoning  | 128k | ✗ | ✗ | ✗ |
| `gemini-flash-lite`    | google    | nano       | 1M   | ✓ | ✓ | ✓ |
| `gemini-2.5-flash`     | google    | standard   | 1M   | ✓ | ✓ | ✓ |
| `gemini-2.5-pro`       | google    | premium    | 1M   | ✓ | ✓ | ✓ |
| `grok-2`               | xai       | premium    | 131k | ✓ | ✗ | ✗ |
| `grok-2-mini`          | xai       | standard   | 131k | ✓ | ✗ | ✗ |
| `deepseek-chat`        | deepseek  | nano       | 64k  | ✓ | ✗ | ✗ |
| `deepseek-reasoner`    | deepseek  | reasoning  | 64k  | ✗ | ✗ | ✗ |

(Catalogue lives in `src/router/catalogue.ts`. Admin can override `active` per-row from Module 12's `/admin/models` later — for now, code-defined.)

---

## F. Tool Resolver

```ts
function resolveTools(
  classification: ClassificationResult,
  agent: AgentDescriptor,
  planSnapshot: Plan,
): ToolId[] {
  const tools: ToolId[] = [];
  const flag = (k: string) => planSnapshot.featureFlags[k] === true;

  if (classification.needsWebSearch     && agent.allowedTools.includes('web_search')     && flag('webSearch'))      tools.push('web_search');
  if (classification.needsCodeExecution && agent.allowedTools.includes('code_execution') && flag('codeExecution'))  tools.push('code_execution');
  if (classification.needsFileRead      && agent.allowedTools.includes('file_read')      && flag('fileAnalysis'))   tools.push('file_read');
  if (classification.needsFileGen.length && agent.allowedTools.includes('file_gen'))                                tools.push('file_gen');

  return tools;
}
```

Note: `file_gen` is always allowed for plans whose agent has it (no separate plan flag — the agent itself is plan-gated).

Per-agent tool budgets:
- Agent rows may define `tool_budgets` (JSONB) keyed by `ToolId` (e.g. `web_search`, `web_fetch`).
- During `streamCompletion`, each tool call is checked against this per-turn budget before execution.
- Over-budget calls are converted into tool results with `TOOL_BUDGET_EXCEEDED` and do not crash the stream.

---

## G. Provider Layer

### G.1 Adapter contract

```ts
// src/models/provider.ts
export interface Provider {
  id: ProviderId;
  streamCompletion(params: {
    modelId: string;
    messages: ProviderMessage[];
    tools: ToolSpec[];
    systemPrompt: string;
    temperature?: number;
    maxOutputTokens?: number;
    abortSignal: AbortSignal;
  }): AsyncIterable<ProviderEvent>;
}

export function getProvider(id: ProviderId): Provider;
```

### G.2 Anthropic adapter

- SDK: `@anthropic-ai/sdk`
- Endpoint: native Messages API with `stream: true`.
- Prompt cache: `cache_control: { type: 'ephemeral' }` on the system prompt + last 2 turns when `model.supportsPromptCache && messages.length >= 4`.
- Tool calls: native `tool_use` content blocks → emitted as `ProviderEvent { type: 'tool_call' }`.
- Vision: image blocks accepted from `attachedFiles` of type `png` / `jpg`.
- Usage event emitted from the final `message_delta` with `usage.input_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`, `usage.output_tokens`.

### G.3 OpenAI adapter

- SDK: `openai`
- Endpoint: `chat.completions.create({ stream: true })`.
- Prompt cache: implicit (OpenAI's automatic prompt caching, no header needed); usage exposed via `prompt_tokens_details.cached_tokens`.
- Tool calls: `tool_calls` deltas, accumulated by `callId`, emitted on completion of each call.
- Reasoning models (`o1`): `tools: []` always (does not support tools today), `temperature` ignored.
- Reused by xAI and DeepSeek (see G.5).

### G.4 Google adapter

- SDK: `@google/generative-ai`
- Endpoint: `generateContentStream`.
- Prompt cache: `cachedContent` parameter when supported.
- Tool calls: `functionCall` parts in candidates → `ProviderEvent { type: 'tool_call' }`.
- Usage from `usageMetadata.promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`.

### G.5 xAI and DeepSeek adapters

Both expose OpenAI-compatible `/v1/chat/completions`. Implemented as 20-line wrappers:

```ts
// src/models/providers/xai.ts
import { createOpenAIProvider } from './openai.js';
import { env } from '../../config/env.js';

export const xaiProvider = createOpenAIProvider({
  id: 'xai',
  baseURL: env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
  apiKey: env.XAI_API_KEY,
  capabilities: { promptCache: false, vision: false },
});
```

DeepSeek adapter is identical with `baseURL: 'https://api.deepseek.com/v1'`. Both inherit the OpenAI streaming + tool-call parsing logic.

### G.6 Failover (per-job)

```ts
async function* streamCompletion(decision, messages, abortSignal) {
  const chain = [decision /* primary */, ...decision.fallbackChain.map(toDecision)];
  for (const [i, attempt] of chain.entries()) {
    if (providerHealth.isOpen(attempt.modelProvider) && i < chain.length - 1) continue;
    try {
      yield* getProvider(attempt.modelProvider).streamCompletion({
        modelId: attempt.modelId,
        messages,
        tools: toolSpecsFor(decision.allowedTools),
        systemPrompt: decision.systemPrompt,
        temperature: decision.temperature,
        abortSignal,
      });
      providerHealth.recordSuccess(attempt.modelProvider);
      return;
    } catch (err) {
      const retryable = classifyError(err);                    // 5xx / network → retryable; 400/401/403/429 → not
      providerHealth.recordFailure(attempt.modelProvider, err);
      if (!retryable || i === chain.length - 1) {
        yield { type: 'error', code: errorCode(err), message: errorMessage(err), retryable: false };
        return;
      }
      // else fall through to next provider in chain
      yield { type: 'chunk', delta: '' /* keep stream alive; worker may emit `status` SSE event */ };
    }
  }
}
```

Failover happens *before* any token is yielded. Once we start emitting `chunk` events, we don't fail over (mid-stream switch would corrupt the response). Mid-stream errors emit `type:'error'` and the worker decides to retry the whole BullMQ job (Module 7 already handles this).

### G.7 Circuit breaker

```
router:health:{provider}  →  HASH { state, openedAt, failuresInWindow, lastErrorCode }

Failure recording:
  HINCRBY failuresInWindow 1
  HSET     lastErrorCode <code>
  EXPIRE   60                          (rolling 60s window)
  if failuresInWindow >= 3:            HSET state 'open', openedAt now()

State machine:
  closed     → open       on 3+ failures in 60s
  open       → half_open  after 30s elapsed
  half_open  → closed     on next success
  half_open  → open       on next failure (resets 30s timer)
```

`isOpen()` returns `true` only for `state='open'` AND `openedAt + 30s > now()` (auto-transition to `half_open` on read).

---

## H. Telemetry — Fields Module 10 produces

Module 6's `usage_records` row is written by the chat worker after the stream completes. Module 10 produces these fields (worker copies onto the row):

| Field | Source |
|---|---|
| `agentSlug`              | `decision.agentSlug` |
| `modelId`                | last attempted `attempt.modelId` (may differ from `decision.modelId` if failover happened) |
| `modelProvider`          | last attempted `attempt.modelProvider` |
| `routerLatencyMs`        | wall time of `runRouter()` (excludes streaming) |
| `inputTokensFresh`       | provider's `usage` event |
| `inputTokensCached`      | provider's `usage` event |
| `outputTokens`           | provider's `usage` event |
| `cacheWriteTokens`       | provider's `usage` event |
| `cacheHitLayer`          | `'prompt'` if `inputTokensCached > 0`, else `'none'` (semantic cache integrates here later) |
| `webSearchUsed`          | `allowedTools.includes('web_search') && actuallyInvoked` |
| `webSearchEngine`        | `'tavily' | 'brave'` from the tool execution |
| `webSearchCount`         | tool invocation count for `web_search` in the agent loop |
| `webFetchCount`          | tool invocation count for `web_fetch` in the agent loop |
| `codeExecutionUsed`      | same pattern |
| `codeExecutionCount`     | same pattern |
| `toolCountTotal`         | sum of executed tool invocations in the turn |
| `finishReason`           | provider's terminal `finish` event |

Plus a `metadata` JSONB blob carrying `classifierSource`, `confidence`, `intent`, `complexity`, `fallbacksTried` (count of providers that failed before success).

---

## I. Errors

New entries in `src/utils/errors.ts`:

| Factory | HTTP / surface | When |
|---|---|---|
| `Errors.modelNotAllowed({ modelId, planId })`        | 403 / `MODEL_NOT_ALLOWED`         | Manual `modelId` not in `plan.modelAccess`, or selector finds no model in plan |
| `Errors.agentNotAllowed({ agentSlug, planId })`      | 403 / `AGENT_NOT_ALLOWED`         | Manual `agentSlug` not in `plan.agentAccess` |
| `Errors.providerExhausted({ providers })`            | 503 / `PROVIDER_EXHAUSTED`        | All providers in fallback chain are open; no model to call |
| `Errors.classificationFailed({ cause })`             | (logged only — never thrown to user; classifier always falls back to `chat`/`medium`) |
| `Errors.contextOverflow({ tokens, contextWindow })`  | 413 / `CONTEXT_OVERFLOW`          | Even after summarisation the prompt exceeds the chosen model's window — Module 8's summariser couldn't reduce enough |

These all surface to the SSE client as `error` events from Module 7.

---

## J. Performance budgets

| Stage | p95 budget |
|---|---|
| Heuristic classifier             | 2 ms |
| LLM-fallback classifier          | 600 ms (nano model, ~120 input tokens) |
| Query rewriter                   | 800 ms |
| Model selector + health read     | 5 ms (one Redis HGETALL per provider, cached on the worker process for 1 s) |
| Agent dispatcher + tool resolver | <1 ms |
| **`runRouter()` total**          | **800 ms p95** (heuristic path: ~10 ms; LLM path dominates) |

If `runRouter` exceeds 2.5 s wall time, log `router_slow` with the `classifierSource` so we can chase regressions.
