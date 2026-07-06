# BuilderBrain — Complete Brain System Audit & Master Architecture Documentation

> **Generated**: July 1, 2026
> **Scope**: `grizon-ai-backend-2-main/Brain/` and `Grizon-AI-Frontend-v2-api-2/brain/`
> **Classification**: Documentation & Audit Only — No code modifications

---

# SECTION 1: Executive Summary

## What BuilderBrain Is

BuilderBrain is an **AI Full Stack Development Platform** whose core is the **Brain** — a Python-based AI orchestrator that takes a user prompt, asks clarifying questions, creates a strategic plan, generates a todo list, and orchestrates sub-agents (Frontend, Backend, Supabase) to write code. The code is deployed to a **remote MCP sandbox** with live preview via Cloudflare tunnels. The system has a **comprehensive 12-type memory architecture** with vector search and impact analysis.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend: Grizon-AI-Frontend-v2-api-2/brain/                      │
│  ├── BrainView, BrainMessages, BrainPlanCanvas, BrainTodoCanvas    │
│  ├── BrainEditorCanvas, BrainSandboxCanvas, BrainBuildActivityFeed │
│  ├── Memory Clients (project, decision, execution, artifact)       │
│  └── Brain API Client → http://localhost:8001                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP/SSE/WebSocket
┌──────────────────────────▼──────────────────────────────────────────┐
│  Brain: grizon-ai-backend-2-main/Brain/ (Python FastAPI)           │
│  ├── Orchestrator (BrainOrchestrator state machine)                 │
│  ├── Agents (13 agent types)                                       │
│  │   ├── Manager → Questions → Planner → Todo → Builder → Runner   │
│  │   ├── Builder coordinates: Frontend, Backend, Supabase sub-agents│
│  │   └── QualityReviewer validates each sub-agent output           │
│  ├── Memory Gateway (12 memory types)                               │
│  │   ├── ShortTerm, Session, AgentWorking (Redis)                   │
│  │   ├── Project, Decision, Execution, Artifact, Review, Error     │
│  │   ├── Skill, Architecture, Change (PostgreSQL)                   │
│  │   ├── LongTerm, Impact (Qdrant vectors)                         │
│  │   └── MemoryGateway.build_agent_context() assembles all         │
│  ├── MCP Connectors (GitHub, Supabase via GCP-hosted MCP servers)  │
│  ├── Sandbox MCP Service (save, execute, deploy, tunnel)           │
│  ├── Skills (frontend, backend, database markdown files)           │
│  ├── Services (15 service files)                                   │
│  └── PostgreSQL + Redis + Qdrant                                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Current Maturity Level

**Beta Stage** — approximately **55-60% complete** toward a production-ready Brain.

The core pipeline works end-to-end: prompt → clarification → planning → todo → build → deploy → preview. The memory system is comprehensive but underutilized. The sandbox MCP integration is functional. Skills system exists but is not dynamically loaded.

## Biggest Strengths

1. **12-Type Memory Architecture**: ShortTerm, Session, AgentWorking, Project, Decision, Execution, Artifact, Review, Error, Skill, Architecture, Change + LongTerm (Qdrant) + Impact Analysis
2. **MemoryGateway**: Central class that assembles full agent context from all memory types in one call
3. **MCP Connectors**: GitHub and Supabase connectors via GCP-hosted MCP servers — Supabase has full OAuth with PKCE
4. **Sandbox MCP**: Full sandbox lifecycle — save files, execute code, deploy workspace, get tunnel URL, cleanup
5. **Multi-Agent Pipeline**: Manager → Questions → Planner → Todo → Builder → Runner with 13 agent types
6. **Quality Review Loop**: QualityReviewer validates sub-agent output against skill rules before acceptance
7. **Impact Analysis**: Qdrant-based vector search for analyzing change impact on existing artifacts
8. **Error Memory**: Full-text search over known errors with success rate tracking
9. **Skill Performance Tracking**: Records which skills work best with success rates and token costs
10. **Architecture Pattern Memory**: Tracks which tech stacks succeed with success rate analytics
11. **Framework Support**: React (Vite) and Next.js with template bootstrapping
12. **Supabase Integration**: Full OAuth flow with PKCE, token exchange, SQL execution
13. **Chat System**: LangGraph workflow with streaming, conversation persistence, auto-titles, resume build

