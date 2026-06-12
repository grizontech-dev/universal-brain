# Layer 3 — Agent Execution, Tools, Memory & Artifacts
## Complete Module Reference & Design Specification

> **Status:** Active Design (post Layer 2 stabilisation)
> **Stack:** Express / TypeScript · PostgreSQL · Redis · Qdrant · BullMQ · Judge0 · Tavily
> **Last Updated:** 2026-05-06

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Where Layer 2 Ends and Layer 3 Begins](#2-where-layer-2-ends-and-layer-3-begins)
3. [Request Lifecycle Inside Layer 3](#3-request-lifecycle-inside-layer-3)
4. [Module 13 — Agent Runtime](#4-module-13--agent-runtime)
5. [Module 14 — Tool System](#5-module-14--tool-system)
6. [Module 15 — Provider & Streaming Layer](#6-module-15--provider--streaming-layer)
7. [Module 16 — Prompt Assembly & Caching](#7-module-16--prompt-assembly--caching)
8. [Module 17 — Semantic Response Cache](#8-module-17--semantic-response-cache)
9. [Module 18 — Memory Architecture](#9-module-18--memory-architecture)
10. [Module 19 — Artifact Service & Storage](#10-module-19--artifact-service--storage)
11. [Module 20 — File Ingestion Pipeline](#11-module-20--file-ingestion-pipeline)
12. [Module 21 — Code Execution (Judge0)](#12-module-21--code-execution-judge0)
13. [Module 22 — Subagents & Isolation](#13-module-22--subagents--isolation)
14. [Module 23 — Cost Telemetry & Observability](#14-module-23--cost-telemetry--observability)
15. [Database Schema (Layer 3 additions)](#15-database-schema-layer-3-additions)
16. [Folder Structure](#16-folder-structure)
17. [Phased Delivery](#17-phased-delivery)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                  LAYER 2 — API GATEWAY (existing)                 │
│   auth · plan · flag · rate-limit · credit · sanitiser · queue    │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ enqueued ChatJobPayload
                ┌─────────────────▼─────────────────┐
                │     LAYER 3 — AGENT EXECUTION      │
                │                                    │
   ┌────────────┴────────────┐    ┌─────────────────┴────────────┐
   │  M13 Agent Runtime      │    │  M16 Prompt Assembler         │
   │  - base loop            │    │  - cache breakpoints          │
   │  - per-agent classes    │    │  - rolling summarisation      │
   └────────────┬────────────┘    └─────────────────┬────────────┘
                │                                   │
   ┌────────────▼────────────┐    ┌─────────────────▼────────────┐
   │  M14 Tool Catalogue     │    │  M15 Provider Layer          │
   │  web_search · web_fetch │    │  Anthropic · OpenAI · Google │
   │  file_read · code_exec  │    │  DeepSeek · xAI · streaming  │
   │  html_gen · chart_gen   │    │  fallback · keepalive        │
   └────────────┬────────────┘    └─────────────────┬────────────┘
                │                                   │
   ┌────────────▼────────────────────────────────────▼────────────┐
   │     M17 Semantic Cache    M18 Memory   M22 Subagents          │
   │     Qdrant + Redis        Redis+Qdrant  isolated contexts     │
   └────────────┬──────────────────┬─────────────────┬─────────────┘
                │                  │                 │
   ┌────────────▼────────┐  ┌──────▼────────┐  ┌────▼─────────────┐
   │  M19 Artifacts      │  │  M20 Files    │  │  M21 Judge0      │
   │  Postgres + R2/disk │  │  Unstructured │  │  sandboxed exec  │
   └─────────────────────┘  └───────────────┘  └──────────────────┘

           ↓ events                ↓ events                ↓ events
   ┌──────────────────────────────────────────────────────────────┐
   │       M23 Cost Telemetry & Observability (cross-cutting)      │
   │       writes back into Module 6 usage_records                 │
   └──────────────────────────────────────────────────────────────┘
```

---

## 2. Where Layer 2 Ends and Layer 3 Begins

| Concern | Layer 2 (Gateway) | Layer 3 (this document) |
|---|---|---|
| Auth, plan, flags, limits, credits | ✓ | — |
| Conversation/file/artifact CRUD | ✓ (contracts) | — |
| Routing decision (which agent + model) | ✓ (skeleton) | refined with health + cost-aware fallback |
| Provider API call | direct adapter | full streaming, caching, tool-loop |
| Tool execution | — | this layer |
| Memory (Redis session + Qdrant) | — | this layer |
| Semantic response cache | — | this layer |
| Artifact materialisation | DB row only | content, versions, storage, preview |
| File parsing | upload accepted | parsing + embedding |
| Code execution | feature gate | Judge0 integration |
| Cost tracking | usage row written | enriched with cache layer + tool counts |

Layer 3 is **only invoked from `chat.worker.ts`** (and any future worker types). HTTP routes never reach Layer 3 directly.

---

## 3. Request Lifecycle Inside Layer 3

```
ChatJobPayload received by chat.worker
  │
  ▼
1. Semantic cache lookup (M17)
   ├─ HIT  → return cached response → write usage row → done
   └─ MISS ↓
2. Memory recall (M18)
   ├─ session memory from Redis
   └─ long-term memory from Qdrant (top-k by cosine on user query)
  │
  ▼
3. Prompt assembly (M16)
   ├─ static system prompt (cached prefix)
   ├─ tool definitions for chosen agent (cached prefix)
   ├─ rolling conversation summary
   ├─ recent N messages (stable cache breakpoint)
   └─ fresh user query + retrieved context (NOT cached)
  │
  ▼
4. Agent loop (M13)
   for iteration in [1..maxIterations]:
     stream LLM call (M15)
       ├─ chunk → SSE
       ├─ tool_call → pause, run tool (M14), inject result, continue
       ├─ usage → buffered
       └─ finish → exit loop
     if max iterations exceeded → return partial + explanation
  │
  ▼
5. Post-processing
   ├─ artifact extraction & versioning (M19)
   ├─ memory write (M18: session + Qdrant)
   ├─ semantic cache write (M17 — only for non-PII, non-personal queries)
   └─ usage row enriched and recorded (Module 6)
  │
  ▼
6. Done
```

---

## 4. Module 13 — Agent Runtime

**Files:** `src/agents/base.agent.ts`, `src/agents/{chat,writer,research,code,document,analyst,architect,debugger,ui}.agent.ts`, `src/runtime/agentLoop.ts`

### Agent contract

```typescript
interface Agent {
  slug: string;
  displayName: string;
  description: string;
  defaultModelTier: 'nano' | 'standard' | 'premium' | 'frontier' | 'reasoning';
  allowedTools: ToolName[];
  systemPromptId: string;          // resolved from prompt registry, cached
  agentMultiplier: number;         // credit multiplier (Module 4)
  planRequired: PlanSlug;

  // Pre-flight: can the agent actually run this query? (some agents reject empty/short queries)
  preflight(query: string, ctx: SessionContext): { ok: true } | { ok: false; reason: string };

  // After loop completes — agent gets last word over output (e.g. citation insertion)
  postProcess(result: AgentResult, ctx: SessionContext): Promise<AgentResult>;
}
```

The shared **agent loop** (in `runtime/agentLoop.ts`) drives every agent — agents themselves are configuration + hooks, not code paths.

### Loop bounds

| Bound | Default | Per-agent override |
|---|---|---|
| Max iterations (tool-call rounds) | 6 | Research 10, Debugger 8, UI 4 |
| Max parallel tools per round | 3 | — |
| Total wall-clock | from plan stream timeout | — |
| Max output tokens | 4096 | Architect 8192, Writer 4096 |

When max iterations is exceeded, the loop emits a synthesised final assistant message: *"I've gathered enough information to answer; here's what I found so far."* and a `metadata.maxIterationsHit = true` flag on the usage row.

### Agent catalogue

| Slug | Tools allowed | Default tier | Plan |
|---|---|---|---|
| `chat` | — | standard | free |
| `writer` | `file_generate` | standard | free |
| `research` | `web_search`, `web_fetch`, `file_generate` | standard | starter |
| `code` | `code_execute`, `file_generate` | standard | starter |
| `document` | `file_read`, `file_generate` | standard | starter |
| `analyst` | `file_read`, `code_execute`, `chart_generate` | premium | pro |
| `architect` | `web_search`, `file_generate` | frontier | pro |
| `debugger` | `code_execute` | premium | pro |
| `ui` | `html_generate` | premium | pro |
| `deep_research` | `web_search`, `web_fetch`, `file_read` | premium | pro |

Plan-gated availability is enforced in Module 3 of Layer 2. By the time the worker reaches the agent runtime, eligibility is already proven.

---

## 5. Module 14 — Tool System

**Files:** `src/tools/base.tool.ts`, `src/tools/{webSearch,webFetch,fileRead,fileGenerate,htmlGenerate,codeExecute,chartGenerate,imageAnalyse}.tool.ts`, `src/tools/registry.ts`

### Tool contract

```typescript
interface Tool<P = unknown, R = unknown> {
  name: ToolName;
  description: string;             // shown to the LLM
  jsonSchema: JSONSchema;          // includes mandatory `reason` field
  planRequired: PlanSlug;
  featureFlag?: keyof FeatureFlags;
  estimatedLatencyMs: number;      // for parallel-execution scheduling
  execute(params: P, ctx: ToolContext): Promise<ToolResult<R>>;
}

interface ToolContext {
  userId: string;
  conversationId: string;
  messageId: string;               // assistant placeholder id
  abortSignal: AbortSignal;
  attachedFileIds: string[];
  planSnapshot: Plan;
}

interface ToolResult<R> {
  ok: boolean;
  data: R | null;
  error: string | null;
  costCredits: number;             // out-of-band credit cost (e.g. Tavily call)
  artifactIds?: string[];          // tools that materialise artifacts
  durationMs: number;
}
```

The mandatory `reason` parameter on every tool forces the LLM to state intent before execution — reduces wasteful calls.

### Catalogue

| Tool | Backend | Cost model | Notes |
|---|---|---|---|
| `web_search` | Tavily (primary) → Brave (fallback) | per-search credit (admin-tunable) | Counter increments in Module 3 already |
| `web_fetch` | internal scraper, Readability + jsdom | flat | URL must pass allowlist + SSRF guard |
| `file_read` | Unstructured.io self-hosted | per-MB credit | Only on already-ingested fileId |
| `file_generate` | Native (xlsx/docx/markdown/csv libs) | flat | Returns artifact |
| `html_generate` | Native (template + sanitiser) | flat | Returns sandboxed-iframe artifact |
| `chart_generate` | Code execution → matplotlib | per-execution | Result file becomes image artifact |
| `code_execute` | Judge0 | per-execution + plan caps | Module 3 hourly/daily limits |
| `image_analyse` | Vision-capable provider call | input-image surcharge | Only on uploaded images |

### Parallel execution

When the LLM emits multiple `tool_call` events in one round and they are mutually independent (declared via `tool.parallelSafe = true`), the runtime executes them with `Promise.all` bounded by `maxParallelTools`. Results are reinjected as a single batched message back to the LLM.

### Tool errors → LLM

Tool errors are returned as structured tool-result messages, not thrown. The LLM gets a chance to retry, ask the user, or proceed without:

```json
{ "ok": false, "error": "TIMEOUT", "hint": "Search service slow; consider answering from existing context." }
```

---

## 6. Module 15 — Provider & Streaming Layer

**Files:** `src/models/provider.ts`, `src/models/providers/{anthropic,openai,google,deepseek,xai}.ts`, `src/models/streaming.ts`, `src/models/health.ts`

### Goals

1. Single async iterator interface across all providers.
2. Health-aware fallback (skip overloaded providers).
3. Prompt caching where supported (Anthropic explicit, OpenAI auto, Google auto).
4. Keepalive pings to extend Anthropic 5-minute cache TTL.
5. Per-call cost capture (whatever the provider emits).

### Unified stream interface

```typescript
async function* streamCompletion(
  decision: RouterDecision,
  messages: ProviderMessage[],
  abortSignal: AbortSignal,
  ctx: StreamContext,
): AsyncIterable<StreamEvent>;

type StreamEvent =
  | { type: 'chunk';       delta: string }
  | { type: 'tool_call';   toolId: ToolName; arguments: unknown; callId: string }
  | { type: 'tool_result'; callId: string;   output: unknown;    durationMs: number }
  | { type: 'usage';       inputTokensFresh: number; inputTokensCached: number; outputTokens: number; cacheWriteTokens: number }
  | { type: 'finish';      reason: FinishReason; modelUsed: string; provider: ProviderId }
  | { type: 'error';       code: string; message: string; retryable: boolean };
```

### Health & fallback

```
Provider health = exponential-decay window of (success / total) over last 60s.
  if successRate < 0.5 over >= 20 calls → mark degraded
  if degraded for 30s → mark down (route around for 60s)

Routing:
  primary    = decision.modelProvider
  candidates = [primary, ...decision.fallbacks]
  for p in candidates:
    if health(p) != down: try p; on retryable error → next
  if all down: emit type='error' code='ALL_PROVIDERS_DOWN'
```

### Prompt caching strategy

| Provider | Mechanism | Code action |
|---|---|---|
| Anthropic | `cache_control: { type: 'ephemeral' }` on system + tools blocks | Explicit breakpoints (M16) |
| OpenAI | Automatic for prompts > 1024 tokens | Order content stably; nothing to set |
| Google | Implicit cached-content API | Pre-create CachedContent for hot agents |

### Keepalive

For active sessions on Anthropic models, `streaming.keepalive.ts` schedules a Haiku-tier 1-token ping every 4 minutes for the static prefix. Stops on session idle > 10 minutes.

---

## 7. Module 16 — Prompt Assembly & Caching

**Files:** `src/prompt/assembler.ts`, `src/prompt/cacheManager.ts`, `src/prompt/compactor.ts`, `src/prompt/systemPrompts/*.ts`

### Layout (Anthropic — strictest)

```
system: [
  { type: 'text', text: AGENT_IDENTITY_AND_RULES },                    ← cached
  { type: 'text', text: TOOL_DEFINITIONS,
    cache_control: { type: 'ephemeral' } }                              ← BREAKPOINT 1
]

messages: [
  { role: 'user',      content: ROLLING_SUMMARY (if any) },
  ...recent messages,
  { role: 'user',      content: STABLE_HISTORY,
    cache_control: { type: 'ephemeral' } }                              ← BREAKPOINT 2
  { role: 'user',      content:
      `Today: ${date}\nPlan: ${planSlug}\n${userQuery}\n\nRETRIEVED:\n${retrievedContext}` }
]
```

### Golden rules

1. Never put `Date.now()`, user names, or session IDs above a cache breakpoint.
2. The static prefix must be byte-identical across requests for a given agent slug.
3. Tool definitions are stable per (agent, plan) — cache key includes both.
4. `STABLE_HISTORY` excludes the most recent message (which changes by definition).

### Rolling summarisation

```
on every assembly:
  tokenCount = estimate(prefix + history + query)

  if tokenCount > 0.6 * modelLimit:
    summary = cheapModel('Summarise these messages in 200 words: …')
    replace messages[0..k] with single summary message
    persist: conversations.summary_text + summarised_up_to_message_id

  if tokenCount > 0.85 * modelLimit:
    full = cheapModel('Summarise entire conversation in 400 words: …')
    context = prefix + full + last_3_messages + currentQuery
```

Summaries themselves are cached with breakpoint 1 of the next call so the first call after compaction pays once.

---

## 8. Module 17 — Semantic Response Cache

**Files:** `src/cache/semantic.cache.ts`, `src/cache/cacheKey.ts`

### When to consult

- Agent slug ∈ `{chat, writer, research}` (factual / generic)
- No file attachments
- No PII tokens detected (regex sweep + simple classifier)
- User has not opted out (`users.semantic_cache_optout`)

### Lookup

```
queryEmbedding = embed(userQuery)                                  // text-embedding-3-small
candidates = qdrant.search(
  collection='semantic_cache',
  vector=queryEmbedding,
  limit=5,
  filter={ agent_slug, model_tier_at_least, fresher_than: now - ttl }
)

for c in candidates:
  if cosine(c.vector, queryEmbedding) > 0.92 and
     c.factualScore > 0.7:
    return c.answer
```

### Write

After successful job:
```
if eligible(agent, query, response):
  qdrant.upsert(
    id = sha256(agent + normalize(query)),
    vector = queryEmbedding,
    payload = { answer, model, agent, citations, createdAt, factualScore, ttl }
  )
```

### TTLs

| Content type | TTL |
|---|---|
| Generic factual | 7 days |
| Search-grounded | 4 hours |
| Code answers | 24 hours |
| Anything with `Today:` semantics | not cached |

### Hit metrics

`usage_records.cache_hit_layer = 'semantic'` and `creditsDeducted = 0.05 × normal` (admin-tunable cache discount). Saves the LLM call entirely.

---

## 9. Module 18 — Memory Architecture

**Files:** `src/memory/session.memory.ts`, `src/memory/vector.memory.ts`, `src/memory/profile.memory.ts`

### Three tiers

| Tier | Store | Lifespan | Purpose |
|---|---|---|---|
| In-context | RAM (per request) | one call | Last N messages |
| Session | Redis | 24h idle TTL | Fast hydration of conversation |
| Long-term | Qdrant `mem:{userId}` | permanent (per user) | Cross-conversation recall |

### Long-term writes

After each completed assistant message, an embedding is generated for **a memory candidate** — extracted by a cheap call:

```
"From this exchange, list at most 3 durable facts about the user
 (preferences, projects, identity, recurring topics). One fact per line.
 If none, output 'none'."
```

Facts → embedded → upserted into the user's Qdrant collection with payload `{ fact, sourceMessageId, createdAt, confidence }`.

### Recall

On every new query, top-5 facts by cosine similarity are injected into the **fresh suffix** (never the cached prefix) under a `KNOWN ABOUT USER:` heading.

### Privacy & isolation

- Qdrant collections are namespaced `mem:{userId}` — one collection per user.
- Hard delete on account deletion (cascades from `users.id`).
- User can view + edit + purge memories via `GET/DELETE /api/v1/memory`.

---

## 10. Module 19 — Artifact Service & Storage

**Files:** `src/artifacts/artifact.service.ts`, `src/artifacts/artifact.storage.ts`, `src/artifacts/preview.ts`

### Already in place (Layer 2)

`artifacts` table, list/version/fork endpoints, controller skeletons.

### Layer 3 additions

1. **Materialisation** — when a tool returns an artifact (`file_generate`, `html_generate`, `chart_generate`), the artifact service:
   - Hashes content (sha256).
   - Looks up an existing artifact by hash + user — if found, returns a "fork" pointer instead of duplicating storage.
   - Otherwise stores: text in `artifacts.content_text` if < 64KB, else file in storage (local volume in dev, R2 in prod) and `artifacts.storage_path`.
2. **Versioning** — every "edit this artifact" tool call creates a child row with `parent_id` and `version_number = parent.version_number + 1`. `is_latest` is recomputed.
3. **Preview generation**:
   - `html` → sandboxed iframe URL with `srcdoc=<sanitised>`.
   - `markdown` → server-side render to HTML, cached for 24h.
   - `code` → Shiki-highlighted HTML.
   - `csv/xlsx` → 50-row preview JSON.
   - Image → signed URL.
4. **Diff** — `GET /api/v1/artifacts/:id/diff?against=:otherId` returns line-level diff for text-mode artifacts; binary-mode artifacts return `unsupported`.

### Storage abstraction

```typescript
interface ArtifactStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  signedUrl(key: string, ttlSec: number): Promise<string>;
  delete(key: string): Promise<void>;
}
```

Local-volume implementation in dev. R2 implementation in prod via env switch — no other code change.

---

## 11. Module 20 — File Ingestion Pipeline

**Files:** `src/workers/file.worker.ts` (exists, needs body), `src/files/parser.ts`, `src/files/embedder.ts`

### Flow

```
POST /api/v1/files/upload
  → write to storage
  → INSERT files (status='pending')
  → enqueue file.queue { fileId }
  → return { fileId, status: 'pending' }

[file.worker]
  1. UPDATE files SET status='processing'
  2. parse based on mime type:
       pdf/docx/xlsx → Unstructured.io API
       csv/txt       → native
       png/jpg       → vision-model description (only if user opts in)
       mp4           → out of scope this phase
  3. extracted text → chunked (1000 tokens, 100 overlap)
  4. embed each chunk → upsert into Qdrant `files:{userId}` with payload
       { fileId, chunkIndex, text, page?, sectionTitle? }
  5. UPDATE files SET status='ready', extracted_text (if small), vectorised=true
  6. publish files.ready SSE on user's notification channel
```

### Tool integration

`file_read` tool accepts a `fileId` and an optional natural-language sub-query. Implementation:
- If sub-query present: embed it, retrieve top-k chunks from Qdrant filtered by `fileId`, return concatenated chunks.
- If absent: return `extracted_text` (or top 20 chunks by document order if too large).

### Plan caps

Already enforced at Layer 2 (`maxFileSize`, `maxFilesPerChat`). Layer 3 enforces:
- Embedding tokens count toward a separate `feature:embedding:monthly:{userId}` counter.
- Files older than `plan.fileRetentionDays` are purged by `usage.cleanup.worker`.

---

## 12. Module 21 — Code Execution (Judge0)

**Files:** `src/execution/judge0.service.ts`, `src/tools/codeExecute.tool.ts`

### Container topology

Two containers in EasyPanel:
- `judge0` — REST API
- `judge0-workers` — execution workers
Both on the internal Docker network. Postgres is shared with the main app on a separate database.

### Call shape

```typescript
const result = await judge0.run({
  source_code:    code,
  language_id:    LANG_MAP[language],
  stdin:          stdin ?? '',
  cpu_time_limit: planCaps.maxExecSeconds,
  memory_limit:   planCaps.maxMemoryKb,
  callback_url:   `${env.PUBLIC_URL}/internal/judge0/callback`,
});
```

Synchronous wait or callback both supported. Default: synchronous up to 12s, then poll-once.

### Output handling

| Status | Action |
|---|---|
| `Accepted` | Return stdout to LLM as tool result |
| `Compilation Error` | Return compile_output + last 50 lines of stderr |
| `Time Limit Exceeded` | Return error + `{ retryable: false, hint: 'reduce work' }` |
| `Runtime Error` | Return stderr |
| File written to `/tmp/output.png` | Pull file via Judge0's `/submissions/:token/files`, create image artifact |

### Quotas

Already gated by Module 3 (`feature:codeexec:hourly`, `feature:codeexec:daily`).

### Languages (Phase 1)

Python 3, Node, TypeScript, C, C++, Java, Go, Rust, Bash.

---

## 13. Module 22 — Subagents & Isolation

**Files:** `src/runtime/subagent.ts`

### Why

Heavy retrieval (multi-page web reads, large file analysis) would balloon the main agent's context window. Subagents run in **isolated context** and return only a synthesis.

### Contract

```typescript
async function spawnSubagent(input: {
  task: 'summarise_pages' | 'extract_facts' | 'compare_documents';
  inputs: unknown;                 // task-specific
  parentJobId: string;
  modelTier?: ModelTier;           // defaults to 'standard'
  maxOutputTokens?: number;
}): Promise<{ summary: string; tokensUsed: number; creditsUsed: number; sources?: Citation[] }>;
```

### Isolation guarantees

- Subagent has its own `messages: []` — does not see parent conversation.
- Subagent has a fixed system prompt per task type (cached separately).
- Output is **bounded** (default 800 tokens) — prevents the parent context from growing.
- Subagent cost is added to the parent's `usage_records` under `metadata.subagentCost` and `metadata.subagentTokens`.

### Use sites

- Research agent: spawns one subagent per fetched page → returns 3-bullet summaries → parent synthesises.
- Document agent: spawns subagent per file when 3+ files are attached.
- Architect agent: never spawns (single coherent reasoning).

---

## 14. Module 23 — Cost Telemetry & Observability

**Files:** `src/observability/costTracker.ts`, `src/observability/metrics.ts`, `src/routes/admin/costs.routes.ts`

### What gets emitted (per terminal job, in addition to Module 6 row)

```
Postgres INSERT api_calls (
  request_id, user_id, provider, model, agent_slug,
  input_fresh, input_cached, output, cache_write,
  cost_usd_billed_to_us,                 ← actual provider invoice estimate
  credits_charged_to_user,
  cache_layer, tool_count, latency_ms,
  created_at
)
```

The two-table design lets us compare `cost_usd` vs `credits_charged_to_user × $/credit` and watch margin per (model, agent, plan) bucket.

### Live counters (Redis)

```
metrics:cache:semantic:{date}     INCR on hit
metrics:cache:prompt:{date}       INCR on hit (inputTokensCached > 0)
metrics:provider:{name}:ok        INCR on success
metrics:provider:{name}:err       INCR on retryable error
metrics:agent:{slug}:p95latency   reservoir sample (last 1k)
```

### Admin endpoints (costs under `/api/v1/admin/analytics/costs/*`)

```
GET /api/v1/admin/analytics/costs/overview   → today / 7d / 30d totals + margin
GET /api/v1/admin/analytics/costs/by-model   → tokens, calls, $ per model
GET /api/v1/admin/analytics/costs/by-agent   → agent multiplier effectiveness
GET /api/v1/admin/analytics/costs/cache-roi → semantic + prompt cache savings (estimate)
GET /api/v1/admin/analytics/live             → Redis live counters (cache / providers / agents)
```

---

## 15. Database Schema (Layer 3 additions)

```sql
-- Long-term memory facts (mirrors Qdrant for audit/UX)
memory_facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact            TEXT NOT NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  confidence      NUMERIC(3,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by   UUID REFERENCES memory_facts(id),
  UNIQUE (user_id, fact)
);

-- Semantic cache audit (Qdrant is the live store, this is for analytics)
semantic_cache_hits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  cache_id     TEXT NOT NULL,                  -- sha256 key
  similarity   NUMERIC(4,3) NOT NULL,
  saved_credits NUMERIC(10,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cost ledger (separate from Module 6 usage_records by purpose)
api_calls (
  request_id              UUID PRIMARY KEY,    -- == jobId
  user_id                 UUID NOT NULL,
  provider                TEXT NOT NULL,
  model                   TEXT NOT NULL,
  agent_slug              TEXT NOT NULL,
  input_fresh             INT NOT NULL,
  input_cached            INT NOT NULL,
  output                  INT NOT NULL,
  cache_write             INT NOT NULL,
  cost_usd_billed_to_us   NUMERIC(12,6),
  credits_charged_to_user NUMERIC(12,2),
  cache_layer             TEXT,                -- 'semantic' | 'prompt' | 'none'
  tool_count              INT NOT NULL DEFAULT 0,
  latency_ms              INT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- File chunk index pointer (Qdrant is live; this gives us O(1) per-file lookup)
file_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index  INT NOT NULL,
  qdrant_id    TEXT NOT NULL,
  page         INT,
  section      TEXT,
  token_count  INT NOT NULL,
  UNIQUE (file_id, chunk_index)
);

-- Subagent runs
subagent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_job_id   UUID NOT NULL,
  task            TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INT NOT NULL,
  output_tokens   INT NOT NULL,
  credits_used    NUMERIC(10,2) NOT NULL,
  duration_ms     INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS preview_html TEXT,
  ADD COLUMN IF NOT EXISTS preview_generated_at TIMESTAMPTZ;
```

---

## 16. Folder Structure

```
src/
├── runtime/
│   ├── agentLoop.ts            ← shared agent loop (M13)
│   └── subagent.ts             ← isolated child runs (M22)
│
├── agents/                     ← already scaffolded; flesh out preflight + postProcess
│
├── tools/
│   ├── base.tool.ts
│   ├── registry.ts
│   ├── webSearch.tool.ts
│   ├── webFetch.tool.ts
│   ├── fileRead.tool.ts
│   ├── fileGenerate.tool.ts
│   ├── htmlGenerate.tool.ts
│   ├── chartGenerate.tool.ts
│   ├── codeExecute.tool.ts
│   └── imageAnalyse.tool.ts
│
├── prompt/
│   ├── assembler.ts
│   ├── cacheManager.ts
│   ├── compactor.ts
│   └── systemPrompts/
│       ├── chat.prompt.ts
│       ├── writer.prompt.ts
│       └── ...
│
├── memory/
│   ├── session.memory.ts
│   ├── vector.memory.ts
│   └── profile.memory.ts
│
├── cache/
│   ├── semantic.cache.ts
│   └── cacheKey.ts
│
├── artifacts/
│   ├── artifact.service.ts     ← extend existing
│   ├── artifact.storage.ts
│   └── preview.ts
│
├── files/
│   ├── parser.ts
│   ├── embedder.ts
│   └── retriever.ts
│
├── execution/
│   └── judge0.service.ts
│
├── models/                     ← already scaffolded
│   ├── provider.ts
│   ├── streaming.ts
│   ├── health.ts
│   └── providers/*
│
└── observability/
    ├── costTracker.ts
    └── metrics.ts
```

---

## 17. Phased Delivery

### Phase 3.1 — Real Streaming & Cost Truth (Weeks 1–2)
- [ ] Finish `chat.worker.ts` per `MODULE7_WORKER_AND_MODULE6_BRIDGE.md`
- [ ] Wire Anthropic + OpenAI streaming with prompt caching
- [ ] Provider health + fallback
- [ ] Keepalive scheduler
- [ ] `api_calls` table writes

### Phase 3.2 — Tools That Matter (Weeks 3–5)
- [ ] `web_search` (Tavily) + `web_fetch`
- [ ] `file_generate` (markdown, csv, xlsx, docx)
- [ ] `html_generate` + sandboxed preview
- [ ] Tool registry, parallel-safe execution

### Phase 3.3 — Memory & Cache (Weeks 6–8)
- [ ] Redis session memory + rolling summarisation
- [ ] Qdrant long-term memory (write + recall)
- [ ] Semantic response cache
- [ ] Memory user controls (`/api/v1/memory`)

### Phase 3.4 — Files & Code (Weeks 9–11)
- [ ] `file.worker` body — Unstructured.io ingestion
- [ ] File chunk embeddings + retrieval
- [ ] `file_read` tool
- [ ] Judge0 deployment + `code_execute` tool
- [ ] `chart_generate` via code execution

### Phase 3.5 — Artifacts End-to-End (Weeks 12–13)
- [ ] Storage abstraction + R2 path
- [ ] Versioning + fork
- [ ] Preview pipeline (markdown/code/csv/html/image)
- [ ] Diff endpoint

### Phase 3.6 — Subagents & Polish (Weeks 14–15)
- [ ] Subagent runtime
- [ ] Research agent uses subagents per page
- [ ] Cost dashboard + cache ROI views
- [ ] Load test: 100 concurrent streams

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Single agent loop, agents as config | Yes | Easier to reason about; agents = system prompt + tool whitelist + multipliers |
| Tool errors as data, not exceptions | Yes | LLM can recover; aligns with provider tool-use semantics |
| Two cost tables (`usage_records` + `api_calls`) | Yes | One is product-level (credits), one is finance-level (USD) |
| Qdrant per-user collections | Yes | Hard isolation; simpler hard-delete on account close |
| Subagent output bounded | Yes | Hard cap prevents context explosion |
| Semantic cache opt-out per user | Yes | Privacy-conscious users; required for paid tier with confidentiality |
| Storage abstraction from day one | Yes | Local→R2 migration is one env switch |
| Provider health window 60s | Yes | Long enough to be stable, short enough to recover |

---

*This document continues from `LAYER2_API_GATEWAY.md`. Module numbering picks up at 13 to avoid collision with Layer 2 modules.*
