# GRIZON AI — Complete Architecture & Codebase Map

> **Generated**: 2026-07-09
> **Scope**: Full stack — Frontend (Next.js 16), Node.js API Gateway (Express), Python Brain (FastAPI), Infrastructure (Docker/Postgres/Redis/Qdrant)

---

## 1. SYSTEM-LEVEL FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              GRIZON AI — FULL SYSTEM FLOW                           │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────────┐
                              │      USER (Web)       │
                              └──────────┬───────────┘
                                         │ HTTPS
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND — Next.js 16 (Port 3000)                                                │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │  Context Providers: Theme → Auth → Conversation → Model → Credit → Canvas    │  │
│  │                                                                               │  │
│  │  Routes:                                                                      │  │
│  │  / ─── /chat ─── /brain ─── /settings ─── /pricing ─── /checkout             │  │
│  │         │           │           │                                              │  │
│  │         ▼           ▼           ▼                                              │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                                     │  │
│  │  │ Messages  │ │ BrainMsg │ │ Settings │                                     │  │
│  │  │ + Composer│ │ + Agent  │ │ Panels   │                                     │  │
│  │  └────┬─────┘ └────┬─────┘ └──────────┘                                     │  │
│  │       │             │                                                          │  │
│  │       ▼             ▼                                                          │  │
│  │  ┌──────────┐ ┌──────────┐                                                    │  │
│  │  │ Canvas   │ │Execution│  (Code/Doc/Preview/Sandbox/Terminal)               │  │
│  │  │ Panel    │ │ Store   │  (Zustand: phases, agents, todos, files)           │  │
│  │  └──────────┘ └──────────┘                                                    │  │
│  │                                                                               │  │
│  │  API Clients:                                                                 │  │
│  │  • lib/chat-sse.ts ──── SSE via @microsoft/fetch-event-source                │  │
│  │  • lib/auth-api.ts ──── REST + JWT (access in memory, refresh in localStorage)│  │
│  │  • lib/chat-rest-api.ts ─ POST enqueue → GET stream/:jobId                    │  │
│  │  • brain/lib/brainApiBase.ts ── Brain SSE via ReadableStream                  │  │
│  │  • brain/lib/brainWebContainer.ts ── MCP sandbox file ops                     │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  Next.js API Routes (Proxy):                                                         │
│  • /api/brain/* ──→ proxied to Brain API (http://127.0.0.1:8001)                   │
└────────────────────────────────┬────────────────────────┬────────────────────────────┘
                                 │                        │
              ┌──────────────────┘                        └──────────────────┐
              │ REST + SSE                                                     │ SSE + REST
              ▼                                                                ▼
┌─────────────────────────────────────────┐  ┌─────────────────────────────────────────┐
│  NODE.JS API GATEWAY — Express (Port 4000/3000)                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │  Middleware Pipeline (in order):                                              │  │
│  │  requestId → CORS → JWT Auth → Admin → Logger → Helmet → Body Parser        │  │
│  │  → Plan Attach → Feature Flags → Rate Limit → Credit Budget → Sanitise     │  │
│  │                                                                               │  │
│  │  ┌─── User Routes ──────────────────────────────────────────────────────┐    │  │
│  │  │ POST /auth/register | /login | /google | /refresh | /logout          │    │  │
│  │  │ POST /chat/ → enqueue to BullMQ → Worker picks up → SSE stream       │    │  │
│  │  │ GET  /chat/stream/:jobId → SSE event stream                          │    │  │
│  │  │ CRUD /conversations | /plans | /wallet | /usage | /files | /artifacts│    │  │
│  │  │ GET  /catalogue → agent/model catalogue                              │    │  │
│  │  │ POST /payments/topup | /subscription/initiate                        │    │  │
│  │  └──────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                               │  │
│  │  ┌─── Admin Routes ─────────────────────────────────────────────────────┐    │  │
│  │  │ CRUD users, plans, wallets, rate limits, analytics, queues,          │    │  │
│  │  │ system health, conversations, catalogue, benchmarks, payments        │    │  │
│  │  └──────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                               │  │
│  │  ┌─── Router (Smart Routing) ───────────────────────────────────────────┐    │  │
│  │  │ classifier → intent (chat/search/document/code/reasoning)           │    │  │
│  │  │           → agentDispatcher → agent slug                            │    │  │
│  │  │           → modelSelector → primary + fallback chain                 │    │  │
│  │  │           → searchPlanner → pre-search queries                      │    │  │
│  │  │           → tools → tool set per agent                              │    │  │
│  │  └──────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                               │  │
│  │  ┌─── Chat Worker (BullMQ) ────────────────────────────────────────────┐    │  │
│  │  │ semantic cache (Qdrant 0.92) → router → prompt assembler            │    │  │
│  │  │ → LLM streaming (multi-round tool loop, max 10 rounds)              │    │  │
│  │  │ → tool execution (parallel batches)                                  │    │  │
│  │  │ → wallet deduction → usage tracking → SSE publish                   │    │  │
│  │  └──────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                               │  │
│  │  ┌─── Agents ───────────────────────────────────────────────────────────┐    │  │
│  │  │ chat, writer, research, deep_research, ui, code, document,          │    │  │
│  │  │ analyst, architect, debugger                                         │    │  │
│  │  └──────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                               │  │
│  │  ┌─── Tools ────────────────────────────────────────────────────────────┐    │  │
│  │  │ web_search, web_fetch, code_execution (Judge0), file_read,          │    │  │
│  │  │ file_gen (DOCX/PDF/Excel/MD), html_generate, chart_generate,        │    │  │
│  │  │ image_analyse, stock_data, weather                                   │    │  │
│  │  └──────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                               │  │
│  │  ┌─── Memory ───────────────────────────────────────────────────────────┐    │  │
│  │  │ session.memory.ts (Redis cache, TTL 24h)                            │    │  │
│  │  │ vector.memory.ts (Qdrant + Postgres memory_facts)                   │    │  │
│  │  │ semantic.cache.ts (Qdrant, 0.92 threshold)                          │    │  │
│  │  └──────────────────────────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  LLM Providers: OpenAI | Anthropic | Google Gemini | DeepSeek | xAI                │
│  Background Jobs: wallet janitor, usage cleanup/rollup, file janitor,              │
│                   subscription renewal, redemption                                 │
└───────────┬──────────┬──────────┬──────────┬──────────┬────────────────────────────┘
            │          │          │          │          │
            ▼          ▼          ▼          ▼          ▼
     ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐
     │ Postgres │ │ Redis  │ │ Qdrant │ │  S3    │ │  Judge0 API  │
     │ pgvector │ │        │ │        │ │        │ │ (code exec)  │
     │ :5432    │ │ :6379  │ │ :6333  │ │        │ │              │
     └──────────┘ └────────┘ └────────┘ └────────┘ └──────────────┘

            │
            │ HTTP :8001
            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  PYTHON BRAIN — FastAPI (Port 8001/8002)                                           │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │  Entry: main.py → FastAPI app                                                 │  │
│  │                                                                               │  │
│  │  ┌─── LangGraph Workflow ─────────────────────────────────────────────┐      │  │
│  │  │                                                                    │      │  │
│  │  │  [ManagerAgent] ──needs_clarification──→ [QuestionsAgent] → END    │      │  │
│  │  │        │                                                              │      │  │
│  │  │        ├──plan_approved=false──→ [PlannerAgent] → END              │      │  │
│  │  │        │                                                              │      │  │
│  │  │        └──plan_approved=true───→ [TodoAgent]                       │      │  │
│  │  │                                      │                              │      │  │
│  │  │                                      ▼                              │      │  │
│  │  │                              [init_sandbox] → END                  │      │  │
│  │  │                                                                    │      │  │
│  │  │  Then manual loop:                                                 │      │  │
│  │  │  [BuilderAgent] → for each task:                                    │      │  │
│  │  │    ├── FrontendAgent (React/Vite components)                       │      │  │
│  │  │    ├── DatabaseAgent (Supabase SQL)                                │      │  │
│  │  │    └── SandboxMCPService (deploy to remote MicroVM)               │      │  │
│  │  │  [RunnerAgent] → start dev servers                                 │      │  │
│  │  │  [ReporterAgent] → final report                                    │      │  │
│  │  └────────────────────────────────────────────────────────────────────┘      │  │
│  │                                                                               │  │
│  │  ┌─── Memory System (12 modules) ────────────────────────────────────┐      │  │
│  │  │  MemoryGateway → assembles context for each agent                  │      │  │
│  │  │                                                                    │      │  │
│  │  │  ShortTermMemory     (Redis, TTL 3h)   — recent turns            │      │  │
│  │  │  SessionMemory       (Redis)           — workflow state           │      │  │
│  │  │  ProjectMemory       (PostgreSQL)      — project CRUD             │      │  │
│  │  │  DecisionMemory      (PostgreSQL)      — approved tech decisions  │      │  │
│  │  │  ExecutionMemory     (PostgreSQL)      — task execution logs      │      │  │
│  │  │  ArtifactMemory      (PostgreSQL)      — generated files          │      │  │
│  │  │  ReviewMemory        (PostgreSQL)      — quality reviews          │      │  │
│  │  │  ErrorMemory         (PostgreSQL)      — known error patterns     │      │  │
│  │  │  SkillMemory         (PostgreSQL)      — skill performance        │      │  │
│  │  │  ArchitectureMemory  (PostgreSQL)      — proven patterns          │      │  │
│  │  │  ChangeMemory        (PostgreSQL)      — change requests          │      │  │
│  │  │  LongTermMemory      (Qdrant)         — semantic search          │      │  │
│  │  └────────────────────────────────────────────────────────────────────┘      │  │
│  │                                                                               │  │
│  │  ┌─── Connectors ────────────────────────────────────────────────────┐      │  │
│  │  │  Supabase: OAuth PKCE → credential vault → auto-schema creation   │      │  │
│  │  │  GitHub:   OAuth App → repo mgmt → file sync → PR creation        │      │  │
│  │  │  MCP:      Remote sandbox execution via Model Context Protocol     │      │  │
│  │  └────────────────────────────────────────────────────────────────────┘      │  │
│  │                                                                               │  │
│  │  ┌─── Services ──────────────────────────────────────────────────────┐      │  │
│  │  │  ProviderRouter: OpenAI→GPT-4o, Gemini→ChatGoogleGenerativeAI     │      │  │
│  │  │  WorkspaceManager: file ops on disk + workspace_ops normalization │      │  │
│  │  │  SandboxMCPService: tar.gz deploy → remote VM → tunnel URL       │      │  │
│  │  │  TemplateService: Express+Supabase+React/Next bootstrapping       │      │  │
│  │  │  CompanySupabaseProxy: multi-tenant JWT proxy, rate limiting      │      │  │
│  │  │  BuildResume: resume interrupted builds                           │      │  │
│  │  └────────────────────────────────────────────────────────────────────┘      │  │
│  │                                                                               │  │
│  │  Templates: express-template/ | supabase-template/ | react-template/        │  │
│  │              next-template/                                                  │  │
│  │                                                                               │  │
│  │  Skills: frontend/ | database/ | backend/ | shadcn/ | supabase/            │  │
│  │          frontend-design/ | backend-development/ | nodejs-backend-patterns/ │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘

            │
            │ StreamableHTTP MCP
            ▼
┌─────────────────────────────────────────────┐
│  REMOTE MCP SANDBOX (GCP MicroVMs)          │
│  • Fresh VM per workspace                   │
│  • Code execution + file storage            │
│  • Tunnel URL for live preview              │
│  • TTL: 30 minutes                          │
└─────────────────────────────────────────────┘
```

---

## 2. REQUEST LIFECYCLE — END TO END

```
  USER types prompt in chat
       │
       ▼
  ┌─ FRONTEND ──────────────────────────────────────────────────────────────────┐
  │  Chat page → POST /api/v1/chat/ (enqueue)                                  │
  │  Returns jobId + streamUrl                                                  │
  │  Connects to SSE: GET /api/v1/chat/stream/:jobId                           │
  └────────────────────────────────────┬────────────────────────────────────────┘
                                       │
  ┌─ NODE.JS API GATEWAY ──────────────┼────────────────────────────────────────┐
  │  POST /api/v1/chat/                │                                        │
  │    ├─ auth.middleware (JWT verify)  │                                        │
  │    ├─ rateLimit.middleware          │                                        │
  │    ├─ creditBudget.middleware       │                                        │
  │    └─ chatJob.service → BullMQ     │                                        │
  │         enqueue({ conversationId,  │                                        │
  │           userId, message })       │                                        │
  │                                    │                                        │
  │  ┌── Chat Worker picks up job ────┤                                        │
  │  │  1. Semantic cache (Qdrant)     │                                        │
  │  │  2. Classifier → intent+complexity                                      │
  │  │  3. Agent dispatcher → agent    │                                        │
  │  │  4. Model selector → model      │                                        │
  │  │  5. Search planner (if needed)  │                                        │
  │  │  6. Prompt assembler            │                                        │
  │  │  7. LLM streaming (multi-round) │                                        │
  │  │     ├─ tool calls (parallel)    │                                        │
  │  │     ├─ wallet hold              │                                        │
  │  │     └─ SSE events to Redis      │                                        │
  │  │  8. Wallet confirm              │                                        │
  │  │  9. Usage tracking              │                                        │
  │  └─────────────────────────────────┘                                        │
  └────────────────────────────────────┬────────────────────────────────────────┘
                                       │ SSE events
                                       ▼
  ┌─ FRONTEND ──────────────────────────────────────────────────────────────────┐
  │  useStreamParser hook:                                                      │
  │  ├─ <grizon-artifact> → Canvas panel (code/doc/project)                    │
  │  ├─ <grizon-code>     → Code canvas (Monaco editor)                        │
  │  ├─ <grizon-document> → Document canvas                                    │
  │  ├─ <grizon-project>  → Project preview (Sandpack)                         │
  │  └─ plain text        → Message bubble                                      │
  └────────────────────────────────────────────────────────────────────────────┘


  USER types prompt in Brain mode
       │
       ▼
  ┌─ FRONTEND (Brain) ─────────────────────────────────────────────────────────┐
  │  Brain page → POST brain/chat/stream (SSE)                                 │
  │  BrainWebContainerProvider manages sandbox state                           │
  │  execution-store tracks phases: IDLE→ANALYZING→PLANNING→QUESTIONING        │
  │  →EXECUTING→SYNCING→COMPLETED                                              │
  └────────────────────────────────────┬────────────────────────────────────────┘
                                       │
  ┌─ PYTHON BRAIN ─────────────────────┼────────────────────────────────────────┐
  │  LangGraph StateGraph:             │                                        │
  │  1. ManagerAgent → analyze intent  │                                        │
  │  2. QuestionsAgent → clarify       │                                        │
  │  3. PlannerAgent → roadmap + tech  │                                        │
  │  4. TodoAgent → atomic tasks       │                                        │
  │  5. BuilderAgent → execute tasks:  │                                        │
  │     ├─ FrontendAgent → React code  │                                        │
  │     ├─ DatabaseAgent → SQL schemas │                                        │
  │     └─ write to workspace → deploy │                                        │
  │  6. RunnerAgent → start servers    │                                        │
  │  7. ReporterAgent → summary        │                                        │
  │                                    │                                        │
  │  MemoryGateway assembles 12-layer  │                                        │
  │  context for every agent call      │                                        │
  └────────────────────────────────────┬────────────────────────────────────────┘
                                       │ MCP
                                       ▼
  ┌─ REMOTE SANDBOX ───────────────────────────────────────────────────────────┐
  │  workspace.tar.gz → deploy → run commands → tunnel URL                     │
  │  WebSocket sync for real-time file updates                                 │
  └────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. DATABASE SCHEMA (SHARED POSTGRESQL)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (pgvector:pg16) — Port 5432                                │
│                                                                         │
│  ┌─ Database: grizon_db (Node.js Gateway) ─────────────────────────┐   │
│  │                                                                   │   │
│  │  users                 — id, email, password_hash, role, status  │   │
│  │  refresh_tokens        — userId, token, expiresAt, revoked       │   │
│  │  token_blacklist       — jti, expiresAt                          │   │
│  │  auth_audit            — userId, event, ip, userAgent            │   │
│  │  password_reset_tokens — userId, token, expiresAt                │   │
│  │  email_verification_tokens — userId, token, expiresAt            │   │
│  │  oauth_accounts        — userId, provider, providerUserId        │   │
│  │                                                                   │   │
│  │  plans                 — id, name, credits, features, limits     │   │
│  │  plans_feature_limits  — planId, featureKey, limitValue          │   │
│  │  subscriptions         — userId, planId, status, expiresAt       │   │
│  │  subscription_history  — userId, event, planId, timestamp        │   │
│  │                                                                   │   │
│  │  wallets               — userId, balance, totalEarned, totalSpent│   │
│  │  wallet_transactions   — walletId, amount, balanceAfter, type   │   │
│  │                                                                   │   │
│  │  conversations         — id, userId, title, status               │   │
│  │  messages              — id, conversationId, role, content,      │   │
│  │                         todoList(JSON), sandboxJob(JSON)         │   │
│  │  files                 — id, userId, filename, mime, storagePath │   │
│  │  artifacts             — id, conversationId, type, content       │   │
│  │                                                                   │   │
│  │  agent_catalogue       — slug, name, description, systemPrompt,  │   │
│  │                         model, tools, hooks, config              │   │
│  │  ai_models_cached_rate — model, inputRate, outputRate, cachedAt  │   │
│  │                                                                   │   │
│  │  chat_jobs             — id, userId, conversationId, status      │   │
│  │  usage_records         — userId, agent, model, tokens, credits   │   │
│  │  usage_daily_user      — userId, date, totalCredits              │   │
│  │  usage_daily_plan      — planId, date, totalUsers, totalCredits  │   │
│  │  usage_hourly_system   — hour, totalRequests, totalCredits       │   │
│  │                                                                   │   │
│  │  rate_limit_events     — identifier, window, count               │   │
│  │  api_calls             — requestId, userId, method, path, status │   │
│  │  memory_facts          — userId, fact, embedding(1536d)          │   │
│  │  semantic_cache_hits   — queryHash, similarity, cacheKey         │   │
│  │  file_chunks           — fileId, chunkIndex, content, embedding  │   │
│  │  subagent_runs         — id, parentJobId, agent, status          │   │
│  │  tool_invocations      — jobId, tool, input, output, duration    │   │
│  │  message_cost_items    — messageId, item, tokens, credits        │   │
│  │  message_journey       — messageId, step, timestamp              │   │
│  │  benchmark_runs        — id, agent, model, score, duration       │   │
│  │  payment_orders        — id, userId, amount, provider, status    │   │
│  │  public_agent_plans    — agentSlug, planId, limits               │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─ Database: app (Python Brain) ──────────────────────────────────┐   │
│  │                                                                   │   │
│  │  brain_projects           — id, name, frontend, backend, db,    │   │
│  │                             css_framework, auth_method, status   │   │
│  │  brain_project_decisions  — projectId, category, key, value     │   │
│  │  brain_execution_logs     — projectId, todoId, agent, status,   │   │
│  │                             outputFiles, durationMs, tokenCount │   │
│  │  brain_artifacts          — projectId, name, type, filePath,    │   │
│  │                             version, contentHash, language       │   │
│  │  brain_reviews            — projectId, qualityScore, issues     │   │
│  │  brain_known_errors       — pattern, type, framework, fixCode   │   │
│  │  brain_skill_performance  — skillName, uses, successRate        │   │
│  │  brain_architecture_patterns — patternName, stack, successRate  │   │
│  │  brain_change_requests    — projectId, text, affectedFiles      │   │
│  │                                                                   │   │
│  │  users, conversations, messages (duplicated schema)             │   │
│  │  brain_projects (FK to users, conversations)                    │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Qdrant (Port 6333) — Vector DB                                         │
│  ├─ semantic_cache (1536d, threshold 0.92)                              │
│  ├─ user_memory (1536d, per-user facts)                                 │
│  └─ brain_long_term (1536d, project embeddings)                         │
│                                                                         │
│  Redis (Port 6379)                                                      │
│  ├─ BullMQ queues: chat, file, notification, benchmark                  │
│  ├─ Session memory (conversation transcripts, TTL 24h)                  │
│  ├─ Brain short-term memory (TTL 3h)                                    │
│  ├─ Brain session state (workflow state)                                │
│  ├─ Rate limit sliding windows                                          │
│  ├─ SSE pub/sub for streaming                                           │
│  └─ OAuth state tokens                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. COMPLETE FILE INVENTORY

### 4.1. FRONTEND — `Grizon-AI-Frontend-v2-api-2/`

```
Grizon-AI-Frontend-v2-api-2/
│
├── package.json                          # Next.js 16, React 19, deps
├── next.config.ts                        # Next.js config + API rewrites
├── tsconfig.json                         # TypeScript config
├── tailwind.config.ts                    # Tailwind CSS v4
├── postcss.config.mjs                    # PostCSS
├── eslint.config.mjs                     # ESLint
├── .env / .env.example                   # Environment variables
├── Dockerfile                            # Container build
├── .gitignore
├── walkthrough.md                        # Project walkthrough
│
├── app/
│   ├── layout.tsx                        # Root layout (6 context providers)
│   ├── page.tsx                          # Landing page
│   ├── globals.css                       # Global styles (42 CSS variables)
│   ├── GlobalMetadata.ts                 # Metadata config
│   ├── favicon.ico / robots.ts
│   │
│   ├── (main)/
│   │   ├── layout.tsx                    # MainAppShell wrapper
│   │   ├── chat/
│   │   │   ├── layout.tsx                # Chat layout (Messages + Canvas + Thread)
│   │   │   ├── page.tsx                  # Chat page
│   │   │   └── [id]/page.tsx             # Conversation by ID
│   │   ├── brain/
│   │   │   ├── layout.tsx                # Brain layout (BrainMessages + Sandbox)
│   │   │   ├── page.tsx                  # Brain page
│   │   │   └── [id]/page.tsx             # Brain conversation by ID
│   │   ├── settings/
│   │   │   ├── layout.tsx                # Settings layout
│   │   │   ├── page.tsx                  # Settings redirect
│   │   │   └── [section]/page.tsx        # Dynamic settings section
│   │   └── integrations/page.tsx         # OAuth callback redirect
│   │
│   ├── checkout/page.tsx                 # Checkout
│   ├── pricing/page.tsx                  # Pricing
│   ├── subscription/page.tsx             # Subscription
│   ├── payment/callback/page.tsx         # Payment callback
│   ├── success/page.tsx                  # Success page
│   ├── forgot-password/page.tsx          # Forgot password
│   ├── reset-password/page.tsx           # Reset password
│   ├── verify-email-request/page.tsx     # Verify email request
│   ├── verify/page.tsx                   # Email verify confirm
│   ├── shared/[id]/page.tsx             # Shared conversation view
│   └── debug/memory/page.tsx            # Debug/memory view
│
├── brain/
│   ├── BrainLayout.tsx                   # Standalone brain shell
│   ├── BrainView.tsx                     # Brain command center UI
│   │
│   ├── components/
│   │   ├── BrainAgentMessage.tsx         # Agent message bubble
│   │   ├── BrainAgentStatus.tsx          # Agent status indicator
│   │   ├── BrainArtifactView.tsx         # Artifact viewer
│   │   ├── BrainBuildActivityFeed.tsx    # Build activity feed
│   │   ├── BrainBuildWorkspace.tsx       # Workspace viewer
│   │   ├── BrainClarificationCard.tsx    # Clarification Q&A card
│   │   ├── BrainDecisionView.tsx         # Decision viewer
│   │   ├── BrainEditorCanvas.tsx         # Editor canvas
│   │   ├── BrainExecutionView.tsx        # Execution view
│   │   ├── BrainFrameworkSelector.tsx    # Framework picker
│   │   ├── BrainLiveTodos.tsx            # Live todo list
│   │   ├── BrainMessages.tsx             # Brain messages area
│   │   ├── BrainPlanCanvas.tsx           # Plan canvas
│   │   ├── BrainPublishModal.tsx         # Publish modal
│   │   ├── BrainSandboxCanvas.tsx        # Sandbox canvas
│   │   ├── BrainSupabasePrompt.tsx       # Supabase connection prompt
│   │   ├── BrainTodoCanvas.tsx           # Todo canvas
│   │   └── BrainUserMessage.tsx          # User message bubble
│   │
│   ├── constants/frameworks.ts           # Supported frameworks config
│   │
│   ├── context/
│   │   └── BrainWebContainerContext.tsx   # WebContainer workspace provider
│   │
│   ├── hooks/
│   │   └── useBrainWorkspaceOps.ts        # Workspace operations hook
│   │
│   ├── lib/
│   │   ├── agent-engine/engine.ts         # AgentEngine class (phase orchestrator)
│   │   ├── agents/dynamic-prompts.ts      # Dynamic prompt generation
│   │   ├── streaming/
│   │   │   ├── useStream.ts               # Stream hook
│   │   │   └── stream-simulator.ts        # Stream simulator
│   │   ├── brainApiBase.ts                # Brain API URL builder + fetch
│   │   ├── brainSession.ts                # Session state management
│   │   ├── brainWebContainer.ts           # Workspace ops (file CRUD, MCP)
│   │   ├── buildActivity.ts               # Build activity tracking
│   │   ├── buildSession.ts                # Build session management
│   │   ├── commandPolicy.ts               # WebContainer command policy
│   │   ├── templateBootstrap.ts           # Project template bootstrapping
│   │   ├── artifactMemory.ts              # Artifact persistence
│   │   ├── decisionMemory.ts              # Decision tracking
│   │   ├── executionMemory.ts             # Execution state persistence
│   │   ├── fileTreeUtils.ts               # File tree parsing
│   │   ├── projectMemory.ts               # Project-level memory
│   │   └── resumeBrainBuild.ts            # Resume interrupted builds
│   │
│   ├── store/
│   │   └── execution-store.ts             # Zustand store (phases, agents, todos)
│   │
│   └── templates/                         # (TBD)
│
├── components/
│   ├── auth/
│   │   ├── AuthModal.tsx                  # Multi-screen auth modal
│   │   └── VerifyEmailGate.tsx            # Email verification gate
│   │
│   ├── chat/
│   │   ├── AgentBubbles.tsx               # Agent-specific bubbles
│   │   ├── AgentMessage.tsx               # Agent message
│   │   ├── CanvasPanel.tsx                # Right-side canvas orchestrator
│   │   ├── ChatScreen.tsx                 # Full chat screen
│   │   ├── IconRail.tsx                   # Left icon rail
│   │   ├── MarkdownRenderer.tsx           # Rich markdown rendering
│   │   ├── MermaidRenderer.tsx            # Mermaid diagrams
│   │   ├── MessageArtifactRows.tsx        # Artifact attachments
│   │   ├── MessageSkeleton.tsx            # Loading skeleton
│   │   ├── MessagesStaticShell.tsx        # Messages + input area
│   │   ├── RateLimitComposerIndicator.tsx # Rate limit warning
│   │   ├── SettingsView.tsx               # Settings panel
│   │   ├── SiriListeningVisualizer.tsx    # Voice listening orb
│   │   ├── SiriSpeakingVisualizer.tsx     # Voice speaking orb
│   │   ├── SiriVisualizer.tsx             # Combined Siri voice UI
│   │   ├── TaskSelectionView.tsx          # Agent/task selection
│   │   ├── ThinkingIndicator.tsx          # Thinking animation
│   │   ├── ThreadPanel.tsx                # Conversation history sidebar
│   │   ├── UserMessage.tsx                # User message bubble
│   │   └── VoiceVisualizer.tsx            # Voice mode visualizer
│   │   │
│   │   └── canvas/
│   │       ├── CodeCanvas.tsx             # Monaco code editor
│   │       ├── DocumentCanvas.tsx         # Document viewer
│   │       ├── DocumentToolbar.tsx        # Document toolbar
│   │       ├── MarkdownCanvas.tsx         # Markdown preview
│   │       ├── ProjectPreview.tsx         # Full project preview
│   │       ├── SandpackPreviewer.tsx      # Sandpack live preview
│   │       ├── SplitPreview.tsx           # Split code + preview
│   │       ├── SquadActivity.tsx          # Multi-agent activity
│   │       └── TerminalPanel.tsx          # xterm.js terminal
│   │
│   ├── checkout/
│   │   └── CheckoutForm.tsx               # Payment form
│   │
│   ├── landing/
│   │   ├── Footer.tsx                     # Footer
│   │   ├── Header.tsx                     # Header
│   │   ├── Hero.tsx                       # Hero section
│   │   └── Suggestions.tsx                # Suggested prompts
│   │
│   ├── layout/
│   │   └── MainAppShell.tsx               # Auth gate + rail + threads
│   │
│   ├── pricing/
│   │   └── PricingCards.tsx               # Pricing cards
│   │
│   └── settings/
│       ├── SettingsBillingPanel.tsx        # Billing
│       ├── SettingsConnectionsPanel.tsx    # OAuth connections
│       ├── SettingsSessionsPanel.tsx       # Active sessions
│       ├── SettingsUsagePanel.tsx          # Usage stats
│       ├── SettingsWalletPanel.tsx         # Wallet/credits
│       └── ThemeStudio/
│           ├── ColorInput.tsx              # Color picker
│           ├── index.tsx                   # ThemeStudio main
│           ├── ThemeEditor.tsx             # Theme editor
│           ├── ThemeLibrary.tsx            # Theme library
│           ├── ThemeMockPreview.tsx        # Mock preview
│           └── utils.ts                   # Theme utilities
│
├── context/
│   ├── AuthContext.tsx                    # Auth state + modal control
│   ├── CanvasContext.tsx                  # Canvas panel state
│   ├── ConversationContext.tsx            # Conversation CRUD + messages
│   ├── CreditContext.tsx                  # Wallet balance
│   ├── ModelContext.tsx                   # AI model catalogue
│   ├── ThemeContext.tsx                   # Theme switching
│   └── ThreadListContext.tsx              # Thread sidebar state
│
├── hooks/
│   ├── useSpeechRecognition.ts            # Browser speech recognition
│   ├── useSpeechSynthesis.ts              # Browser TTS
│   └── useStreamParser.ts                 # XML tag → Canvas routing
│
├── lib/
│   ├── api.ts                             # Brain API endpoints
│   ├── auth-api.ts                        # Auth REST endpoints
│   ├── auth-constants.ts                  # Auth constants
│   ├── auth-mappers.ts                    # Auth data mappers
│   ├── auth-session.ts                    # Session management
│   ├── auth-utils.ts                      # Auth utilities
│   ├── canvas-selection.ts                # Canvas selection logic
│   ├── chat-contracts.ts                  # Chat type contracts
│   ├── chat-rest-api.ts                   # Chat REST endpoints
│   ├── chat-sse.ts                        # SSE streaming client
│   ├── custom-themes.ts                   # Custom theme support
│   ├── file-kinds.ts                      # File type classification
│   ├── file-preview.ts                    # Client-side file preview
│   ├── file-upload-contract.ts            # Upload MIME types
│   ├── file-visual.ts                     # File → icon/color mapping
│   ├── fonts.ts                           # Font definitions
│   ├── grizon-api-client.ts               # API client wrapper
│   ├── projectUtils.ts                    # Project utilities
│   ├── rate-limit-ui.ts                   # Rate limit UI display
│   ├── settings-sections.ts               # Settings section definitions
│   ├── themes.ts                          # Built-in themes (4)
│   └── types.ts                           # Shared TypeScript types
│
├── types/
│   ├── settings-api.ts                    # Settings API types
│   └── tiptap-markdown-augment.d.ts       # TipTap type augmentation
│
├── Docs/
│   ├── THEMING.md                         # Theming documentation
│   ├── index6.html                        # HTML reference
│   └── grizon_icon.png                    # Icon
│
└── public/                                # Static assets
```

**Frontend Totals**: ~115 source files, 7 context providers, 18 brain components, 9 canvas modes, 4 themes, 3 hooks

---

### 4.2. NODE.JS API GATEWAY — `grizon-ai-backend-2-main/src/`

```
grizon-ai-backend-2-main/
│
├── package.json                          # Express 4, TypeScript 5.8
├── tsconfig.json                         # ES2022, NodeNext
├── docker-compose.yml                    # 6 services
├── Dockerfile                            # Container build
├── init_brain_db.cjs / .py              # DB initialization scripts
├── setup_supabase_table.py              # Supabase table setup
├── migrate_memory_tables.py             # Memory table migration
│
├── src/
│   ├── index.ts                          # Entry: load agents, start server + workers
│   ├── app.ts                            # Express app assembly + middleware
│   │
│   ├── routes/
│   │   ├── index.ts                      # Root router
│   │   ├── user/
│   │   │   ├── auth.routes.ts            # /api/v1/auth/*
│   │   │   ├── chat.routes.ts            # /api/v1/chat/*
│   │   │   ├── conversation.routes.ts    # /api/v1/conversations/*
│   │   │   ├── plan.routes.ts            # /api/v1/plans
│   │   │   ├── wallet.routes.ts          # /api/v1/wallet
│   │   │   ├── usage.routes.ts           # /api/v1/usage
│   │   │   ├── file.routes.ts            # /api/v1/files
│   │   │   ├── artifact.routes.ts        # /api/v1/artifacts
│   │   │   ├── catalogue.routes.ts       # /api/v1/catalogue
│   │   │   ├── memory.routes.ts          # /api/v1/memory
│   │   │   └── payment.routes.ts         # /api/v1/payments
│   │   ├── admin/
│   │   │   ├── auth.routes.ts            # /api/v1/admin/auth
│   │   │   ├── plan.routes.ts            # /api/v1/admin/plans
│   │   │   ├── wallets.routes.ts         # /api/v1/admin/wallets
│   │   │   ├── ratelimits.routes.ts      # /api/v1/admin/ratelimits
│   │   │   ├── analytics.routes.ts       # /api/v1/admin/analytics
│   │   │   ├── queues.routes.ts          # /api/v1/admin/queues
│   │   │   ├── system.routes.ts          # /api/v1/admin/system
│   │   │   ├── conversations.routes.ts   # /api/v1/admin/conversations
│   │   │   ├── catalogue.routes.ts       # /api/v1/admin/catalogue
│   │   │   ├── benchmark.routes.ts       # /api/v1/admin/benchmarks
│   │   │   └── payment.admin.routes.ts   # /api/v1/admin/payments
│   │   └── webhook/
│   │       └── phonepe.routes.ts         # /payments/webhook
│   │
│   ├── gateway/                          # Middleware pipeline
│   │   ├── requestId.middleware.ts        # Unique request ID
│   │   ├── cors.middleware.ts             # CORS
│   │   ├── auth.middleware.ts             # JWT verification + session load
│   │   ├── admin.middleware.ts            # Admin role enforcement
│   │   ├── logger.middleware.ts           # Pino HTTP logging
│   │   ├── plan.middleware.ts             # Plan attachment
│   │   ├── featureFlag.middleware.ts      # Feature flag evaluation
│   │   ├── rateLimit.middleware.ts        # Sliding-window rate limit
│   │   ├── creditBudget.middleware.ts     # Credit wallet check
│   │   ├── sanitiser.middleware.ts        # HTML/prompt sanitisation
│   │   ├── errorHandler.middleware.ts     # Centralized error handling
│   │   ├── requireFeature.ts             # Require specific feature
│   │   └── requireFeatureWithLimit.ts    # Require feature + usage limit
│   │
│   ├── services/
│   │   ├── auth.service.ts               # Registration, login, password reset
│   │   ├── token.service.ts              # JWT sign/verify/blacklist
│   │   ├── session.service.ts            # Session CRUD
│   │   ├── password.service.ts           # Argon2 hashing
│   │   ├── oauth.service.ts              # Google OAuth
│   │   ├── audit.service.ts              # Auth audit trail
│   │   ├── conversation.service.ts       # Conversation CRUD
│   │   ├── message.service.ts            # Message creation
│   │   ├── chatJob.service.ts            # Chat job enqueue/cancel
│   │   ├── wallet.service.ts             # Credit hold/confirm/release
│   │   ├── creditCalculator.service.ts   # Token-to-credit calculation
│   │   ├── subscription.service.ts       # Subscription lifecycle
│   │   ├── plan.service.ts               # Plan definitions
│   │   ├── rateLimit.service.ts          # Rate limit checks
│   │   ├── featureLimit.service.ts       # Feature usage limits
│   │   ├── usageTracker.service.ts       # Usage recording
│   │   ├── analytics.service.ts          # Analytics aggregations
│   │   ├── storage.service.ts            # File upload (local/S3)
│   │   ├── file.service.ts               # File metadata CRUD
│   │   ├── artifact.service.ts           # Artifact versioning
│   │   ├── sseHub.service.ts             # SSE pub/sub
│   │   ├── summariser.service.ts         # Conversation summarisation
│   │   ├── titleGenerator.service.ts     # Auto-title generation
│   │   ├── sanitiser.service.ts          # HTML sanitisation
│   │   ├── jobStatus.service.ts          # Job status polling
│   │   ├── liveMetrics.service.ts        # In-memory metrics
│   │   ├── agentLoader.service.ts        # Load agents from DB
│   │   ├── catalogue.service.ts          # Public catalogue
│   │   ├── catalogueAdmin.service.ts     # Admin catalogue
│   │   ├── providerCatalogue.service.ts  # Fetch LLM models
│   │   ├── modelRates.service.ts         # Token pricing
│   │   ├── messageCostItems.service.ts   # Cost breakdown
│   │   ├── messageJourney.service.ts     # Journey tracing
│   │   ├── promptCapture.service.ts      # Prompt analytics
│   │   ├── routerCapture.service.ts      # Router analytics
│   │   ├── toolInsights.service.ts       # Tool analytics
│   │   └── payment/
│   │       ├── payment.service.ts        # Payment orchestration
│   │       ├── phonepe.adapter.ts        # PhonePe adapter
│   │       └── phonepe.client.ts         # PhonePe HTTP client
│   │
│   ├── agents/
│   │   ├── index.ts                      # Re-exports
│   │   ├── chat.agent.ts                 # Default chat agent
│   │   ├── writer.agent.ts               # Content writer
│   │   ├── research.agent.ts             # Web research
│   │   ├── deep_research.agent.ts        # Multi-step research
│   │   ├── ui.agent.ts                   # HTML/CSS/JS UI
│   │   ├── code.agent.ts                 # Code writing
│   │   ├── document.agent.ts             # Document processing
│   │   ├── analyst.agent.ts              # Data analysis
│   │   ├── architect.agent.ts            # Architecture advisor
│   │   ├── debugger.agent.ts             # Bug finding/fixing
│   │   ├── agentData.ts                  # Static metadata
│   │   ├── hooks.ts                      # Pre/post hooks
│   │   └── researchSources.ts            # Citation accumulation
│   │
│   ├── router/
│   │   ├── index.ts                      # runRouter() orchestrator
│   │   ├── classifier.ts                 # Intent classification
│   │   ├── agentDispatcher.ts            # Intent → agent slug
│   │   ├── modelSelector.ts              # Model + fallback selection
│   │   ├── providerHealth.ts             # Circuit breaker
│   │   ├── queryRewriter.ts              # Query rewriting
│   │   ├── searchPlanner.ts              # Pre-search planning
│   │   ├── catalogue.ts                  # Catalogue cache
│   │   └── tools.ts                      # Tool resolution per agent
│   │
│   ├── models/
│   │   ├── provider.ts                   # Provider factory
│   │   └── providers/
│   │       ├── anthropic.ts              # Anthropic Claude
│   │       ├── openai.ts                 # OpenAI GPT
│   │       ├── google.ts                 # Google Gemini
│   │       ├── deepseek.ts               # DeepSeek
│   │       ├── xai.ts                    # xAI Grok
│   │       └── types.ts                  # Provider interface
│   │
│   ├── tools/
│   │   ├── index.ts                      # Exports
│   │   ├── registry.ts                   # Tool registration
│   │   ├── executor.ts                   # Parallel batch executor
│   │   ├── webSearch.tool.ts             # Multi-engine search
│   │   ├── webFetch.tool.ts              # URL fetch + Readability
│   │   ├── codeExecution.tool.ts         # Judge0 sandbox exec
│   │   ├── fileRead.tool.ts              # Read attached files
│   │   ├── fileGen.tool.ts               # Generate DOCX/PDF/Excel/MD
│   │   ├── htmlGenerate.tool.ts          # Self-contained HTML
│   │   ├── chartGenerate.tool.ts         # Matplotlib charts
│   │   ├── imageAnalyse.tool.ts          # Image analysis
│   │   ├── stockData.tool.ts             # Yahoo Finance
│   │   └── weather.tool.ts               # OpenWeatherMap
│   │
│   ├── workers/
│   │   ├── chat.worker.ts                # Main chat processing
│   │   ├── file.worker.ts                # Document parsing
│   │   ├── notification.worker.ts        # Email/SMS
│   │   ├── benchmark.worker.ts           # LLM benchmarks
│   │   ├── background.scheduler.ts       # In-process cron jobs
│   │   ├── wallet.janitor.worker.ts      # Orphaned holds cleanup
│   │   ├── usage.cleanup.worker.ts       # Old usage purge
│   │   ├── usage.rollup.worker.ts        # Hourly/daily aggregation
│   │   ├── file.janitor.worker.ts        # Orphaned files cleanup
│   │   ├── subscription.redemption.worker.ts  # Mandate debit
│   │   └── subscription.renewal.worker.ts     # Auto-renewal
│   │
│   ├── infra/
│   │   ├── redis.ts                      # Redis client (1.5s timeout)
│   │   ├── qdrant.ts                     # Qdrant client + collection auto-create
│   │   ├── s3.client.ts                  # AWS S3 client
│   │   ├── mailer.ts                     # Email (Postmark/Resend/SES/Authkey)
│   │   ├── sms.ts                        # SMS via Authkey
│   │   └── authkey.client.ts             # Authkey API client
│   │
│   ├── db/
│   │   ├── pool.ts                       # PostgreSQL connection pool
│   │   ├── seed.ts                       # Seed agents, plans, features
│   │   ├── reset-agents.ts               # Reset agent definitions
│   │   └── migrations/
│   │       ├── run.ts                    # Migration runner
│   │       ├── create.ts                 # Migration creator
│   │       └── *.sql                     # 59 migration files (001-059)
│   │
│   ├── config/
│   │   ├── env.ts                        # Zod-validated env (180+ vars)
│   │   ├── auth.ts                       # Auth config
│   │   ├── authkey.ts                    # Authkey template IDs
│   │   ├── credits.ts                    # Credit constants
│   │   ├── features.ts                   # Feature flags
│   │   ├── logger.ts                     # Pino logger
│   │   ├── plan.ts                       # Plan/payment config
│   │   ├── queue.ts                      # BullMQ queue config
│   │   ├── rateLimit.ts                  # Rate limit windows
│   │   ├── sanitiser.ts                  # Sanitiser config
│   │   ├── storage.ts                    # Storage driver config
│   │   └── streamLimits.ts              # Stream timeouts
│   │
│   ├── events/
│   │   ├── auth.events.ts                # Auth events
│   │   ├── conversation.events.ts        # Conversation events
│   │   ├── plan.events.ts                # Plan events
│   │   ├── queue.events.ts               # Queue events
│   │   ├── rateLimit.events.ts           # Rate limit events
│   │   ├── sanitiser.events.ts           # Sanitiser events
│   │   ├── usage.events.ts               # Usage events
│   │   └── wallet.events.ts              # Wallet events
│   │
│   ├── prompt/
│   │   └── assembler.ts                  # Final prompt assembly
│   │
│   ├── memory/
│   │   ├── session.memory.ts             # Redis session transcript
│   │   └── vector.memory.ts             # Qdrant user memory
│   │
│   ├── cache/
│   │   └── semantic.cache.ts             # Qdrant semantic cache
│   │
│   ├── lib/
│   │   ├── embeddings.ts                 # OpenAI embeddings (1536d)
│   │   └── ...
│   │
│   ├── files/
│   │   └── retriever.ts                  # File retrieval
│   │
│   ├── runtime/
│   │   ├── subagent.ts                   # Sub-agent execution
│   │   └── systemModel.ts               # System model resolution
│   │
│   ├── notifications/
│   │   └── templates.ts                  # Email/SMS templates
│   │
│   ├── artifacts/                        # Artifact storage
│   │
│   ├── types/                            # TypeScript types (12 files)
│   │
│   └── utils/
│       ├── errors.ts                     # AppError classes
│       ├── fingerprint.ts                # Request fingerprinting
│       ├── jwt.ts                        # JWT utilities
│       ├── logger.ts                     # Logger utilities
│       ├── planSerialize.ts              # Plan serialization
│       ├── response.ts                   # ok/error response helpers
│       ├── secureRandom.ts               # Secure random
│       └── toolInvocationMode.ts         # Tool invocation modes
│
├── scripts/
│   ├── init-db.sql                       # Docker DB init (grizon_db + app)
│   └── generate-jwt-keys.mjs            # RSA-4096 keypair generator
│
├── secrets/                              # JWT keypair (generated)
│
├── test/
│   ├── unit/                             # 33 unit test files
│   │   ├── wallet.service.test.ts
│   │   ├── token.service.test.ts
│   │   ├── classifier.test.ts
│   │   ├── modelSelector.test.ts
│   │   ├── sseHub.service.test.ts
│   │   ├── sanitiser.service.test.ts
│   │   ├── rateLimit.service.test.ts
│   │   ├── creditCalculator.service.test.ts
│   │   ├── conversation.service.test.ts
│   │   ├── chatJob.service.test.ts
│   │   └── ... (23 more)
│   └── integration/                      # 16 integration test files
│       ├── chat.user.routes.test.ts
│       ├── conversation.user.routes.test.ts
│       ├── auth.user.routes.test.ts
│       ├── chat.worker.test.ts
│       └── ... (12 more)
│
├── docs/
│   ├── PROJECT_ARCHITECTURE.md           # Overall architecture
│   ├── LAYER2_API_GATEWAY.md             # Layer 2 docs
│   ├── LAYER3_AGENT_EXECUTION.md         # Layer 3 docs
│   ├── Memory_Architecture_Complete.md   # Memory architecture
│   ├── Layer 2 Modules/                  # 10 module docs
│   └── Layer 3 Modules/                  # 9 task docs
│
├── Brain/                                # Python Brain backend (see 4.3)
├── client_workspace/                     # Client workspace data
├── workspaces/                           # Active workspaces
├── dist/                                 # Compiled output
└── node_modules/                         # Dependencies
```

**Node.js Totals**: ~120 source files, 10 agents, 12 tools, 11 workers, 5 LLM providers, 59 DB migrations

---

### 4.3. PYTHON BRAIN — `grizon-ai-backend-2-main/Brain/`

```
Brain/
│
├── main.py                               # FastAPI entry (port 8002)
├── __init__.py
├── requirements.txt                      # Python deps
├── Dockerfile                            # Container build
│
├── agents/
│   ├── __init__.py
│   ├── leader_agent.py                   # PM/Leader — project analysis + title
│   ├── manager/
│   │   └── manager_agent.py              # Intent analyzer (ingress node)
│   ├── questions/
│   │   └── questions_agent.py            # Clarifying questions generator
│   ├── planner/
│   │   └── planner_agent.py              # Strategic execution roadmap
│   ├── todo/
│   │   └── todo_agent.py                 # Plan → atomic tasks
│   ├── builder/
│   │   └── builder_agent.py              # Task executor (coordinates sub-agents)
│   ├── runner/
│   │   └── runner_agent.py               # Dev server launcher
│   ├── watcher/
│   │   └── watcher_agent.py              # Process monitor
│   ├── reporter/
│   │   └── reporter_agent.py             # Final report generator
│   ├── planner_agent.py                  # Older planner (v1)
│   ├── clarifier_agent.py                # Older clarifier
│   └── task_agent.py                     # Older task agent
│
├── sub_agents/
│   ├── frontend/
│   │   └── frontend_agent.py             # React/Vite component builder
│   └── database/
│       └── database_agent.py             # Supabase schema builder
│
├── orchestrator/
│   └── orchestrator.py                   # BrainOrchestrator (agent flow coordinator)
│
├── modules/
│   ├── chat/
│   │   ├── controller.py                 # Chat HTTP endpoints
│   │   ├── service.py                    # BrainChatService + LangGraph workflow
│   │   └── types.py                      # BrainState TypedDict
│   ├── conversations/
│   │   ├── controller.py                 # Conversation endpoints
│   │   ├── service.py                    # Conversation service
│   │   └── models.py                     # User, Conversation, Message, Project,
│   │                                     #   Wallet, Transaction, Task (SQLAlchemy)
│   ├── projects/
│   │   ├── controller.py                 # Project CRUD
│   │   ├── decisions.py                  # Decision storage
│   │   ├── execution.py                  # Execution logging
│   │   └── artifacts.py                  # Artifact registration
│   ├── connectors/
│   │   ├── supabase/
│   │   │   ├── controller.py             # Supabase OAuth endpoints
│   │   │   ├── service.py                # Supabase service
│   │   │   └── schema.py                 # Schema management
│   │   └── github/
│   │       ├── controller.py             # GitHub OAuth endpoints
│   │       └── service.py                # GitHub service
│   ├── sandbox/
│   │   └── controller.py                 # Sandbox file ops + WS + proxy
│   ├── supabase_proxy/
│   │   ├── controller.py                 # Multi-tenant proxy endpoints
│   │   └── service.py                    # CompanySupabaseProxy
│   └── shared/
│       └── auth.py                       # get_current_user dependency
│
├── memory/
│   ├── __init__.py
│   ├── gateway.py                        # MemoryGateway (facade)
│   ├── short_term.py                     # ShortTermMemory (Redis)
│   ├── session.py                        # SessionMemory (Redis)
│   ├── project.py                        # ProjectMemory (PostgreSQL)
│   ├── decision.py                       # DecisionMemory (PostgreSQL)
│   ├── execution.py                      # ExecutionMemory (PostgreSQL)
│   ├── artifact.py                       # ArtifactMemory (PostgreSQL)
│   ├── review.py                         # ReviewMemory (PostgreSQL)
│   ├── error.py                          # ErrorMemory (PostgreSQL)
│   ├── skill.py                          # SkillMemory (PostgreSQL)
│   ├── architecture.py                   # ArchitectureMemory (PostgreSQL)
│   ├── change.py                         # ChangeMemory (PostgreSQL)
│   ├── agent_working.py                  # AgentWorkingMemory (Redis)
│   ├── long_term.py                      # LongTermMemory (Qdrant)
│   ├── impact.py                         # QdrantImpactAnalysis
│   ├── memory_engine.py                  # Older MemoryEngine
│   └── models.py                         # SQLAlchemy models (9 tables)
│
├── services/
│   ├── provider_router.py                # LLM model routing (OpenAI/Gemini/fallback)
│   ├── workspace_manager.py              # File-based workspace management
│   ├── sandbox_mcp_service.py            # Remote MCP sandbox (deploy, cleanup)
│   ├── template_service.py               # Template bootstrapping
│   ├── websocket_manager.py              # WebSocket connection manager
│   ├── workspace_watcher.py              # File system watcher
│   ├── build_resume.py                   # Resume interrupted builds
│   ├── command_policy.py                 # WebContainer command filtering
│   ├── web_search_service.py             # Web search integration
│   ├── roadmap_service.py                # Roadmap generation
│   ├── terminal_manager.py              # Terminal session management
│   ├── sandbox_service.py               # Older sandbox service
│   └── brain_chat_service.py            # Older chat service
│
├── config/
│   ├── __init__.py
│   ├── database.py                       # SQLAlchemy engine + session
│   └── redis.py                          # ResilientRedisClient
│
├── shared/
│   ├── agent.py                          # BaseAgent + chat() + get_model()
│   ├── build_standards.py               # Build standards
│   ├── skills/
│   │   └── resolver.py                   # SkillResolver
│   └── review_loop.py                    # QualityReviewer
│
├── mcp/
│   └── connector.py                      # MCP tool discovery proxy (/mcp)
│
├── sandbox_mcp_server/
│   └── mcp-file.py                       # Remote agent simulation with MCP
│
├── templates/
│   ├── express-template/                 # Express.js backend boilerplate
│   ├── supabase-template/               # Supabase integration files
│   ├── react-template/                  # React + Vite frontend boilerplate
│   └── next-template/                   # Next.js frontend boilerplate
│
├── skills/
│   ├── frontend/                         # Frontend skills (skills.md, shadcn.md, react.md)
│   ├── database/                         # Database skills (skills.md, supabase.md)
│   └── backend/                          # Backend skills (skills.md, api-security.md)
│
├── skillss/
│   ├── shadcn/                           # shadcn/ui skills + rules + evals
│   ├── supabase/                         # Supabase skills + references
│   ├── supabase-postgres-best-practices/ # 30+ Postgres optimization docs
│   ├── frontend-design/                  # Frontend design skill
│   ├── backend-development/              # Backend development skill
│   └── nodejs-backend-patterns/          # Node.js backend patterns
│
├── models/                               # Data models (additional)
├── providers/                            # LLM provider configs
├── queues/                               # Task queue implementations
├── utils/
│   └── context_manager.py               # Context management utilities
│
├── sql/                                  # SQL scripts
├── configs/                              # Additional configs
├── docker/
│   └── Dockerfile.sandbox                # Sandbox Dockerfile
│
├── logs/                                 # Runtime logs
├── client_workspace/                     # Client workspace data
├── sandboxes/                            # Sandbox data
├── scratch/                              # Test files
│
├── agents.md                             # Agent documentation
├── brain_route_plan.md                   # Routing plan
├── master_universal_brain_backend.md     # Master backend doc
├── project_brain.md                      # Brain project doc
├── layers _features.md                   # Features documentation
├── orchestration.md                      # Orchestration doc
├── memory_detailed.md                    # Memory system doc
├── Frontend.md                           # Frontend integration doc
├── BACKEND_INTEGRATION.md               # Backend integration doc
├── supabase_proxy_workflow.md            # Supabase proxy workflow
│
├── check_all_providers.py                # Provider check script
├── check_connectors.py                   # Connector check script
├── check_db.py                           # DB check script
├── check_final_fix.py                    # Final fix check
├── check_job_details.py                  # Job details check
├── check_msgs.py                         # Messages check
├── check_openai.py                       # OpenAI check
├── check_unified_status.py              # Unified status check
├── create_test_user.py                   # Test user creation
├── debug_planner.py                      # Planner debugging
├── discover_models.py                    # Model discovery
├── drop_fk.py                            # FK drop utility
├── inspect_db.py                         # DB inspection
├── insert_test_user.py                   # Test user insertion
├── list_gemini.py                        # Gemini model listing
├── test_all_memories.py                  # Memory system tests
├── test_project_api.py                   # Project API tests
│
├── auto_insert_connector.py              # Auto connector insertion
│
├── *.txt / *.log / *.md                  # Various logs and docs
└── __pycache__/                          # Python cache
```

**Python Brain Totals**: ~90+ Python files, 10 agents, 12 memory modules, 4 templates, 6 skills collections

---

### 4.4. INFRASTRUCTURE — Docker & Shared

```
grizon-ai-backend-2-main/
├── docker-compose.yml                    # 6 services orchestration
│   Services:
│   ├── app        (Node.js)      :4000→3000
│   ├── brain      (Python FastAPI) :8001
│   ├── postgres   (pgvector:pg16) :5432
│   ├── redis      (redis:7)       :6379
│   ├── qdrant     (qdrant)        :6333
│   ├── pgweb      (admin UI)      :8081
│   └── unstructured (doc parser)  :8000
│
├── scripts/
│   ├── init-db.sql                     # Creates grizon_db + app databases
│   └── generate-jwt-keys.mjs          # RSA-4096 keypair
│
├── .env                                 # Local dev env
├── .env.docker                          # Docker env
├── .env.docker.example                  # Docker env template
├── .env.production.example              # Production template
└── .env.example                         # Dev env template
```

---

## 5. EXTERNAL INTEGRATIONS MAP

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LLM PROVIDERS (via Node.js Gateway)                                   │
│  ├── OpenAI         (GPT-4o, GPT-4o-mini)     — primary               │
│  ├── Anthropic      (Claude)                   — via OpenAI fallback   │
│  ├── Google Gemini  (gemini-3-flash-preview)   — direct API            │
│  ├── DeepSeek       (OpenAI-compatible)        — alternative            │
│  └── xAI Grok       (OpenAI-compatible)        — alternative            │
│                                                                         │
│  LLM PROVIDERS (via Python Brain)                                      │
│  ├── OpenAI         (GPT-4o, GPT-4o-mini)     — via LangChain         │
│  └── Google Gemini  (via LangChain)            — direct API            │
│                                                                         │
│  DATABASE                                                              │
│  ├── PostgreSQL     (pgvector:pg16)            — both backends          │
│  ├── Redis          (7.x)                      — caching, queues, SSE  │
│  └── Qdrant         (vector DB)                — semantic cache, memory│
│                                                                         │
│  STORAGE                                                               │
│  ├── AWS S3         (file storage)             — Node.js Gateway       │
│  └── Local FS       (workspace files)          — Python Brain          │
│                                                                         │
│  SEARCH                                                                │
│  ├── Serper         (web search)               — Node.js Gateway       │
│  ├── Brave          (web search)               — Node.js Gateway       │
│  └── Tavily         (web search)               — Node.js Gateway       │
│                                                                         │
│  CODE EXECUTION                                                        │
│  ├── Judge0         (sandboxed code exec)      — Node.js Gateway       │
│  └── MCP Sandbox    (GCP MicroVMs)             — Python Brain          │
│                                                                         │
│  OAUTH CONNECTORS                                                      │
│  ├── Google         (user auth)                — Node.js Gateway       │
│  ├── Supabase       (DB + auth)                — Python Brain          │
│  └── GitHub         (repos + file sync)        — Python Brain          │
│                                                                         │
│  PAYMENTS                                                              │
│  └── PhonePe        (subscriptions + topup)    — Node.js Gateway       │
│                                                                         │
│  EMAIL/SMS                                                             │
│  ├── Postmark       (transactional email)      — Node.js Gateway       │
│  ├── Resend         (transactional email)      — Node.js Gateway       │
│  ├── Authkey        (email + SMS)              — Node.js Gateway       │
│  └── AWS SES        (email)                    — Node.js Gateway       │
│                                                                         │
│  DOCUMENT PARSING                                                      │
│  └── Unstructured   (PDF/DOCX/etc parsing)     — Node.js Gateway       │
│                                                                         │
│  EMBEDDINGS                                                            │
│  └── OpenAI         (text-embedding-3-small, 1536d)                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. KEY DESIGN PATTERNS

| Pattern | Where Used | Description |
|---------|-----------|-------------|
| **LangGraph State Machine** | Brain (`modules/chat/service.py`) | Typed state graph with conditional edges, async nodes |
| **Gateway Pattern** | Brain (`memory/gateway.py`) | `MemoryGateway` assembles 12-layer context for agents |
| **Provider Routing** | Both backends | Abstracts LLM selection with automatic fallback chains |
| **Circuit Breaker** | Node.js (`router/providerHealth.ts`) | Tracks provider failures, temporarily disables failing providers |
| **Queue-Based Async** | Node.js (`workers/chat.worker.ts`) | All chat requests enqueued to BullMQ, processed by workers |
| **Multi-Round Tool Loop** | Node.js (`router/index.ts`) | LLM calls tools → receives results → calls more tools (max 10) |
| **Semantic Caching** | Node.js (`cache/semantic.cache.ts`) | Qdrant vector similarity (0.92 threshold) saves credits |
| **Hold-Confirm-Release** | Node.js (`wallet.service.ts`) | Credit wallet pattern for usage-based billing |
| **SSE Streaming** | Both backends → Frontend | Real-time Server-Sent Events for chat responses |
| **XML Tag Protocol** | Frontend (`useStreamParser.ts`) | `<grizon-artifact>`, `<grizon-code>` etc. route content to Canvas |
| **Event Bus** | Frontend (DOM events) | Custom events decouple cross-cutting concerns |
| **Resilient Redis** | Brain (`config/redis.py`) | Silently degrades when Redis is unreachable |
| **MCP Protocol** | Brain → Remote Sandbox | Model Context Protocol for remote code execution |
| **Multi-Tenant Proxy** | Brain (`supabase_proxy/`) | JWT-based tenant isolation, rate limiting, retention cleanup |
| **Zero-Re-render Theming** | Frontend | CSS custom properties + `data-theme` attribute switching |
| **Memory-Only Tokens** | Frontend (`AuthContext.tsx`) | JWT access tokens in React refs, refresh in localStorage |

---

## 7. DEPENDENCY GRAPH

```
                    ┌──────────────┐
                    │   FRONTEND   │
                    │  Next.js 16  │
                    │  React 19    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │ REST+SSE   │            │ Proxied SSE
              ▼            │            ▼
     ┌────────────────┐    │    ┌────────────────┐
     │  NODE.JS API   │    │    │  PYTHON BRAIN  │
     │  Express 4     │    │    │  FastAPI       │
     │  TypeScript 5  │    │    │  Python 3.12   │
     └───────┬────────┘    │    └───────┬────────┘
             │             │            │
             │    ┌────────┘            │
             │    │                     │
             ▼    ▼                     ▼
     ┌──────────────────┐      ┌──────────────────┐
     │   PostgreSQL     │      │  MCP Sandbox     │
     │   (pgvector)     │◄────►│  (GCP MicroVMs)  │
     │   :5432          │      └──────────────────┘
     └──────────────────┘
             ▲
     ┌───────┴────────┐
     │                │
     ▼                ▼
┌──────────┐   ┌──────────┐
│  Redis   │   │  Qdrant  │
│  :6379   │   │  :6333   │
└──────────┘   └──────────┘
```

---

## 8. PORT MAP

| Service | Internal Port | External Port | Purpose |
|---------|--------------|---------------|---------|
| Next.js Frontend | 3000 | 3000 | Web UI |
| Node.js API Gateway | 4000 | 4000 | REST API + SSE |
| Python Brain | 8001/8002 | 8001 | AI Agent Orchestration |
| PostgreSQL | 5432 | 5432 | Primary Database |
| Redis | 6379 | 6379 | Cache + Queues + Pub/Sub |
| Qdrant | 6333 | 6333 | Vector Database |
| pgweb | 8081 | 8081 | DB Admin UI |
| Unstructured | 8000 | 8000 | Document Parsing |

---

## 9. ENVIRONMENT VARIABLES (KEY ONES)

### Frontend
```
NEXT_PUBLIC_API_URL          # Node.js API base URL
NEXT_PUBLIC_BRAIN_API_URL    # Brain API base URL (proxied via /api/brain/*)
```

### Node.js Gateway
```
DATABASE_URL                 # PostgreSQL connection string
REDIS_URL                    # Redis connection string
QDRANT_URL                   # Qdrant connection string
JWT_PRIVATE_KEY_PATH         # RSA-4096 private key
JWT_PUBLIC_KEY_PATH          # RSA-4096 public key
OPENAI_API_KEY               # OpenAI API key
ANTHROPIC_API_KEY            # Anthropic API key
GOOGLE_AI_API_KEY            # Google Gemini API key
DEEPSEEK_API_KEY             # DeepSeek API key
XAI_API_KEY                  # xAI Grok API key
SERPER_API_KEY               # Serper search API key
BRAVE_API_KEY                # Brave search API key
TAVILY_API_KEY               # Tavily search API key
JUDGE0_API_URL               # Judge0 code execution
PHONEPE_MERCHANT_ID          # PhonePe merchant ID
PHONEPE_SALT_KEY             # PhonePe salt key
AWS_S3_BUCKET                # S3 bucket name
POSTMARK_SERVER_TOKEN        # Postmark email
S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY  # AWS S3
```

### Python Brain
```
DATABASE_URL                 # PostgreSQL (app database)
OPENAI_API_KEY               # OpenAI API key
GOOGLE_API_KEY               # Google Gemini API key
REDIS_URL                    # Redis connection string
BRAIN_WS_HOST                # WebSocket host (brain)
SUPABASE_URL                 # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY    # Supabase service role key
MCP_SANDBOX_URL              # Remote MCP sandbox URL
```

---

## 10. QUICK REFERENCE — WHERE TO LOOK

| Task | File(s) |
|------|---------|
| Add new chat agent (Node.js) | `src/agents/<name>.agent.ts` + seed in `src/db/seed.ts` |
| Add new tool (Node.js) | `src/tools/<name>.tool.ts` + register in `src/tools/registry.ts` |
| Modify chat processing | `src/workers/chat.worker.ts` |
| Modify routing/classifier | `src/router/classifier.ts`, `src/router/index.ts` |
| Add Brain agent | `Brain/agents/<name>/` + register in `Brain/orchestrator/orchestrator.py` |
| Modify LangGraph workflow | `Brain/modules/chat/service.py` |
| Modify memory system | `Brain/memory/` (12 modules) |
| Add frontend route | `app/(main)/<route>/page.tsx` |
| Add frontend component | `components/<category>/` |
| Add Brain UI component | `brain/components/Brain<Name>.tsx` |
| Modify auth flow | `src/services/auth.service.ts` + `src/gateway/auth.middleware.ts` |
| Modify billing/wallet | `src/services/wallet.service.ts` |
| Modify SSE streaming | `src/services/sseHub.service.ts` + `lib/chat-sse.ts` |
| Modify sandbox deploy | `Brain/services/sandbox_mcp_service.py` |
| Add database migration | `src/db/migrations/` (sequential SQL files) |
| Modify theme system | `app/globals.css` + `lib/themes.ts` + `context/ThemeContext.tsx` |
| Modify canvas system | `components/chat/canvas/` + `context/CanvasContext.tsx` |
| Modify voice system | `hooks/useSpeechRecognition.ts` + `hooks/useSpeechSynthesis.ts` |
| Docker config | `docker-compose.yml` |
| Environment config | `src/config/env.ts` (Node.js), `.env` files |

---

## 11. STATISTICS SUMMARY

| Metric | Count |
|--------|-------|
| **Total source files (all 3 codebases)** | **~325+** |
| Frontend source files | ~115 |
| Node.js Gateway source files | ~120 |
| Python Brain source files | ~90 |
| React Context Providers | 7 |
| Brain UI Components | 18 |
| Canvas Display Modes | 9 |
| Built-in Themes | 4 |
| Node.js Agents | 10 |
| Node.js Tools | 12 |
| Node.js Workers | 11 |
| Python Brain Agents | 10 |
| Python Memory Modules | 12 |
| LLM Providers | 5 |
| Database Tables | 40+ |
| DB Migrations | 59 |
| API Endpoints (total) | ~100+ |
| Docker Services | 6-7 |
| External Integrations | 15+ |
| Unit Tests | 33 |
| Integration Tests | 16 |
| Skills Collections | 6 |
| Template Types | 4 |