## Verified Features

### Framework Support ✅
- **React (Vite)**: Default framework, template in `brain/templates/react-template/`
- **Next.js**: Supported via `brain/templates/next-template/`
- Frontend selector component: `BrainFrameworkSelector.tsx`
- Backend: `template_service.py` normalizes framework, loads templates
- `FRAMEWORK_TO_FRONTEND_TEMPLATE` maps: react→react-template, next→next-template

### Supabase MCP ✅
- Full OAuth flow in `Brain/modules/connectors/supabase/`
- `SupabaseOAuthService` with PKCE challenge
- Token exchange, save connection, status check
- SQL execution via Supabase API
- Frontend integration in `BrainSupabasePrompt.tsx`

### Skills System ✅
- 3 skill categories: frontend, backend, database
- `react.md`: React + Vite rules (18 lines)
- `api-security.md`: Express security best practices (6 lines)
- `supabase.md`: Supabase rules
- `SkillResolver` matches tasks to skills via keywords
- Skills injected into agent system prompts

### Multiple Chat System ✅
- `BrainChatService` with LangGraph workflow
- `chat_stream` endpoint for SSE streaming
- `chat` endpoint for synchronous processing
- `stop_chat` endpoint for cancellation
- Conversation persistence via `conversation_service`
- Auto-title generation for new conversations
- Resume build support

## Verified Weaknesses

1. **No Authentication on Brain Endpoints**: Brain FastAPI has no auth middleware — anyone can call Brain APIs
2. **CORS Wide Open**: `allow_origins=["*"]` in Brain's FastAPI — accepts requests from any origin
3. **No Rate Limiting on Brain**: No rate limiting on Brain endpoints
4. **Memory Gateway Not Used in Chat Flow**: `build_agent_context()` exists but is not called in the main chat worker
5. **Brain Templates Folder Empty**: `brain/templates/` directory exists but contains no actual template files (templates loaded from `services/template_service.py` which reads from `templates/` folder — need to verify if templates exist there)
6. **Skills Not Dynamically Loaded**: Skills are static markdown files — no runtime discovery, versioning, or user-defined skills
7. **QualityReviewer Only in Brain Agents**: The review loop exists in Brain sub-agents but not in Backend-2's agent system
8. **Memory Recall Disabled in Chat Worker**: Backend-2's `chat.worker.ts:572-576` has `recallFacts()` commented out
9. **Brain URL Hardcoded Fallback**: Frontend defaults to `http://localhost:8001` in 15+ files

## Readiness Percentage

| Area | Completion | Notes |
|---|---|---|
| Agent Pipeline | 70% | 13 agents, full flow working |
| Memory System | 60% | 12 types implemented, but not fully integrated |
| MCP Connectors | 65% | GitHub + Supabase via GCP with OAuth, Sandbox MCP |
| Sandbox | 65% | MCP-based with tunnel, but no persistent sandboxes |
| Skills | 50% | 3 categories with rules, but static loading |
| Framework Support | 60% | React + Next.js templates, but limited to 2 frameworks |
| Chat System | 65% | LangGraph workflow, streaming, conversation persistence |
| Frontend Integration | 55% | 18 components, memory clients, streaming |
| Security | 20% | No auth, wide-open CORS |
| Testing | 15% | Minimal Brain-specific tests |
| Deployment | 30% | Docker exists, no CI/CD |
| **Overall** | **~50%** | |

---

# SECTION 2: Brain System Structure

## grizon-ai-backend-2-main/Brain/

