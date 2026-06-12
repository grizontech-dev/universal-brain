# Codebase Checkpoint — 2026-05-09
## grizon-ai-backend-2 | Layer 3 Implementation State

> **Purpose:** Authoritative snapshot of what is actually implemented vs pending as of this date.  
> Use this as ground-truth context when implementing Layer 3 P1–P6 plans (LAYER3_TASK4–9).  
> **Do not rely on spec docs alone** — several file locations and patterns differ from the original spec.

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Folder Structure (Actual)](#2-folder-structure-actual)
3. [Layer 2 — Complete Modules](#3-layer-2--complete-modules)
4. [Layer 3 — Complete Tasks](#4-layer-3--complete-tasks)
5. [Layer 3 — Pending Tasks (P1–P6)](#5-layer-3--pending-tasks-p1p6)
6. [Spec vs Reality Divergences](#6-spec-vs-reality-divergences)
7. [Key Type Contracts](#7-key-type-contracts)
8. [Tool System — Current State](#8-tool-system--current-state)
9. [Agent System — Current State](#9-agent-system--current-state)
10. [Provider System — Current State](#10-provider-system--current-state)
11. [Router Pipeline — Current State](#11-router-pipeline--current-state)
12. [Chat Worker Pipeline (Annotated)](#12-chat-worker-pipeline-annotated)
13. [Database — Migration State](#13-database--migration-state)
14. [Environment Variables](#14-environment-variables)
15. [Pending Implementation Plans](#15-pending-implementation-plans)

---

## 1. Project Overview

**Stack:** Express + TypeScript + BullMQ + PostgreSQL + Redis + Qdrant  
**Entry point:** `src/server.ts`  
**Workers:** `src/workers/chat.worker.ts`, `file.worker.ts`, `notification.worker.ts`, `subscription.renewal.worker.ts`, `usage.rollup.worker.ts`, `wallet.janitor.worker.ts`  
**Queues:** `chat`, `file`, `notification` (BullMQ, Redis-backed)  
**Build:** ESM, compiled with tsc; `.js` imports required in source

---

## 2. Folder Structure (Actual)

```
src/
├── agents/               # Agent descriptors (pure config objects, no classes)
│   ├── index.ts          # AGENT_CATALOGUE registry + getAgent()
│   ├── chat.agent.ts
│   ├── research.agent.ts
│   ├── code.agent.ts
│   ├── writer.agent.ts
│   ├── analyst.agent.ts
│   ├── architect.agent.ts
│   ├── debugger.agent.ts
│   ├── ui.agent.ts
│   └── document.agent.ts
├── artifacts/
│   ├── artifact.service.ts     # versioning, preview on create
│   ├── artifact.storage.ts     # LocalArtifactStorage (real) + R2ArtifactStorage (STUB)
│   └── preview.ts              # markdown, CSV, code, HTML preview generation
├── cache/
│   └── semantic.cache.ts       # Qdrant cosine ≥ 0.92, TTL stratification, PII filter
├── config/
│   ├── env.ts                  # Zod-validated env
│   ├── plan.ts
│   ├── features.ts
│   ├── rateLimit.ts
│   ├── sanitiser.ts
│   ├── storage.ts
│   ├── queue.ts
│   └── streamLimits.ts
├── controllers/
│   ├── admin/                  # conversations, queues, ratelimits, wallets
│   └── user/                   # artifact, usage, wallet
├── db/
│   ├── pool.ts
│   └── migrations/             # 001–035 executed; 036 pending (P1)
├── events/                     # Typed event emitters per domain
├── files/
│   └── retriever.ts            # Qdrant semantic + ordered chunk retrieval
├── gateway/                    # Express middlewares
├── infra/
│   ├── redis.ts                # getRedisClient(), createRedisSubscriber()
│   ├── mailer.ts
│   └── qdrant.ts
├── memory/
│   ├── session.memory.ts       # Redis primary, DB fallback, 24h TTL
│   └── vector.memory.ts        # GPT-4o-mini fact extraction + Qdrant upsert
├── models/
│   ├── provider.ts             # Provider registry (switch on ProviderId)
│   └── providers/
│       ├── anthropic.ts        # Full: streaming, keepalive, cache breakpoints
│       ├── openai.ts           # Full: streaming, tool call buffering
│       ├── google.ts           # Full: Gemini Content[], function calling, streaming tool_use
│       ├── deepseek.ts         # OpenAI wrapper (production-ready)
│       └── xai.ts              # OpenAI wrapper (production-ready)
├── notifications/              # (directory exists; templates.ts MISSING)
├── prompt/
│   └── assembler.ts            # Anthropic cache breakpoints, compaction trigger
├── queues/
│   ├── chat.queue.ts
│   ├── file.queue.ts
│   └── notification.queue.ts
├── router/
│   ├── index.ts                # runRouter() orchestrator
│   ├── classifier.ts           # Heuristic + GPT-4o-mini fallback, Redis 60s cache
│   ├── modelSelector.ts        # DB-backed, fallback chain, uses providerHealth
│   ├── agentDispatcher.ts      # Intent→agent mapping + plan fallback ladder
│   ├── queryRewriter.ts        # GPT-4o-mini rewrite, 800ms timeout
│   ├── providerHealth.ts       # Redis-backed circuit breaker (REAL, not in health.ts)
│   ├── catalogue.ts            # In-memory model catalogue, refreshed from DB
│   └── tools.ts                # toolSpecsFor() — returns ToolSpec[] for an agent
├── runtime/
│   └── subagent.ts             # spawnSubagent(), real OpenAI call, DB insert
├── routes/
│   ├── admin/
│   └── user/
├── services/
│   ├── wallet.service.ts       # holds, confirms, refunds, idempotent settle_key
│   ├── usageTracker.service.ts # 39-field row, Redis daily rollups
│   ├── creditCalculator.service.ts
│   ├── summariser.service.ts   # Text-based rolling summarisation (NOT LLM)
│   ├── message.service.ts
│   ├── conversation.service.ts
│   └── ...
├── tools/
│   ├── index.ts                # executeTool() dispatcher (switch statement)
│   ├── webSearch.tool.ts       # Tavily primary → Brave fallback (NEEDS REVERSAL in P1)
│   ├── fileRead.tool.ts        # Thin wrapper over retriever.ts
│   ├── fileGen.tool.ts         # xlsx + docx real; PDF = stub; TXT = stub
│   └── codeExecution.tool.ts   # Real Judge0 HTTP; only 3 languages mapped
├── types/
│   ├── router.ts               # Core contracts (see Section 7)
│   ├── chatJob.d.ts
│   ├── plan.d.ts
│   └── ...
└── workers/
    ├── chat.worker.ts          # Full 43KB pipeline
    ├── file.worker.ts          # Unstructured.io, chunking, Qdrant upsert
    ├── notification.worker.ts  # STUB: sends JSON.stringify as email
    └── ...
```

---

## 3. Layer 2 — Complete Modules

All 12 Layer 2 modules are fully implemented and in production. No changes needed.

| Module | Description | Key Files |
|--------|-------------|-----------|
| M1 | Auth (JWT, OAuth, sessions) | `src/services/auth.service.ts`, `src/routes/user/auth.routes.ts` |
| M2 | Plans & Feature Flags | `src/config/plan.ts`, `src/config/features.ts`, `src/gateway/plan.middleware.ts` |
| M3 | Subscription & Billing | `src/services/subscription.service.ts`, `src/services/payment/phonepe.adapter.ts` |
| M4 | Credit Wallet | `src/services/wallet.service.ts` — holds/confirms/refunds with idempotent `settle_key` |
| M5 | Rate Limiting | `src/gateway/rateLimit.middleware.ts`, `src/services/rateLimit.service.ts` |
| M6 | Usage Tracking | `src/services/usageTracker.service.ts` — 39-field row, Redis rollups |
| M7 | BullMQ Queues | `src/queues/*.ts`, `src/workers/*.ts` |
| M8 | Conversations & Messages | `src/services/conversation.service.ts`, `src/services/message.service.ts` |
| M9 | Input Sanitiser | `src/config/sanitiser.ts`, `src/events/sanitiser.events.ts` |
| M10 | Smart Router | `src/router/` (all files) |
| M11 | User API | `src/routes/user/`, `src/controllers/user/` |
| M12 | Admin API | `src/routes/admin/`, `src/controllers/admin/` |

---

## 4. Layer 3 — Complete Tasks

| Task | Description | Key Outputs |
|------|-------------|-------------|
| Task 1 | Streaming providers, prompt assembly, telemetry | `src/models/providers/`, `src/prompt/assembler.ts`, `writeApiCallTelemetry()` in `chat.worker.ts` |
| Task 2 | Memory + semantic cache | `src/memory/session.memory.ts`, `src/memory/vector.memory.ts`, `src/cache/semantic.cache.ts` |
| Task 3 | File ingestion, artifacts, subagents | `src/workers/file.worker.ts`, `src/artifacts/`, `src/runtime/subagent.ts` |
| Task 5 | Google/Gemini provider (tools + multi-turn) | `src/models/providers/google.ts`, `ToolRunResult.toolId` + `toolName` on tool messages in `src/router/index.ts` |

---

## 5. Layer 3 — Pending Tasks (P1–P6)

| Priority | Plan Doc | Summary |
|----------|----------|---------|
| **P1** | `LAYER3_TASK4_PLAN_P1_TOOLS.md` | Tool registry, 6 new tools (web_fetch, html_generate, chart_generate, image_analyse, stock_data, get_weather), Brave-primary search, parallel execution |
| **P3** | `LAYER3_TASK6_PLAN_P3_INFRASTRUCTURE.md` | R2 storage, notification templates, Judge0 language expansion (9 langs), in-memory health monitor |
| **P4** | `LAYER3_TASK7_PLAN_P4_AGENT_GAPS.md` | deep_research agent, citation postProcess, tool enforcement, AgentDescriptor hooks |
| **P5** | `LAYER3_TASK8_PLAN_P5_OBSERVABILITY.md` | Cache ROI endpoint, Redis live metrics counters, provider health in system health endpoint |
| **P6** | `LAYER3_TASK9_PLAN_P6_PHASE4.md` | Analyst/Architect/UI agent upgrades, enterprise model picker, conversation summarise endpoint |

---

## 6. Spec vs Reality Divergences

These are cases where the spec documents describe a different file or pattern than what actually exists. **Always use the Reality column when implementing.**

| Spec says | Reality |
|-----------|---------|
| `src/execution/judge0.service.ts` | `src/tools/codeExecution.tool.ts` — Judge0 logic is here |
| `src/observability/costTracker.ts` | `writeApiCallTelemetry()` inside `src/workers/chat.worker.ts` |
| `src/observability/metrics.ts` | `src/services/usageTracker.service.ts` |
| `src/prompt/compactor.ts` | Compaction trigger is in `src/prompt/assembler.ts`; execution in `src/services/summariser.service.ts` |
| `src/prompt/cacheManager.ts` | Cache breakpoints are inline in `src/prompt/assembler.ts` |
| `src/prompt/systemPrompts/` | System prompts are embedded in each `src/agents/*.agent.ts` file |
| `src/models/health.ts` (singleton) | `src/router/providerHealth.ts` — Redis-backed circuit breaker already exists here |
| `src/cache/cacheKey.ts` | Cache keys are inline SHA256 in `src/cache/semantic.cache.ts` |
| `src/memory/profile.memory.ts` | Does not exist; user profiles stored in DB via `src/services/profile.service.ts` |
| `src/prompt/compactor.ts` (LLM summarisation) | `src/services/summariser.service.ts` uses **deterministic text truncation**, not LLM |
| `AgentDescriptor.agentMultiplierKey` | Field is `multiplierKey` in actual `src/types/router.ts` |
| `AgentDescriptor.defaultModelTier` | Field is `preferredTier` in actual `src/types/router.ts` |
| `AgentDescriptor.planRequired` | Not on `AgentDescriptor`; plan gating is in `agentDispatcher.ts` via `plan.agentAccess[]` |
| `AgentDescriptor.maxIterations` | Not on current `AgentDescriptor`; needs adding in P4 |
| `AgentDescriptor.preflight/postProcess` | Not on current `AgentDescriptor`; needs adding in P4 |
| webSearch: Brave primary, Tavily fallback | **Reality is reversed**: Tavily is tried first, Brave is fallback — P1 reverses this |
| `src/notifications/templates.ts` | **DOES NOT EXIST** — notification.worker.ts sends `JSON.stringify(vars)` |
| `src/models/health.ts` | **DOES NOT EXIST** — use `src/router/providerHealth.ts` as the base |

---

## 7. Key Type Contracts

### `AgentDescriptor` (current — `src/types/router.ts`)
```typescript
interface AgentDescriptor {
  slug: string;
  systemPrompt: string;
  allowedTools: ToolId[];        // only the 4 current ToolIds
  preferredTier: ModelDescriptor["tier"];
  fallbackAgent: string | null;
  multiplierKey: string;
  // P4 ADDITIONS NEEDED: maxIterations, preflight, postProcess
}
```

### `ToolId` (current — `src/types/router.ts`)
```typescript
type ToolId = "web_search" | "code_execution" | "file_read" | "file_gen";
// P1 will expand to: + "web_fetch" | "html_generate" | "chart_generate" | "image_analyse" | "stock_data" | "get_weather"
```

### `ProviderEvent` (current — `src/types/router.ts`)
```typescript
type ProviderEvent =
  | { type: "chunk"; delta: string }
  | { type: "tool_call"; toolId: ToolId; arguments: unknown; callId: string }
  | { type: "tool_result"; callId: string; output: unknown; durationMs: number }
  | { type: "usage"; inputTokensFresh: number; inputTokensCached: number; outputTokens: number; cacheWriteTokens: number }
  | { type: "finish"; reason: "stop" | "length" | "content_filter" | "tool_use" | "error"; modelUsed: string; provider: ProviderId }
  | { type: "error"; code: string; message: string; retryable: boolean };
```

### `StreamContext` (current — `src/types/router.ts`)
```typescript
interface StreamContext {
  userId: string;
  conversationId: string;
  jobId?: string;
  messageId?: string;
  attachedFileIds: string[];
  maxArtifactVersions: number;
}
```

### `RoutingDecision` (current — `src/types/router.ts`)
```typescript
interface RoutingDecision {
  classification: ClassificationResult;
  agentSlug: string;
  modelId: string;
  modelProvider: ProviderId;
  fallbackChain: Array<{ modelId: string; provider: ProviderId }>;
  rewrittenQuery: string | null;
  systemPrompt: string;
  allowedTools: ToolId[];
  source: "agent" | "auto";
  routerLatencyMs: number;
  temperature?: number;
}
```

### `ProviderMessage` (current — `src/types/router.ts`)
```typescript
interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: ToolId | string;
  assistantToolCalls?: Array<{ id: string; name: string; arguments: string }>;
}
```

---

## 8. Tool System — Current State

### Existing Tools (4 real)

| Tool | File | Status | Notes |
|------|------|--------|-------|
| `web_search` | `src/tools/webSearch.tool.ts` | **Real** | Tavily primary → Brave fallback (**P1 reverses this**); spawns summarise_pages subagents |
| `code_execution` | `src/tools/codeExecution.tool.ts` | **Real** | Judge0 HTTP, 3 languages only (python/js/ts), 10s timeout |
| `file_read` | `src/tools/fileRead.tool.ts` | **Real** | Delegates to `src/files/retriever.ts` (Qdrant semantic search) |
| `file_gen` | `src/tools/fileGen.tool.ts` | **Partial** | xlsx ✅, docx ✅, markdown ✅, PDF ❌ (stub), TXT ❌ |

### Dispatcher (`src/tools/index.ts`)
- Single `executeTool(toolId, args, ctx)` function, switch statement
- Returns `{ error: "unknown_tool:X" }` for unknown tool IDs
- **No registry pattern** — P1 adds `src/tools/registry.ts`
- **No parallel execution** — P1 adds `executeToolsParallel()` bounded by `MAX_PARALLEL_TOOLS`
- **No tool enforcement** — P4 adds allowed-tools check before dispatch

### Missing Tools (P1 creates all of these)

| Tool | Package | Purpose |
|------|---------|---------|
| `web_fetch` | `@mozilla/readability` + `jsdom` | Fetch and parse URL into clean text |
| `html_generate` | native | Generate sandboxed HTML artifact for UI agent |
| `chart_generate` | `chart.js` + `canvas` | Bar/line/pie/scatter charts → base64 PNG artifact |
| `image_analyse` | Anthropic vision API | Describe attached image files |
| `stock_data` | `yahoo-finance2` | Quote, historical price, company profile (no API key) |
| `get_weather` | OpenWeatherMap REST | Current weather + 5-day forecast |

---

## 9. Agent System — Current State

### Registered Agents (9)

| Slug | File | Tier | Allowed Tools | Fallback |
|------|------|------|---------------|---------|
| `chat` | `chat.agent.ts` | standard | [] | null |
| `research` | `research.agent.ts` | standard | [web_search] | chat |
| `code` | `code.agent.ts` | premium | [code_execution, file_read, file_gen] | chat |
| `writer` | `writer.agent.ts` | standard | [file_gen] | chat |
| `analyst` | `analyst.agent.ts` | premium | [code_execution, file_read, file_gen] | chat |
| `architect` | `architect.agent.ts` | premium | [file_read] | chat |
| `debugger` | `debugger.agent.ts` | premium | [code_execution, file_read] | chat |
| `ui` | `ui.agent.ts` | standard | [file_gen] | chat |
| `document` | `document.agent.ts` | standard | [file_read, file_gen] | chat |

### Missing Agent
- `deep_research` — **DOES NOT EXIST** — `agentDispatcher.ts` does not route to it yet; P4 creates it.

### Dispatcher Logic (`src/router/agentDispatcher.ts`)
- `AGENT_FOR_INTENT` map: `search → research`, `code → code`, `write → writer`, `analyse → analyst`, `design → architect`, `debug → debugger`, `ui → ui`, `document → document`, `chat → chat`
- No complexity-based routing yet (e.g., `search + complex → deep_research` — P4 adds this)
- Plan fallback ladder: walks `fallbackAgent` chain up to 12 hops

### Agent Descriptor Gaps (P4 fills these)
- No `maxIterations` field — all agents run until stop token or provider limit
- No `preflight` hook — no pre-call validation at agent level
- No `postProcess` hook — no post-response transformation at agent level

---

## 10. Provider System — Current State

### Provider Capability Matrix

| Provider | File | Text | Tools | Multi-turn | Cache | Status |
|----------|------|------|-------|------------|-------|--------|
| Anthropic | `providers/anthropic.ts` | ✅ | ✅ | ✅ | ✅ explicit `cache_control` breakpoints | **Full** |
| OpenAI | `providers/openai.ts` | ✅ | ✅ | ✅ | ✅ automatic (no markers needed) | **Full** |
| DeepSeek | `providers/deepseek.ts` | ✅ | ✅ | ✅ | ✅ (OpenAI-compatible) | **Full** (wrapper) |
| xAI | `providers/xai.ts` | ✅ | ✅ | ✅ | ✅ (OpenAI-compatible) | **Full** (wrapper) |
| Google | `providers/google.ts` | ✅ | ✅ | ✅ | ⚠️ implicit only (`cachedContentTokenCount` in usage) | **Full** — P2 complete |

### Google Provider (post–Task 5 / P2)
- Native `Content[]` history, `systemInstruction` string, `functionDeclarations` from tool specs, `toolConfig.functionCallingConfig.mode` AUTO when tools are present.
- Streaming emits text chunks from parts; after stream completes, `response.functionCalls()` drives `tool_call` events + `finish` with `reason: tool_use` when applicable.
- Tool replay uses `toolName` on `ProviderMessage` tool turns (set from `ToolRunResult.toolId` in `src/router/index.ts`) so Gemini `functionResponse.name` matches declarations.
- Optional `GOOGLE_AI_BASE_URL` passed via `getGenerativeModel(..., requestOptions)` when set.

### Provider Health (`src/router/providerHealth.ts`)
- **Redis-backed** (NOT in-memory) — keys: `router:health:{provider}` (hash)
- States: `closed` (healthy) | `open` (circuit open) | `half_open` (recovery probe)
- Open threshold: 3 failures in 60s window
- Half-open after: 30s from `openedAt`
- Used by `modelSelector.ts` via `providerHealth.isOpen(p)`
- `recordSuccess()` / `recordFailure()` called in `chat.worker.ts` already
- **Note:** P3 plan describes a new in-memory `ProviderHealthMonitor` (src/models/health.ts) — the actual implementation already exists in `src/router/providerHealth.ts`. P3 should integrate with the existing file rather than creating a duplicate.

---

## 11. Router Pipeline — Current State

### Flow: `runRouter()` in `src/router/index.ts`

```
1. classifier.ts
   - Heuristic patterns first (fast, no LLM cost)
   - GPT-4o-mini fallback if confidence < 0.7
   - Redis 60s cache on SHA256(query)
   - Returns: ClassificationResult { intent, complexity, needsWebSearch, ... }

2. agentDispatcher.ts
   - AGENT_FOR_INTENT[intent] → candidate agent
   - Check plan.agentAccess; walk fallbackAgent chain if not allowed
   - Returns: AgentDescriptor

3. queryRewriter.ts
   - GPT-4o-mini rewrites query for clarity using conversation history
   - 800ms timeout; falls back to original query on timeout
   - Returns: rewrittenQuery | null

4. modelSelector.ts
   - Check agent-specific DB override first (agent_catalogue table)
   - Filter activeModelCatalogue() by plan.modelAccess
   - Sort by tier, then providerHealth rank
   - Returns: { primary: ModelDescriptor; fallbackChain: ModelDescriptor[] }

5. router/index.ts assembles RoutingDecision
   - Includes: agentSlug, modelId, modelProvider, fallbackChain, rewrittenQuery,
               systemPrompt, allowedTools, temperature
```

---

## 12. Chat Worker Pipeline (Annotated)

**File:** `src/workers/chat.worker.ts` (≈43KB, single function `processJob`)

```
1. SEMANTIC CACHE LOOKUP
   lookupSemanticCache(query, userId)
   → Hit: return cached response (5% credit charge), skip LLM
   → Miss: continue

2. ROUTER
   runRouter(classification, plan, options)
   → Returns RoutingDecision (agent, model, system prompt, allowed tools)

3. SESSION HYDRATION
   hydrateSession(conversationId)
   → Returns last N messages from Redis (fallback: DB)

4. FACT RECALL
   recallFacts(userId, query)
   → Qdrant semantic search on mem:{userId} collection
   → Injects relevant facts as system context

5. PROMPT ASSEMBLY
   assemblePrompt(messages, systemPrompt, model)
   → Applies Anthropic cache_control breakpoints
   → Checks context usage; if > 60% capacity, calls summariserService.run()
   → Returns: { messages: ProviderMessage[]; systemPrompt: string }

6. LLM STREAM LOOP
   streamCompletion(provider, params)
   → Yields ProviderEvents: chunk | tool_call | usage | finish | error
   
   For each tool_call event:
   a. executeTool(toolId, args, ctx)  ← NO allowedTools check yet (P4 fixes)
   b. Tool result injected back to provider as 'tool' role message
   c. Continue streaming (multi-turn tool use)

7. USAGE + COST
   computeCostUsd(modelId, { inputFresh, output })
   creditCalculator.calculate(usage, agentMultiplierKey, plan)
   walletService.settle(userId, creditsCharged, settleKey)

8. PERSIST
   messageService.update(messageId, { content, citations })
   persistSession(conversationId, messages)

9. FACT EXTRACTION
   extractAndStoreFacts(userId, content)
   → GPT-4o-mini extracts facts → Qdrant upsert into mem:{userId}

10. SEMANTIC CACHE WRITE
    writeSemanticCache(query, content, metadata)
    → Qdrant upsert into semantic_cache collection

11. TELEMETRY
    writeApiCallTelemetry({ requestId, provider, model, tokens, credits, latency, ... })
    usageTracker.record(userId, planId, tokens, credits, agentSlug, ...)
```

**SSE Events emitted** (via `sseHub.service.ts`):
- `{ event: 'chunk', data: { delta } }` — streaming text
- `{ event: 'tool_call', data: { toolId, callId } }` — tool being called
- `{ event: 'artifact', data: { artifactId, type, previewHtml? } }` — artifact created
- `{ event: 'finish', data: { messageId, creditsUsed } }` — done
- `{ event: 'error', data: { code, message } }` — failure

---

## 13. Database — Migration State

**Executed migrations:** 001–035  
**Next migration number:** 036 (P1 adds feature flags for new tools)

| Range | Domain |
|-------|--------|
| 001–008 | Auth, tokens, OAuth, superadmin seed |
| 009–013 | Plans, subscriptions, feature limits |
| 014–016 | Wallets, transactions, rate limit events |
| 017–020 | Usage records (4 tables: records, daily_user, daily_plan, hourly_system) |
| 021–022 | Chat jobs + idempotency |
| 023–024 | Conversations + messages |
| 025 | Files |
| 026 | Artifacts |
| 027 | Router telemetry fields on usage_records |
| 028 | Module 7/6 bridge table |
| 029 | Agent catalogue (DB-overridable agent→model mapping) |
| 030 | api_calls (full telemetry: provider, model, tokens, cost, cache layer) |
| 031 | memory_facts |
| 032 | semantic_cache_hits |
| 033 | file_chunks |
| 034 | subagent_runs |
| 035 | artifacts_preview (previewHtml column) |

**Key tables for P1–P6 implementation:**
- `api_calls` — `input_cached`, `cost_usd_billed_to_us`, `provider`, `input_fresh`, `output` (for P5 cache ROI)
- `semantic_cache_hits` — `saved_credits`, `created_at` (for P5 cache ROI)
- `agent_catalogue` — DB-overridable model assignments per agent (used by `modelSelector.ts`)
- `ai_models` — `model_id`, `provider`, `tier`, `is_active`, `input_cost_per_1k`, `output_cost_per_1k`

---

## 14. Environment Variables

### Currently Active (from `src/config/env.ts`)
```env
# Core
NODE_ENV=
PORT=
DATABASE_URL=
REDIS_URL=

# Auth
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

# AI Providers
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
DEEPSEEK_API_KEY=
XAI_API_KEY=

# Search (currently: Tavily primary, Brave fallback — P1 reverses)
TAVILY_API_KEY=
BRAVE_API_KEY=

# Code execution
JUDGE0_URL=
JUDGE0_API_KEY=        # optional

# Memory / vector
QDRANT_URL=
QDRANT_API_KEY=        # optional

# Storage
STORAGE_DRIVER=local   # 'local' | 'r2'
LOCAL_UPLOADS_DIR=

# Notifications
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Payment
PHONEPE_MERCHANT_ID=
PHONEPE_SALT_KEY=
PHONEPE_SALT_INDEX=
```

### Variables to Add (P1–P3)
```env
# P1 — New tools
OPENWEATHERMAP_API_KEY=     # get_weather tool
# yahoo-finance2 needs no API key

# P3 — R2 storage
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# P1 — Parallel tool execution
MAX_PARALLEL_TOOLS=3        # optional, defaults to 3
```

---

## 15. Pending Implementation Plans

All 6 plans are in `docs/Layer 3 Modules/`. Implementation order: P1 → P2 → P3 → P4 (depends on P1) → P5 (depends on P1, P3) → P6 (depends on P1, P4).

### Cross-cutting changes (touch multiple priorities)

**`src/workers/chat.worker.ts`** is modified by P1, P3, P4, and P5:
- P1: parallel tool execution, new tool IDs
- P3: `providerHealth.recordSuccess/Failure` calls (may already exist — verify)
- P4: tool enforcement (allowedTools check), preflight/postProcess hooks, citation accumulation
- P5: Redis metrics counter writes (after completion block)

**`src/types/router.ts`** is modified by P1 and P4:
- P1: expand `ToolId` union
- P4: add `maxIterations`, `preflight`, `postProcess` to `AgentDescriptor`

**`src/router/modelSelector.ts`** is modified by P3 and P6:
- P3: verify `providerHealth` import is already correct (it is — from `./providerHealth`)
- P6: add `requestedModelId` enterprise override path

### NPM packages to install

| Priority | Packages |
|----------|---------|
| P1 | `@mozilla/readability`, `jsdom`, `@types/jsdom`, `yahoo-finance2`, `chart.js`, `canvas`, `pdfkit`, `@types/pdfkit` |
| P2 | (none — `@google/generative-ai` already installed) |
| P3 | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| P4–P6 | (none new) |

---

*Last updated: 2026-05-09 | Generated from full codebase audit*
