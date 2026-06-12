# AI Platform — Project Architecture & Design Document

> **Status:** Pre-development planning  
> **Stack:** Express / TypeScript · Docker · EasyPanel · Linux VPS  
> **Last Updated:** April 2026

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [User Experience & Agent Modes](#2-user-experience--agent-modes)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Infrastructure & Deployment](#4-infrastructure--deployment)
5. [API Gateway & Security Layer](#5-api-gateway--security-layer)
6. [Smart Router & Model Selection](#6-smart-router--model-selection)
7. [Agent System](#7-agent-system)
8. [Tool System](#8-tool-system)
9. [Artifacts, File Versioning & Preview](#9-artifacts-file-versioning--preview)
10. [Code Execution (Judge0)](#10-code-execution-judge0)
11. [Memory Architecture](#11-memory-architecture)
12. [Prompt Engineering & Context Management](#12-prompt-engineering--context-management)
13. [Cost Management & Caching Strategy](#13-cost-management--caching-strategy)
14. [Plan System & Rate Limiting](#14-plan-system--rate-limiting)
15. [Project Folder Structure](#15-project-folder-structure)
16. [Database Schema Overview](#16-database-schema-overview)
17. [Open Source Stack](#17-open-source-stack)
18. [Phased Roadmap](#18-phased-roadmap)

---

## 1. Product Vision

A **multi-agent AI platform** comparable to Perplexity in search quality, with the artifact and file handling of Claude, and the code execution depth of a developer tool. Users interact through a clean chat interface and can select agents based on their task, let the system auto-select, or (for power users) pick a specific model directly.

### Core Principles

- **Simple by default, powerful when needed** — a content writer shouldn't see model dropdowns
- **Every answer is grounded** — search agents cite sources, no hallucination policy
- **Artifacts are first-class** — generated files are versioned, previewable, and downloadable
- **Cost-aware by design** — caching and model routing built in from day one, not retrofitted
- **One server to start** — no Kubernetes, no microservices until traffic demands it

---

## 2. User Experience & Agent Modes

### 2.1 Three Interaction Modes

#### Mode A — Task-Based Agents (Default for most users)
Pre-configured agents optimised for a specific job. User picks from a list and talks naturally.

| Agent Name | What It Does | Models Used |
|---|---|---|
| **Content Writer** | Blog posts, emails, social copy, SEO content | Mid-tier (Sonnet / GPT-4o) |
| **Research Agent** | Web search, synthesis, citations | Mid + web search tool |
| **Code Assistant** | Write, explain, debug, refactor code | Mid/Frontier based on complexity |
| **Data Analyst** | Analyse CSVs, query data, generate charts | Mid + code execution |
| **Architecture Builder** | System design, diagrams, tech specs | Frontier (Opus / GPT-4) |
| **Debugger** | Paste error, get root cause + fix | Mid + code execution |
| **Document Agent** | Read, summarise, compare, extract from files | Mid + file parser |
| **UI Generator** | Describe a UI, get HTML/CSS/JS preview | Mid + HTML renderer |

Each task agent has:
- A fixed system prompt optimised for that domain
- A curated tool set (only the tools it actually needs)
- A default model tier (upgraded automatically if query complexity warrants it)
- Plan-gated availability (some agents are Pro/Enterprise only)

#### Mode B — Auto Agent (Recommended for general use)
User types anything. The smart router classifies intent, selects the best task agent, picks the right model, and dispatches. No configuration required. This is the "just talk to it" mode.

#### Mode C — Power User / Custom (Pro & Enterprise)
User can:
- Manually select a specific model (GPT-4o, Claude Opus, Gemini Ultra, etc.)
- Force a specific agent even if auto-routing would pick differently
- Set custom system prompt prefix ("always respond in bullet points")
- Choose search context depth (low / medium / high)
- Adjust temperature and reasoning effort (where supported)

### 2.2 Agent Switching Mid-Conversation
Users can switch agents mid-session. On switch:
- Current conversation summary is preserved
- New agent's system prompt is injected
- Cache for old agent's prefix is discarded (new cache write on first call)
- Artifacts from previous agent remain accessible in the sidebar

---

## 3. System Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   CLIENT (Browser)                   │
│   Chat UI · Agent Selector · Artifact Panel          │
│   HTML Preview iframe · Code Runner output           │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS / SSE / WebSocket
┌────────────────────▼────────────────────────────────┐
│              NGINX (EasyPanel built-in)              │
│   SSL termination · Domain routing · Rate limit      │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│           EXPRESS / TYPESCRIPT API SERVER            │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ Gateway  │  │  Router  │  │   Agent Dispatcher  │ │
│  │ Auth     │  │ Classify │  │   Runs agent loop   │ │
│  │ RateLimit│  │ Route    │  │   Streams response  │ │
│  │ PlanCheck│  │ Model    │  │   Manages context   │ │
│  └──────────┘  └──────────┘  └────────────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              AGENTS (per type)               │    │
│  │  SearchAgent · CodeAgent · FileAgent         │    │
│  │  WriterAgent · AnalystAgent · UIAgent · ...  │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │                  TOOLS                       │    │
│  │  WebSearch · FileParser · FileGenerator      │    │
│  │  Judge0Runner · HTMLRenderer · SemanticCache │    │
│  └──────────────────────────────────────────────┘    │
└──────┬─────────────┬────────────┬───────────────────┘
       │             │            │
  ┌────▼────┐  ┌─────▼──┐  ┌─────▼────┐
  │Postgres │  │ Redis  │  │  Qdrant  │
  │Users    │  │Session │  │ Vectors  │
  │Chats    │  │Cache   │  │ Memory   │
  │Artifacts│  │RateLim │  │ SemanCache│
  │Plans    │  │Keepaliv│  │          │
  └─────────┘  └────────┘  └──────────┘
       │
  ┌────▼────────────────┐
  │   File Storage      │
  │  /uploads volume    │
  │  (→ Cloudflare R2   │
  │   when scaling)     │
  └─────────────────────┘
```

### Data Flow for a Typical Query

```
1. User sends message
2. Gateway: auth check → plan check → rate limit check
3. Semantic cache lookup (Qdrant/Redis) → if hit, return instantly
4. Smart router: classify intent + complexity
5. Select agent + select model tier
6. Assemble prompt (cached prefix + fresh suffix)
7. Call LLM API with streaming
8. Stream tokens to client via SSE
9. If tool call detected: pause stream, execute tool, inject result, resume
10. On completion: store in Postgres, update vector memory, cache response
```

---

## 4. Infrastructure & Deployment

### 4.1 Single Server Setup (Current — Pre-funding)

**Recommended VPS:** Hetzner CX32 or DigitalOcean 4GB droplet (~$20–40/month)  
**Management:** EasyPanel (self-hosted free, or $10/month cloud)

#### EasyPanel Services (5 containers total)

| Service Name | Docker Image | Purpose | Exposed? |
|---|---|---|---|
| `api` | Custom build | Express app + all agents | Yes (via Nginx) |
| `postgres` | `postgres:16` | Users, chats, plans, artifacts | Internal only |
| `redis` | `redis:7-alpine` | Sessions, rate limits, keepalive | Internal only |
| `qdrant` | `qdrant/qdrant` | Vector memory, semantic cache | Internal only |
| `judge0` | `judge0/judge0` | Code execution sandbox | Internal only |

All containers communicate on Docker's internal network. Only `api` is exposed through Nginx.

**Connection strings (internal Docker network):**
```
Postgres:  postgres:5432
Redis:     redis:6379
Qdrant:    qdrant:6333
Judge0:    judge0:2358
```

### 4.2 File Storage

**Phase 1 (now):** Docker volume mounted to `/uploads` on the `api` container  
**Phase 2 (scaling):** Cloudflare R2 — S3-compatible, generous free tier (10GB free), one config change to switch

### 4.3 When to Add a Second Server

| Trigger | Solution |
|---|---|
| Code execution crushing API server CPU | Move Judge0 to a second VPS |
| Wanting local model inference (Llama, Mistral) | Add GPU VPS (Hetzner, Lambda Labs) |
| Postgres becoming a bottleneck | Move to Supabase managed or second VPS |
| Traffic > 500 concurrent users | Horizontal scale: multiple API containers behind Nginx |

### 4.4 CI/CD

- GitHub → push to `main` triggers build
- EasyPanel webhook pulls new Docker image and redeploys
- Zero-downtime: EasyPanel handles container replacement
- Environment variables: managed in EasyPanel UI, never in code

---

## 5. API Gateway & Security Layer

Every request passes through middleware in this exact order before reaching any agent:

```
Request
  → 1. JWT Authentication (verify token, load user)
  → 2. Plan Resolver (load user's plan from Redis cache, fallback Postgres)
  → 3. Capability Check (does this plan allow this action/agent?)
  → 4. Rate Limiter (token bucket per user, keyed in Redis)
  → 5. Cost Budget Check (has user exceeded hourly spend limit?)
  → 6. Request Sanitiser (strip prompt injection attempts)
  → Agent Dispatcher
```

### 5.1 Rate Limiting Strategy

Rate limits are enforced on **two dimensions** simultaneously:

**Request rate (RPM):**
```
Free:       10 requests/minute
Pro:        60 requests/minute
Enterprise: 300 requests/minute
```

**Cost budget (per hour):**
```
Free:       $0.05/hour equivalent
Pro:        $0.50/hour equivalent  
Enterprise: Custom
```

Counting spend, not just requests, prevents a free user from running 10 file-analysis tasks (expensive) vs 10 simple chats (cheap). Redis stores both counters with TTLs.

**Aggressive user handling:**
- 3 rate limit hits in 10 minutes → 15-minute cooldown
- 5 cooldowns in 24 hours → flag for manual review
- Respond with `429` + `Retry-After` header, never silently drop

### 5.2 Capability Matrix

```typescript
const PLAN_CAPABILITIES = {
  free: {
    agents: ['chat', 'writer'],
    webSearch: false,
    fileUpload: false,
    fileGeneration: false,
    codeExecution: false,
    modelSelection: false,
    maxContextMessages: 10,
    artifactVersions: 1,
  },
  pro: {
    agents: ['chat', 'writer', 'research', 'code', 'document', 'ui'],
    webSearch: true,
    fileUpload: true,
    fileGeneration: true,
    codeExecution: true,
    modelSelection: false,     // auto-routing only
    maxContextMessages: 50,
    artifactVersions: 10,
  },
  enterprise: {
    agents: ['all'],
    webSearch: true,
    fileUpload: true,
    fileGeneration: true,
    codeExecution: true,
    modelSelection: true,      // full model picker
    maxContextMessages: 200,
    artifactVersions: 'unlimited',
  }
}
```

---

## 6. Smart Router & Model Selection

### 6.1 Query Classification

Before any expensive LLM call, a cheap classifier runs (nano-tier model, ~$0.0001 per call):

```typescript
interface ClassificationResult {
  intent: 'search' | 'code' | 'write' | 'analyse' | 'design' | 'debug' | 'ui' | 'chat';
  complexity: 'simple' | 'medium' | 'complex';
  needsWebSearch: boolean;
  needsCodeExecution: boolean;
  needsFileRead: boolean;
  needsFileGen: string[];          // ['excel', 'markdown', 'docx', ...]
  searchContextSize: 'low' | 'medium' | 'high';
  suggestedAgent: string;
  confidence: number;              // 0–1, low confidence → fallback to auto
}
```

### 6.2 Model Routing Table

| Complexity | Anthropic | OpenAI | Google | Cost Approx |
|---|---|---|---|---|
| Simple | Claude Haiku 4.5 | GPT-4o-mini | Gemini Flash | ~$0.001 |
| Medium | Claude Sonnet 4.6 | GPT-4o | Gemini Pro | ~$0.01 |
| Complex | Claude Opus 4.6 | GPT-4 | Gemini Ultra | ~$0.05–0.20 |

The router defaults to the user's chosen provider. If that provider is down or rate-limited, it falls back to the next available one (LiteLLM handles this transparently).

### 6.3 Query Rewriting (Perplexity-style)

For search queries, before hitting the search API:

```
Input:  "whats the best way to learn typescript in 2025"
Output: {
  search_queries: [
    "TypeScript learning roadmap 2026",
    "best TypeScript courses beginners 2025 2026",
    "TypeScript vs JavaScript learning path"
  ],
  time_filter: "past_year"
}
```

Multiple queries are run in parallel and results are merged and de-duplicated before being fed to the LLM.

---

## 7. Agent System

### 7.1 Agent Architecture

Each agent is a TypeScript class implementing a common interface:

```typescript
interface Agent {
  name: string;
  description: string;
  allowedTools: ToolName[];
  defaultModelTier: 'nano' | 'mid' | 'frontier';
  systemPrompt: string;            // static, heavily cached
  
  run(
    query: string,
    context: SessionContext,
    tools: Tool[],
    onToken: (token: string) => void,
    onToolCall: (call: ToolCall) => void
  ): Promise<AgentResult>;
}
```

### 7.2 Agent Loop (Agentic Behaviour)

```
1. Assemble prompt (cached prefix + conversation + query)
2. Call LLM with streaming
3. Parse stream for:
   a. Regular text → stream to user
   b. Tool call → pause, execute tool, inject result, continue loop
   c. End of response → finalise
4. If tool result triggers another tool call → loop (max 10 iterations)
5. On max iterations: return partial result with explanation
```

### 7.3 Subagent Isolation

For tasks that would flood the main context (heavy web search, file reading):

```
Main Agent Context:
  User query
  Conversation history
  ↓ spawns
  
  Subagent (isolated context window):
    Task-specific system prompt
    Only the data it needs
    Returns: summary (not raw data)
  ↓ injects only
  
  Summary back into main context
```

This keeps the main conversation context clean and cheap. The subagent's raw content (scraped web pages, file text) never pollutes the main context.

### 7.4 System Prompt Structure Per Agent

```
[CACHED — never changes]
You are {AgentName}, a specialised AI assistant for {domain}.

STRICT RULES:
- {domain-specific constraints}
- Only use information from retrieved sources (search agents)
- Always cite sources with [1], [2] inline notation
- If you cannot answer from retrieved context, say so

OUTPUT FORMAT:
- {format rules specific to this agent}

TOOLS AVAILABLE:
{tool definitions — cached at this breakpoint}

[FRESH — appended per call, never cached]
Today: {date}
User plan: {plan_tier}
Session context: {summary of conversation so far}

CONVERSATION:
{last N messages}

USER: {current query}
RETRIEVED CONTEXT: {search results / file content}
```

---

## 8. Tool System

Every tool follows the "reason" pattern — the LLM must state why it's calling the tool before it executes. This forces reasoning and reduces unnecessary calls.

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: {
    reason: { type: 'string', description: 'One sentence: why this tool is needed now' };
    // tool-specific params below
  };
  planRequired: 'free' | 'pro' | 'enterprise';
  execute(params: any, context: SessionContext): Promise<ToolResult>;
}
```

### 8.1 Tool Catalogue

| Tool | Description | Plan | Notes |
|---|---|---|---|
| `web_search` | Tavily API search, returns ranked results with sources | Pro+ | Query rewriting before call |
| `web_fetch` | Fetch and parse a specific URL | Pro+ | Sanitised, no JS execution |
| `file_read` | Parse uploaded PDF, DOCX, XLSX, CSV, TXT | Pro+ | Unstructured.io |
| `file_generate` | Generate Excel, CSV, Markdown, Word, TXT | Pro+ | Returns artifact |
| `html_generate` | Generate HTML/CSS/JS page | Pro+ | Returns preview artifact |
| `code_execute` | Run Python, C++, JS, etc. via Judge0 | Pro+ | Sandboxed, timeout 10s |
| `image_analyse` | Describe or extract data from image uploads | Pro+ | Via vision model |
| `database_query` | Natural language → SQL on user's connected DB | Enterprise | Schema in context |
| `chart_generate` | Generate chart from data (returns image artifact) | Pro+ | Via code execution |

---

## 9. Artifacts, File Versioning & Preview

### 9.1 What is an Artifact?

Any generated output that has a standalone existence beyond the chat message. This includes:
- Generated files (Excel, CSV, Markdown, Word, TXT, HTML)
- Code snippets (Python, JS, C++, etc.)
- Diagrams and charts
- HTML/CSS UI previews

### 9.2 Artifact Types

```typescript
type ArtifactType = 
  | 'code'          // syntax-highlighted, executable
  | 'html'          // sandboxed preview + code view
  | 'markdown'      // rendered preview + raw
  | 'excel'         // download only (future: inline grid view)
  | 'csv'           // table preview + download
  | 'docx'          // download + text preview
  | 'image'         // inline preview
  | 'chart'         // inline preview + data download
  | 'text';         // plain text
```

### 9.3 Versioning System

Every artifact is immutable once created. Edits create new versions:

```
Postgres: artifacts table
  id (uuid)
  session_id
  user_id
  title                     ← user-editable label
  type                      ← ArtifactType
  parent_id (nullable)      ← null if first version, else points to previous
  version_number            ← 1, 2, 3...
  content_hash              ← SHA256 of content (deduplication)
  file_path (nullable)      ← for binary files stored on disk/R2
  content_text (nullable)   ← for text artifacts stored inline in Postgres
  created_at
  created_by_agent          ← which agent produced this
  is_latest                 ← boolean, updated on new version creation
```

**Retrieving version history:**
```sql
SELECT * FROM artifacts
WHERE parent_id = $root_artifact_id OR id = $root_artifact_id
ORDER BY version_number ASC;
```

### 9.4 Preview System

Previews are rendered client-side, never server-side:

**HTML/CSS/JS Artifacts:**
```html
<!-- Sandboxed iframe — strict CSP, no external requests -->
<iframe
  sandbox="allow-scripts"
  csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
  srcdoc="{artifact_html_content}"
/>
```

**Code Artifacts:**
- Displayed in a syntax-highlighted code block (Shiki or Prism)
- "Run" button triggers Judge0 execution (if plan allows)
- Output shown below in a terminal-style panel

**Markdown Artifacts:**
- Rendered with a markdown library (marked.js or remark)
- "Raw" toggle to see source

**CSV Artifacts:**
- Rendered as a sortable, filterable table (TanStack Table)
- Download button always visible

### 9.5 Artifact Diff View

When a user asks to "edit" or "improve" an existing artifact, the agent creates a new version. The UI shows a split diff view (old version left, new version right) before the user accepts the new version. Concept borrowed from Cursor's checkpoint system.

---

## 10. Code Execution (Judge0)

### 10.1 Why Judge0

- Open source (AGPL), self-hostable on EasyPanel
- Supports 60+ languages out of the box (Python, C++, JS, Java, Go, Rust, etc.)
- Built-in sandboxing: no network, resource limits, timeout enforcement
- Returns stdout, stderr, compile errors, and exit code
- REST API — simple to call from Express

### 10.2 Judge0 EasyPanel Setup

Judge0 requires two containers in EasyPanel:
- `judge0` — the API server (`judge0/judge0`)
- `judge0-workers` — execution workers (`judge0/judge0` with worker mode)
- Shares the same Postgres instance (separate database)

### 10.3 Execution Flow

```
User clicks "Run" on a code artifact
  → Express receives: { code, language, artifact_id }
  → Check plan (code execution allowed?)
  → Check rate limit (separate execution rate limit)
  → POST to Judge0: { source_code, language_id, stdin, time_limit: 10, memory_limit: 256000 }
  → Poll for result (or use Judge0 callback)
  → Return: { stdout, stderr, status, time_taken, memory_used }
  → Display in terminal panel below artifact
  → If output is a file (e.g. a chart PNG) → create new artifact
```

### 10.4 Supported Languages (Phase 1)

Python 3, JavaScript (Node), TypeScript, C, C++, Java, Go, Rust, Bash

### 10.5 Safety Limits Per Plan

| Limit | Free | Pro | Enterprise |
|---|---|---|---|
| Max execution time | — | 10s | 30s |
| Max memory | — | 256MB | 512MB |
| Executions per hour | 0 | 20 | 100 |
| Max output size | — | 1MB | 5MB |

---

## 11. Memory Architecture

### 11.1 Three-Tier Memory

```
TIER 1 — In-Context (RAM, per-request)
  Last 10–20 messages sent raw in LLM prompt
  Lifespan: single request
  
TIER 2 — Session Memory (Redis)
  Full conversation per session
  Rolling summarisation when token count > 60% of limit
  Lifespan: session (TTL: 24 hours of inactivity)
  
TIER 3 — Long-Term Memory (Qdrant)
  Semantic embeddings of all past conversations
  User facts, preferences, past artifacts
  Retrieved by similarity on each new query
  Lifespan: permanent (per user)
```

### 11.2 Rolling Summarisation (Context Rot Prevention)

```
On every agent call:
  tokenCount = estimate(systemPrompt + history + query)
  
  if tokenCount > 60% of model limit:
    summary = cheapLLM("Summarise these messages in 200 words: {old_messages}")
    replace old_messages with summary paragraph in context
    
  if tokenCount > 85% of model limit:
    full_summary = cheapLLM("Summarise entire conversation: {all_messages}")
    context = systemPrompt + full_summary + last_3_messages + current_query
```

### 11.3 Memory Isolation

Each user's memory is fully isolated. Qdrant collections are namespaced by `user_id`. There is no cross-user memory bleed under any circumstances.

---

## 12. Prompt Engineering & Context Management

### 12.1 Prompt Assembly Order (Critical for Caching)

```
REQUEST STRUCTURE (Anthropic):

system: [
  {
    type: "text",
    text: AGENT_IDENTITY_AND_RULES          ← static, never changes
  },
  {
    type: "text", 
    text: TOOL_DEFINITIONS,                 ← changes only on plan change
    cache_control: { type: "ephemeral" }    ← CACHE BREAKPOINT 1
  }
]

messages: [
  { role: "user",      content: CONVERSATION_SUMMARY },
  { role: "assistant", content: SUMMARY_RESPONSE },
  ...recent raw messages...,
  {
    role: "user",
    content: LAST_STABLE_HISTORY,           ← last N messages (stable zone)
    cache_control: { type: "ephemeral" }    ← CACHE BREAKPOINT 2
  },
  {
    role: "user",
    content: CURRENT_QUERY + "\n\n" +       ← always fresh, never cached
             RETRIEVED_CONTEXT +
             "\nToday: " + date +
             "\nPlan: " + userPlan
  }
]
```

**Golden rule:** Never put dynamic content (timestamps, user names, session IDs) in the cached prefix. The prefix must be byte-identical across requests for the cache to hit.

### 12.2 The "Reason" Pattern for Tools

Every tool definition includes a non-functional `reason` parameter:

```typescript
{
  name: "web_search",
  parameters: {
    reason: {
      type: "string",
      description: "One sentence explaining why this search is needed right now"
    },
    query: { type: "string" },
    context_size: { enum: ["low", "medium", "high"] }
  }
}
```

This forces the LLM to reason before acting, dramatically reducing unnecessary tool calls.

### 12.3 Grounding Constraint (Perplexity-style)

For all search-enabled agents, this rule is in the system prompt (cached):

```
STRICT GROUNDING RULE:
You must ONLY state information that appears in the retrieved context provided below.
Do not use your training knowledge to fill gaps.
If the retrieved context does not contain the answer, say: "I couldn't find this in the sources."
Every factual claim must be followed by an inline citation [1], [2], etc.
```

---

## 13. Cost Management & Caching Strategy

### 13.1 Three-Layer Cache Architecture

```
Layer 1 — Semantic Response Cache (Redis + Qdrant)
  Scope: cross-user
  What: embed incoming query, check similarity against past answers
  Threshold: cosine similarity > 0.92 → return cached response
  TTL: 7 days (factual), 4 hours (search results), 24 hours (code)
  Do NOT cache: user-specific queries, file analysis, anything with PII
  Savings: ~31% of queries hit this

Layer 2 — Provider Prompt Cache (per-session)
  Scope: per-user, per-session
  What: static system prompt + tool definitions cached at provider level
  Anthropic: 90% off cached reads, cache_control markers required
  OpenAI: 50% off, fully automatic (no code changes needed)
  TTL: 5 minutes (Anthropic default), 1 hour optional (2× write cost)
  Keepalive: ping every 4 minutes for active sessions
  Savings: 70–90% of input token cost for repeat calls

Layer 3 — Model Tier Routing
  Scope: per-query
  What: route to cheapest model that can answer correctly
  Simple queries → Haiku / GPT-4o-mini (10–20× cheaper than frontier)
  Complex only → Opus / GPT-4
  Savings: 60–80% on model costs vs always using frontier
```

### 13.2 What Breaks Caching (Never Do These)

```typescript
// ❌ BAD — timestamp in cached prefix invalidates cache every call
const systemPrompt = `You are an assistant. Current time: ${new Date().toISOString()}. ${RULES}`;

// ✅ GOOD — timestamp only in the fresh suffix (not cached)
const systemPrompt = STATIC_AGENT_RULES;                // cached
const userMessage  = `Today: ${new Date().toDateString()}\n${userQuery}`;  // fresh

// ❌ BAD — user name in system prompt = unique per user = no cross-user cache
const systemPrompt = `You are helping ${user.name}. ${RULES}`;

// ✅ GOOD — user-specific data in the non-cached user message
const systemPrompt = STATIC_RULES;                      // cached
const userMessage  = `[User: ${user.name}]\n${userQuery}`;  // fresh
```

### 13.3 Cache Keepalive (Anthropic 5-min TTL)

```typescript
class SessionCacheManager {
  private keepAliveTimers = new Map<string, NodeJS.Timeout>();

  startKeepAlive(sessionId: string, agentType: string) {
    const timer = setInterval(async () => {
      await callProvider({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        system: [
          { type: 'text', text: getStaticSystemPrompt(agentType) },
          { type: 'text', text: getToolDefs(agentType),
            cache_control: { type: 'ephemeral' } }
        ],
        messages: [{ role: 'user', content: 'ping' }]
      });
    }, 4 * 60 * 1000);    // every 4 minutes — before 5-min TTL expires
    
    this.keepAliveTimers.set(sessionId, timer);
  }
  
  stopKeepAlive(sessionId: string) {
    clearInterval(this.keepAliveTimers.get(sessionId));
    this.keepAliveTimers.delete(sessionId);
  }
}
```

### 13.4 Cost Tracking

Every API call is logged to Postgres:

```sql
TABLE api_calls (
  id              UUID PRIMARY KEY,
  user_id         UUID,
  session_id      UUID,
  agent_type      TEXT,
  provider        TEXT,          -- anthropic | openai | google
  model_used      TEXT,
  input_tokens_fresh    INT,     -- billed at full rate
  input_tokens_cached   INT,     -- billed at 10% or 50%
  output_tokens         INT,     -- always full rate
  cache_write_tokens    INT,
  cost_usd              DECIMAL, -- calculated and stored
  cache_hit_layer       TEXT,    -- semantic | prompt | none
  response_ms           INT,
  created_at            TIMESTAMPTZ
)
```

A lightweight dashboard (internal only) shows: cache hit rate, cost per user, model distribution, cache ROI.

---

## 14. Plan System & Rate Limiting

### 14.1 Plan Tiers

| Feature | Free | Pro ($20/mo) | Enterprise (custom) |
|---|---|---|---|
| Task agents | Chat, Writer | All 8 agents | All + custom agents |
| Auto agent | ✓ | ✓ | ✓ |
| Model picker | ✗ | ✗ | ✓ |
| Web search | ✗ | ✓ | ✓ |
| File upload | ✗ | ✓ (10MB) | ✓ (100MB) |
| File generation | ✗ | ✓ | ✓ |
| Code execution | ✗ | ✓ | ✓ |
| HTML preview | ✗ | ✓ | ✓ |
| Artifact versions | 1 | 10 | Unlimited |
| Context length | 10 msgs | 50 msgs | 200 msgs |
| Long-term memory | ✗ | ✓ | ✓ |
| Requests/min | 10 | 60 | 300 |
| Hourly cost cap | $0.05 | $0.50 | Custom |
| Code executions/hr | 0 | 20 | 100 |

### 14.2 Redis Rate Limit Keys

```
ratelimit:rpm:{user_id}          → sliding window, 60s TTL
ratelimit:cost:{user_id}:hour    → token bucket, 3600s TTL  
ratelimit:exec:{user_id}:hour    → execution counter, 3600s TTL
ratelimit:cooldown:{user_id}     → set on 3rd hit, 900s TTL
```

---

## 15. Project Folder Structure

```
project-root/
│
├── src/
│   ├── index.ts                    ← Express app entry
│   ├── config/
│   │   ├── env.ts                  ← zod-validated env vars
│   │   ├── models.ts               ← model map per provider + tier
│   │   └── plans.ts                ← capability matrix
│   │
│   ├── gateway/
│   │   ├── auth.middleware.ts      ← JWT verification
│   │   ├── plan.middleware.ts      ← plan resolver + capability check
│   │   ├── rateLimit.middleware.ts ← Redis token bucket
│   │   ├── costBudget.middleware.ts← hourly spend check
│   │   └── sanitise.middleware.ts  ← prompt injection prevention
│   │
│   ├── router/
│   │   ├── classifier.ts           ← cheap LLM query classifier
│   │   ├── modelSelector.ts        ← complexity → model tier
│   │   ├── agentDispatcher.ts      ← intent → agent
│   │   └── queryRewriter.ts        ← expand query for search
│   │
│   ├── agents/
│   │   ├── base.agent.ts           ← abstract Agent class + loop
│   │   ├── chat.agent.ts
│   │   ├── writer.agent.ts
│   │   ├── research.agent.ts
│   │   ├── code.agent.ts
│   │   ├── document.agent.ts
│   │   ├── analyst.agent.ts
│   │   ├── architect.agent.ts
│   │   ├── debugger.agent.ts
│   │   └── ui.agent.ts
│   │
│   ├── tools/
│   │   ├── base.tool.ts            ← Tool interface
│   │   ├── webSearch.tool.ts       ← Tavily API
│   │   ├── webFetch.tool.ts        ← URL scraper
│   │   ├── fileRead.tool.ts        ← Unstructured.io parser
│   │   ├── fileGenerate.tool.ts    ← Excel, CSV, DOCX, MD, TXT
│   │   ├── htmlGenerate.tool.ts    ← HTML/CSS/JS artifact
│   │   ├── codeExecute.tool.ts     ← Judge0 caller
│   │   ├── chartGenerate.tool.ts   ← Chart via code execution
│   │   └── imageAnalyse.tool.ts    ← Vision model calls
│   │
│   ├── prompt/
│   │   ├── assembler.ts            ← Builds full prompt per call
│   │   ├── cacheManager.ts         ← cache_control placement + keepalive
│   │   ├── compactor.ts            ← Rolling summarisation logic
│   │   └── systemPrompts/
│   │       ├── chat.prompt.ts
│   │       ├── writer.prompt.ts
│   │       ├── research.prompt.ts
│   │       └── ...
│   │
│   ├── memory/
│   │   ├── session.memory.ts       ← Redis session store
│   │   ├── vector.memory.ts        ← Qdrant long-term memory
│   │   └── semantic.cache.ts       ← Cross-user semantic cache
│   │
│   ├── models/
│   │   ├── provider.ts             ← Unified LLM caller (LiteLLM-style)
│   │   ├── anthropic.ts            ← Anthropic SDK wrapper
│   │   ├── openai.ts               ← OpenAI SDK wrapper
│   │   └── streaming.ts            ← SSE stream handler
│   │
│   ├── artifacts/
│   │   ├── artifact.service.ts     ← Create, version, retrieve
│   │   ├── artifact.storage.ts     ← File I/O (local → R2)
│   │   └── artifact.preview.ts     ← Preview URL generation
│   │
│   ├── execution/
│   │   └── judge0.service.ts       ← Code execution wrapper
│   │
│   ├── costs/
│   │   ├── tracker.ts              ← Log every API call cost
│   │   └── calculator.ts           ← Token → USD per provider/model
│   │
│   ├── db/
│   │   ├── postgres.ts             ← Pool connection
│   │   ├── redis.ts                ← Redis client
│   │   ├── qdrant.ts               ← Qdrant client
│   │   └── migrations/             ← SQL migration files
│   │
│   └── routes/
│       ├── chat.routes.ts          ← POST /chat, SSE stream
│       ├── artifact.routes.ts      ← GET/POST /artifacts
│       ├── execute.routes.ts       ← POST /execute
│       ├── upload.routes.ts        ← POST /upload
│       └── user.routes.ts          ← Auth, plan, profile
│
├── Dockerfile
├── docker-compose.yml              ← Local dev (mirrors EasyPanel)
├── .env.example
├── tsconfig.json
└── package.json
```

---

## 16. Database Schema Overview

### Postgres Tables

```sql
-- Users
users (id, email, password_hash, plan, created_at, last_seen)

-- Sessions / Conversations  
sessions (id, user_id, title, agent_type, created_at, updated_at)
messages (id, session_id, role, content, tokens_used, created_at)
message_cache_summaries (session_id, summary_text, covers_up_to_message_id, created_at)

-- Artifacts
artifacts (
  id, session_id, user_id, title, type,
  parent_id, version_number, content_hash,
  file_path, content_text,
  created_at, created_by_agent, is_latest
)

-- Cost Tracking
api_calls (
  id, user_id, session_id, agent_type, provider, model_used,
  input_tokens_fresh, input_tokens_cached, output_tokens, cache_write_tokens,
  cost_usd, cache_hit_layer, response_ms, created_at
)

-- Plans & Billing
plans (id, name, price_usd, capabilities_json)
subscriptions (id, user_id, plan_id, status, current_period_end)

-- Rate Limiting Audit Log (Redis is source of truth, Postgres for analysis)
rate_limit_events (id, user_id, event_type, created_at)
```

---

## 17. Open Source Stack

| Need | Chosen Tool | Notes |
|---|---|---|
| Agent framework | Custom (TypeScript classes) | LangGraph if complexity grows |
| LLM routing / unified API | **LiteLLM** | One interface for all providers |
| Web search | **Tavily** | Built for AI agents, citation-aware |
| Vector memory | **Qdrant** | Production-ready, self-hostable |
| File parsing | **Unstructured.io** | PDF, DOCX, XLSX, HTML, etc. |
| Code execution | **Judge0** | 60+ languages, open source |
| Rate limiting | **Redis** + sliding window | Standard, battle-tested |
| Auth | **Lucia Auth** or **JWT** | Lightweight, TypeScript-native |
| Database | **Postgres 16** | via EasyPanel |
| Cache | **Redis 7** | via EasyPanel |
| Infra management | **EasyPanel** | Docker orchestration UI |
| File storage | **Local volume → Cloudflare R2** | S3-compatible, generous free tier |
| Embeddings (cheap) | **text-embedding-3-small** (OpenAI) | For semantic cache + memory |
| HTML preview | Sandboxed `<iframe>` | Frontend-only, zero backend risk |
| Markdown render | **marked.js** or **remark** | Client-side |
| Code highlight | **Shiki** | Server-side safe syntax highlighting |

---

## 18. Phased Roadmap

### Phase 1 — Core (Weeks 1–6)
- [ ] Express server with auth, plan system, rate limiting
- [ ] Auto agent (chat + writer only)
- [ ] Anthropic + OpenAI provider integration with streaming
- [ ] Basic session memory (Redis)
- [ ] Artifact creation and download (code + markdown)
- [ ] EasyPanel deployment with Postgres + Redis
- [ ] Cost tracking table

### Phase 2 — Search & Agents (Weeks 7–10)
- [ ] Tavily web search integration
- [ ] Research agent with citations
- [ ] Query rewriting and grounding constraint
- [ ] Semantic response cache (Qdrant)
- [ ] Provider prompt caching + keepalive
- [ ] Task-based agent selection UI
- [ ] HTML preview (sandboxed iframe)

### Phase 3 — Files & Execution (Weeks 11–16)
- [ ] File upload + parsing (PDF, DOCX, XLSX)
- [ ] File generation (Excel, CSV, Word, TXT)
- [ ] Judge0 code execution integration
- [ ] Artifact versioning + diff view
- [ ] Long-term vector memory (Qdrant per user)
- [ ] Rolling summarisation / context compaction
- [ ] Code agent + debugger agent

### Phase 4 — Power User & Polish (Weeks 17–22)
- [ ] Model picker UI (Enterprise)
- [ ] Analyst agent (CSV → chart pipeline)
- [ ] Architecture builder agent
- [ ] UI generator agent (HTML/CSS output)
- [ ] Cloudflare R2 file storage migration
- [ ] Internal cost dashboard
- [ ] Cache hit rate monitoring

### Phase 5 — Scale (Post-funding)
- [ ] Separate Judge0 to second VPS
- [ ] GPU server for local model inference (Llama / Mistral)
- [ ] Managed Postgres (Supabase or RDS)
- [ ] Horizontal API scaling (multiple Express containers)
- [ ] Custom agent builder (user-defined agents)
- [ ] Team / organisation features

---

## Key Design Decisions Summary

| Decision | Choice | Reason |
|---|---|---|
| Infra | Single EasyPanel VPS | Cheapest viable start, no funding yet |
| Code execution | Judge0 (self-hosted) | Open source, no per-execution SaaS cost |
| Agent design | Stateless workers, state in Redis/Postgres | Horizontally scalable, no data loss on restart |
| Prompt structure | Static prefix + fresh suffix | Maximises cache hit rate at provider level |
| Rate limiting | Cost-based + request-based | Prevents expensive users gaming request counts |
| Memory | Three-tier (in-context / Redis / Qdrant) | Right tool for right lifespan |
| Caching | Three-layer (semantic / prompt / model routing) | Layered savings, 60–80% cost reduction possible |
| File storage | Local volume → R2 | Zero migration cost now, trivial to scale later |
| Agent isolation | Subagent pattern for heavy tasks | Keeps main context clean and cheap |
| HTML preview | Sandboxed iframe, client-side only | Zero server risk, zero infra cost |

---

*This document should be treated as a living spec. Update it as decisions are revised during development.*