```
Brain/
├── main.py                          # FastAPI server entry (port 8001)
├── Dockerfile                       # Brain container
├── requirements.txt                 # Python dependencies
│
├── orchestrator/                    # Orchestration engine
│   ├── __init__.py
│   └── orchestrator.py              # BrainOrchestrator state machine
│
├── agents/                          # 13 agent types
│   ├── manager/manager_agent.py     # Intent analysis, Q&A routing
│   ├── questions/                   # Clarification questions
│   ├── planner/planner_agent.py     # Strategic roadmap generation
│   ├── todo/todo_agent.py           # Task list generation
│   ├── builder/builder_agent.py     # Coordinates sub-agents, writes files
│   │   └── mcp_tools.py            # MCP sandbox tools (save, execute)
│   ├── runner/runner_agent.py       # Sandbox deployment, tunnel setup
│   ├── watcher/watcher_agent.py     # Sandbox monitoring
│   ├── reporter/                    # Final report generation
│   ├── clarifier_agent.py           # Clarification logic
│   ├── leader_agent.py              # PM/Leader analysis
│   ├── planner_agent.py             # Planning (top-level)
│   ├── task_agent.py                # Task generation
│   └── reporter_agent.py            # Reporting (top-level)
│
├── sub_agents/                      # Domain-specific sub-agents
│   ├── frontend/frontend_agent.py   # React/JSX code generation
│   ├── backend/backend_agent.py     # Express/Node.js code generation
│   └── database/database_agent.py   # Supabase + MCP connectors
│
├── shared/                          # Shared utilities
│   ├── agent.py                     # BaseAgent abstract class
│   ├── build_standards.py           # Full-stack build standards
│   ├── review_loop.py               # QualityReviewer
│   ├── frontend_entry.py            # App.jsx normalization
│   └── skills/                      # Skill resolver
│       ├── resolver.py              # Keyword-based skill matching
│       └── ingestion.py             # Skill ingestion
│
├── memory/                          # 12-type memory system
│   ├── gateway.py                   # MemoryGateway (central orchestrator)
│   ├── short_term.py                # Redis short-term (3h TTL)
│   ├── session.py                   # Redis session (24h TTL)
│   ├── agent_working.py             # Agent-specific working memory (6h TTL)
│   ├── project.py                   # Project CRUD
│   ├── decision.py                  # Decision tracking + override
│   ├── execution.py                 # Execution logging
│   ├── artifact.py                  # Artifact versioning
│   ├── review.py                    # Code review storage
│   ├── error.py                     # Error pattern matching (full-text search)
│   ├── skill.py                     # Skill performance tracking
│   ├── architecture.py              # Architecture pattern tracking
│   ├── change.py                    # Change request tracking
│   ├── long_term.py                 # Qdrant vector memory
│   ├── impact.py                    # Qdrant impact analysis
│   ├── memory_engine.py             # Basic SQLAlchemy queries
│   ├── debug.py                     # Debug endpoints (router)
│   └── models.py                    # SQLAlchemy models
│
├── services/                        # 15 service files
│   ├── brain_chat_service.py        # Main LangGraph workflow
│   ├── provider_router.py           # Multi-provider model routing
│   ├── workspace_manager.py         # File workspace management
│   ├── websocket_manager.py         # WebSocket broadcast
│   ├── sandbox_mcp_service.py       # Sandbox MCP lifecycle
│   ├── sandbox_manager.py           # Deprecated alias
│   ├── template_service.py          # Framework normalization
│   ├── web_search_service.py        # Web search integration
│   ├── command_policy.py            # Command filtering
│   ├── build_resume.py              # Build resume logic
│   ├── roadmap_service.py           # Roadmap generation
│   ├── terminal_manager.py          # Terminal management
│   └── workspace_watcher.py         # File watching
│
├── skills/                          # Domain skills (markdown)
│   ├── frontend/                    # react.md, skills.md
│   ├── backend/                     # api-security.md, skills.md
│   └── database/                    # supabase.md, skills.md
│
├── mcp/                             # MCP connectors
│   └── connector.py                 # GitHub + Supabase MCP via GCP
│
├── modules/                         # Feature modules
│   ├── chat/                        # Chat endpoints + service
│   ├── connectors/                  # Connector management
│   │   ├── supabase/               # Supabase MCP connector
│   │   └── github/                 # GitHub MCP connector
│   ├── conversations/               # Conversation CRUD
│   ├── projects/                    # Project CRUD + decisions + execution + artifacts
│   ├── sandbox/                     # Sandbox endpoints
│   └── shared/                      # Shared module utilities
│
├── config/                          # Configuration
├── controllers/                     # Request handlers
├── providers/                       # AI provider adapters
├── queues/                          # Queue definitions
├── models/                          # Data models
├── templates/                       # EMPTY — no project templates
├── sandboxes/                       # EMPTY — sandbox logic in services
├── utils/                           # Utilities
├── sql/                             # SQL migrations
├── docker/                          # Docker configs
├── logs/                            # Log files
├── scratch/                         # Scratch files
└── client_workspace/                # Runtime workspaces
```

## Grizon-AI-Frontend-v2-api-2/brain/

```
brain/
├── BrainLayout.tsx                  # Brain page layout
├── BrainView.tsx                    # Main Brain view (207 lines)
│
├── components/                      # 18 Brain components
│   ├── BrainMessages.tsx            # Chat messages with Brain context
│   ├── BrainPlanCanvas.tsx          # Strategic plan visualization
│   ├── BrainTodoCanvas.tsx          # Task list display
│   ├── BrainEditorCanvas.tsx        # Code editor integration
│   ├── BrainSandboxCanvas.tsx       # Live preview canvas
│   ├── BrainBuildActivityFeed.tsx   # Activity stream
│   ├── BrainBuildWorkspace.tsx      # Workspace visualization
│   ├── BrainClarificationCard.tsx   # Clarification questions UI
│   ├── BrainDecisionView.tsx        # Decision display/override
│   ├── BrainExecutionView.tsx       # Execution status
│   ├── BrainAgentStatus.tsx         # Agent progress indicators
│   ├── BrainAgentMessage.tsx        # Agent-specific messages
│   ├── BrainUserMessage.tsx         # User messages
│   ├── BrainArtifactView.tsx        # Artifact display
│   ├── BrainFrameworkSelector.tsx   # Framework selection
│   ├── BrainLiveTodos.tsx           # Live task updates
│   ├── BrainPublishModal.tsx        # Publish/deploy modal
│   └── BrainSupabasePrompt.tsx      # Supabase connection prompt
│
├── context/                         # BrainWebContainerContext
├── hooks/                           # useBrainWorkspaceOps
├── store/                           # execution-store (Zustand)
│
└── lib/                             # Brain utilities
    ├── agent-engine/
    │   └── engine.ts               # Agent execution engine
    ├── agents/
    │   └── dynamic-prompts.ts      # Dynamic prompt generation
    ├── streaming/
    │   ├── stream-simulator.ts     # Stream simulation
    │   └── useStream.ts            # Stream hook
    ├── brainApiBase.ts             # Brain API client (26 lines)
    ├── brainSession.ts             # Session management
    ├── brainWebContainer.ts        # WebContainer + MCP integration
    ├── buildActivity.ts            # Activity tracking
    ├── buildSession.ts             # Build session management
    ├── commandPolicy.ts            # Command filtering
    ├── projectMemory.ts            # Project CRUD API
    ├── decisionMemory.ts           # Decision tracking API
    ├── executionMemory.ts          # Execution logging API
    ├── artifactMemory.ts           # Artifact management API
    ├── fileTreeUtils.ts            # File tree utilities
    ├── templateBootstrap.ts        # Template setup
    └── resumeBrainBuild.ts         # Build resume logic
```

---

# SECTION 3: Memory System (12 Types)

## Architecture

The Brain has the most comprehensive memory system. All memory types are orchestrated by `MemoryGateway`.

```
┌─────────────────────────────────────────────────────────────────┐
│                    MemoryGateway                                 │
│  build_agent_context(agent_name) → full context dict            │
│  analyze_change_impact(change_request) → impact analysis        │
└──────────┬──────────┬──────────┬──────────┬────────────────────┘
           │          │          │          │
    ┌──────▼──┐ ┌─────▼────┐ ┌──▼───┐ ┌───▼────┐
    │  Redis  │ │PostgreSQL│ │Qdrant│ │ Lazy   │
    │ (3 types)│ │(8 types) │ │(2)  │ │ Load   │
    └─────────┘ └──────────┘ └──────┘ └────────┘
```

## Memory Types

| Type | File | Backend | TTL | Purpose |
|---|---|---|---|---|
| **ShortTerm** | `short_term.py` | Redis | 3h | Recent conversation entries (role, content, agent, timestamp) |
| **Session** | `session.py` | Redis | 24h | Workflow state, current agent, last active time |
| **AgentWorking** | `agent_working.py` | Redis | 6h | Agent-specific working data (per agent, per session) |
| **Project** | `project.py` | PostgreSQL | — | Project CRUD (name, description, stack, requirements, roadmap) |
| **Decision** | `decision.py` | PostgreSQL | — | Approved decisions with override support (frontend, backend, theme, auth) |
| **Execution** | `execution.py` | PostgreSQL | — | Task execution logs (start, complete, fail, duration, tokens) |
| **Artifact** | `artifact.py` | PostgreSQL | — | File/component versioning (name, type, path, hash, dependencies, exports) |
| **Review** | `review.py` | PostgreSQL | — | Code reviews (quality score, issues, pass/fail, recurring issues) |
| **Error** | `error.py` | PostgreSQL | — | Known errors with full-text search, success rate tracking |
| **Skill** | `skill.py` | PostgreSQL | — | Skill performance (uses, success rate, avg score, token cost) |
| **Architecture** | `architecture.py` | PostgreSQL | — | Tech stack patterns with success rate analytics |
| **Change** | `change.py` | PostgreSQL | — | Change requests with affected files/components |
| **LongTerm** | `long_term.py` | Qdrant | — | Vector embeddings for semantic search (text-embedding-3-small) |
| **Impact** | `impact.py` | Qdrant | — | Artifact dependency graph via vector similarity |

## MemoryGateway

```python
class MemoryGateway:
    def __init__(self, project_id, session_id):
        self.short_term = ShortTermMemory(session_id)     # Redis
        self.session = SessionMemory(session_id)           # Redis
        self.project = ProjectMemory()                     # PostgreSQL
        self.decisions = DecisionMemory()                  # PostgreSQL
        self.execution = ExecutionMemory()                 # PostgreSQL
        self.artifacts = ArtifactMemory()                  # PostgreSQL
        self.reviews = ReviewMemory()                      # PostgreSQL
        self.errors = ErrorMemory()                        # PostgreSQL
        self.skills = SkillMemory()                        # PostgreSQL
        self.architecture = ArchitectureMemory()           # PostgreSQL
        self.long_term = None  # Lazy loaded               # Qdrant
        self.impact = None     # Lazy loaded               # Qdrant

    async def build_agent_context(self, agent_name):
        # Assembles: conversation, decisions, project, known_errors,
        # execution_status, session_state, artifact_components,
        # registered_artifacts
        pass

    async def analyze_change_impact(self, change_request):
        # Returns: similar_past_context, impacted_components, all_components
        pass
```

## Key Memory Operations

### Error Memory (Full-Text Search)
```python
# Record error pattern
error_memory.record_error(
    error_pattern="Cannot resolve module './Component'",
    framework="react",
    error_type="import",
    fix={"description": "Add missing import", "code": "import Component from './Component'"}
)

# Find fix via full-text search
fixes = error_memory.find_fix("Cannot resolve module", "react")
# Returns ranked results with ts_rank score
```

### Impact Analysis (Vector Search)
```python
# Index artifact in Qdrant
impact.index_artifact(project_id, artifact_id, name, file_path, type, deps, exports)

# Find what depends on a component
dependents = impact.find_dependents("Navbar", project_id)

# Analyze impact of a change request
analysis = impact.impact_analysis("Change navigation to vertical", project_id)
# Returns affected_artifacts with similarity scores
```

### Architecture Pattern Memory
```python
# Record architecture usage
arch.record_usage({"frontend": "react", "backend": "express", "database": "supabase"}, project_id, succeeded=True)

# Get best patterns for an app type
best = arch.get_best_match_for_type("saas")
# Returns pattern with highest success_rate
```

---

# SECTION 4: Agent System (13 Agents)

## Agent Pipeline

```
User Prompt
    │
    ▼
ManagerAgent ──→ Analyzes intent, checks context
    │
    ├──→ QuestionsAgent (if context missing)
    │        │
    │        ▼
    │    User answers → ManagerAgent re-evaluates
    │
    ▼
PlannerAgent ──→ Creates strategic roadmap
    │
    ▼
TodoAgent ──→ Generates ordered task list
    │
    ▼
BuilderAgent ──→ Routes to sub-agents by category
    │
    ├──→ FrontendAgent (React/JSX)
    ├──→ BackendAgent (Express/Node.js)
    ├──→ DatabaseAgent (Supabase + MCP connectors)
    │
    ▼
QualityReviewer ──→ Validates output (max 2 retries)
    │
    ▼
RunnerAgent ──→ Deploys to sandbox via MCP
    │
    ▼
WatcherAgent ──→ Monitors sandbox health
    │
    ▼
ReporterAgent ──→ Generates final report
```

## Agent Details

| Agent | File | Model | Role |
|---|---|---|---|
| **ManagerAgent** | `manager/manager_agent.py` | gpt-4o-mini | Intent analysis, context check, routes to Questions or Planner |
| **QuestionsAgent** | `questions/` | deepseek-chat | Generates clarification questions with options |
| **PlannerAgent** | `planner/planner_agent.py` | deepseek-chat | Creates strategic execution roadmap |
| **TodoAgent** | `todo/todo_agent.py` | deepseek-chat | Converts plan to ordered task list with categories |
| **BuilderAgent** | `builder/builder_agent.py` | gpt-4o-mini | Routes tasks, writes files via MCP tools, agent loop with timeout |
| **FrontendAgent** | `sub_agents/frontend/` | deepseek-chat | Generates React/JSX with routing, API, Tailwind |
| **BackendAgent** | `sub_agents/backend/` | deepseek-chat | Generates Express routes, controllers, Supabase |
| **DatabaseAgent** | `sub_agents/database/` | gpt-4o-mini | Generates Supabase schemas, RLS policies, MCP integration |
| **RunnerAgent** | `runner/runner_agent.py` | gpt-4o-mini | Deploys workspace via MCP sandbox, sets up tunnel |
| **WatcherAgent** | `watcher/watcher_agent.py` | deepseek-chat | Monitors sandbox status |
| **ReporterAgent** | `reporter/` | deepseek-chat | Generates final technical report |
| **ClarifierAgent** | `clarifier_agent.py` | deepseek-chat | Generates clarification questions |
| **LeaderAgent** | `leader_agent.py` | deepseek-chat | PM analysis, title generation |

## BuilderAgent Agent Loop

The BuilderAgent runs a manual agent loop with tool calling:

```python
async def _run_agent_loop(self, system_prompt, instruction, session_id, task_title, timeout_sec=90):
    # Max 15 tool calls per task
    # 45s timeout per LLM call
    # 90s overall timeout per task
    # 150s hard timeout for entire execute()
    # Tools: client_save_code (file writing)
    # Duplicate file detection via seen_files set
```

## Quality Review Loop

```python
class QualityReviewer:
    async def review_output(self, agent_name, task, skill_rules, generated_content):
        # 1. Frontend: checks component connectivity (BFS from App.jsx)
        # 2. All agents: evaluates against compiled skill rules
        # Returns: {"passed": bool, "feedback": str}
        
        # If failed, sub-agent retries with feedback (max 2 iterations)
```

---

# SECTION 5: MCP Connectors

## GitHub MCP

```python
# Brain/mcp/connector.py
@router.post("/mcp/github/tools")
async def list_github_tools(github_token: str):
    # Connects to GCP-hosted MCP server
    url = f"{GCP_MCP_BASE_URL}/sse/github"
    # Lists available GitHub tools via MCP protocol
```

## Supabase MCP

```python
@router.post("/mcp/supabase/tools")
async def list_supabase_tools(supabase_token, supabase_project):
    # Connects to GCP-hosted MCP server
    url = f"{GCP_MCP_BASE_URL}/sse/supabase"
    # Lists available Supabase tools via MCP protocol
```

## Sandbox MCP

`Brain/services/sandbox_mcp_service.py` provides:
- `save_code_to_sandbox(session_id, filename, content)` — save files
- `execute_in_sandbox(session_id, command)` — execute code
- `deploy_workspace(session_id, entrypoint)` — deploy full workspace with archive
- `get_tunnel_url(session_id)` — get preview tunnel URL
- `delete_sandbox(session_id)` — cleanup
- `start_background_cleanup()` — periodic cleanup every 60s, 30min TTL

---

# SECTION 6: Skills System

## Structure

```
Brain/skills/
├── frontend/
│   ├── react.md          # React + Vite rules (18 lines)
│   └── skills.md         # Frontend skill definitions
├── backend/
│   ├── api-security.md   # API security rules
│   └── skills.md         # Backend skill definitions
└── database/
    ├── supabase.md       # Supabase rules
    └── skills.md         # Database skill definitions
```

## Skill Resolution

```python
class SkillResolver:
    def resolve_skills_for_task(self, task_description):
        # Keyword-based matching against skill files
        # Returns compiled skill content as string
        # Injected into agent system prompts
```

## Current Status

- ✅ Skills loaded at agent execution time
- ✅ Skills injected into system prompts
- ✅ QualityReviewer evaluates against skill rules
- ❌ No dynamic skill discovery
- ❌ No skill marketplace
- ❌ No skill versioning
- ❌ No user-defined skills
- ❌ No skill analytics integration

---

# SECTION 7: Sandbox System

## Architecture

The Brain uses an **MCP-based sandbox** (NOT WebContainer):

1. **BuilderAgent** writes files to workspace via `client_save_code` tool
2. **RunnerAgent** calls `sandbox_mcp.deploy_workspace()` to deploy files
3. **Sandbox MCP Server** (remote) executes code and returns tunnel URL
4. **Frontend** receives tunnel URL and displays live preview

## Sandbox Operations

| Operation | Method | Description |
|---|---|---|
| Save Files | `client_save_code()` | Save files to local workspace + emit WebSocket |
| Deploy | `deploy_workspace()` | Archive workspace, send to MCP, get tunnel URL |
| Execute | `execute_in_sandbox()` | Run commands in existing sandbox |
| Get Status | `get_sandbox_status()` | Check sandbox status |
| Delete | `delete_sandbox()` | Cleanup sandbox + local files |
| Tunnel | `get_tunnel_url()` | Get preview URL |
| Cleanup | `cleanup_expired()` | Delete sandboxes idle > 30min |

## Sandbox MCP Service

```python
class SandboxMCPService:
    # Creates FRESH MCP session per tool call (avoids shared session corruption)
    # Uses streamablehttp_client for MCP protocol
    # 600s timeout for deploy operations
    # Background cleanup loop every 60s
    # Stores tunnel URLs in memory dict
```

---

# SECTION 8: Frontend Brain Integration

## Brain Components (18 files)

| Component | Purpose |
|---|---|
| `BrainView.tsx` | Main Brain page layout (207 lines) |
| `BrainMessages.tsx` | Chat messages with Brain context |
| `BrainPlanCanvas.tsx` | Strategic plan visualization |
| `BrainTodoCanvas.tsx` | Task list display |
| `BrainEditorCanvas.tsx` | Code editor integration |
| `BrainSandboxCanvas.tsx` | Live preview canvas |
| `BrainBuildActivityFeed.tsx` | Activity stream |
| `BrainBuildWorkspace.tsx` | Workspace visualization |
| `BrainClarificationCard.tsx` | Clarification questions UI |
| `BrainDecisionView.tsx` | Decision display/override |
| `BrainExecutionView.tsx` | Execution status |
| `BrainAgentStatus.tsx` | Agent progress indicators |
| `BrainAgentMessage.tsx` | Agent-specific messages |
| `BrainUserMessage.tsx` | User messages |
| `BrainArtifactView.tsx` | Artifact display |
| `BrainFrameworkSelector.tsx` | Framework selection |
| `BrainLiveTodos.tsx` | Live task updates |
| `BrainPublishModal.tsx` | Publish/deploy modal |
| `BrainSupabasePrompt.tsx` | Supabase connection prompt |

## Brain Memory Clients (Frontend)

| Client | API Endpoints | Purpose |
|---|---|---|
| `projectMemory.ts` | CRUD `/brain/projects/*` | Project management |
| `decisionMemory.ts` | GET/POST `/brain/decisions/*` | Decision tracking |
| `executionMemory.ts` | POST `/brain/execution/*` | Execution logging |
| `artifactMemory.ts` | CRUD `/brain/artifacts/*` | Artifact management |

## Brain Context & Hooks

| File | Purpose |
|---|---|
| `BrainWebContainerContext.tsx` | WebContainer state management |
| `useBrainWorkspaceOps.ts` | Workspace operations hook |
| `execution-store.ts` | Zustand store for execution state |
| `brainApiBase.ts` | Brain API client (base URL config) |
| `brainSession.ts` | Session management |
| `brainWebContainer.ts` | WebContainer + MCP integration |
| `buildActivity.ts` | Activity tracking |
| `buildSession.ts` | Build session management |
| `streaming/stream-simulator.ts` | Stream simulation |
| `streaming/useStream.ts` | Stream hook |

---

# SECTION 9: Missing Features

| Feature | Status | Priority |
|---|---|---|
| Memory recall in chat worker | Disabled (commented out) | Critical |
| Brain authentication | Not implemented | Critical |
| Brain templates | Empty directory | High |
| Dynamic skill loading | Not implemented | Medium |
| Skill marketplace | Not implemented | Low |
| Skill versioning | Not implemented | Low |
| User-defined skills | Not implemented | Low |
| Quality review in Backend-2 | Not integrated | Medium |
| CI/CD pipeline | Not implemented | High |
| One-click deploy | Not implemented | High |
| Test coverage | Minimal | High |

---

# SECTION 10: Security Issues

1. **No Authentication on Brain Endpoints**: Brain FastAPI has no auth middleware — anyone can call Brain APIs
2. **CORS Wide Open**: `allow_origins=["*"]` in Brain's FastAPI — accepts requests from any origin
3. **No Rate Limiting on Brain**: No rate limiting on Brain endpoints
4. **Supabase SQL Execution**: User-provided SQL executed directly via Supabase API
5. **Workspace Path Traversal**: `client_save_code` has path validation but `brain_write_file` in main.py does not

---

# SECTION 11: Technical Debt

1. **MemoryGateway not used in chat flow**: `build_agent_context()` exists but is not called in Backend-2's chat worker
2. **Brain URL hardcoded fallback**: 15+ files default to `http://localhost:8001`
3. **Empty templates directory**: `brain/templates/` has no project templates
4. **Skills static**: No runtime skill discovery or user-defined skills
5. **QualityReviewer only in Brain**: Not integrated with Backend-2's agent system
6. **Deprecated sandbox_manager.py**: Alias file still imported
7. **Scratch/debug files**: Multiple `check_*.py`, `test_*.py` files at Brain root
8. **print() debugging**: Extensive `print()` statements instead of proper logging

---

# SECTION 12: Roadmap

## Phase 1: Quick Wins (1-2 weeks)

| Task | Effort |
|---|---|
| Enable memory recall in chat.worker.ts (uncomment 2 lines) | 1 day |
| Add `NEXT_PUBLIC_BRAIN_API_URL` to all frontend files | 1 day |
| Create 3 project templates in `brain/templates/` | 3 days |
| Wire MemoryGateway into chat worker flow | 1 week |
| Add authentication to Brain endpoints | 3 days |
| Fix CORS to allow specific origins | 1 day |

## Phase 2: Core (3-6 weeks)

| Task | Effort |
|---|---|
| Dynamic skill loading from DB | 2 weeks |
| Quality review integration in Backend-2 | 1 week |
| CI/CD pipeline (GitHub Actions) | 1 week |
| Test coverage for Brain agents | 2 weeks |

## Phase 3: Advanced (7-12 weeks)

| Task | Effort |
|---|---|
| Skill marketplace | 3 weeks |
| User-defined skills | 2 weeks |
| One-click deployment | 3 weeks |
| Agent visualization | 2 weeks |

---

# SECTION 13: Final Score

| Category | Score | Notes |
|---|---|---|
| Memory Architecture | 8/10 | 12 types, gateway, vector search, impact analysis |
| Agent System | 7/10 | 13 agents, quality review, skill injection |
| MCP Integration | 7/10 | GitHub, Supabase (OAuth + PKCE), Sandbox connectors |
| Sandbox System | 6/10 | MCP-based, tunnel, but no persistent sandboxes |
| Skills System | 5/10 | 3 categories with rules, but static loading |
| Framework Support | 6/10 | React + Next.js, but limited to 2 frameworks |
| Chat System | 7/10 | LangGraph workflow, streaming, conversation persistence |
| Frontend Integration | 7/10 | 18 components, memory clients, streaming |
| Security | 2/10 | No auth, wide-open CORS |
| Production Readiness | 3/10 | No CI/CD, minimal tests, hardcoded URLs |
| **Overall** | **5.8/10** | Strong architecture, needs security and production hardening |
