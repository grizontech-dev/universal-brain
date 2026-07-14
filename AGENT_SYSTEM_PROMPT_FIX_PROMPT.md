# Grizon AI / BuilderBrain — Agent System Prompt Audit & Fix Prompt

Copy everything below this line and paste it into ChatGPT, Claude, or any other AI to get them to understand and fix your agent system prompts.

---

## SYSTEM CONTEXT

I have a Python-based AI agent system called "BuilderBrain" (part of Grizon AI) that builds full-stack web applications from user prompts. The system uses LangChain + OpenAI GPT-5.4 models, runs in Docker, and generates React + Express + Supabase code.

### Project Structure
- **Backend (Python Brain)**: `grizon-ai-backend-2-main/Brain/`
- **Frontend (Next.js)**: `Grizon-AI-Frontend-v2-api-2/`

### Agent Pipeline (Actual Implementation)
The pipeline is: Manager → Questions (if needed, max 2 rounds) → Planner → Todo → Builder → Runner → Watcher → Reporter

### Actual Agents in Codebase
1. **ManagerAgent** (`Brain/agents/manager/manager_agent.py`) — Analyzes user intent, decides: more questions or go to planner
2. **QuestionsAgent** (`Brain/agents/questions/questions_agent.py`) — Asks clarifying questions
3. **PlannerAgent** (`Brain/agents/planner/planner_agent.py`) — Creates technical architecture/plan
4. **TodoAgent** (`Brain/agents/todo/todo_agent.py`) — Converts plan into 3-15 executable tasks
5. **BuilderAgent** (`Brain/agents/builder/builder_agent.py`) — Main code generator, calls sub-agents
6. **FrontendAgent** (`Brain/sub_agents/frontend/frontend_agent.py`) — Generates React UI code
7. **BackendAgent** (`Brain/sub_agents/backend/backend_agent.py`) — Generates Express API code
8. **DatabaseAgent** (`Brain/sub_agents/database/database_agent.py`) — Generates Supabase SQL schemas
9. **RunnerAgent** (`Brain/agents/runner/runner_agent.py`) — Deploys to sandbox, starts dev servers
10. **WatcherAgent** (`Brain/agents/watcher/watcher_agent.py`) — Monitors deployment
11. **ReporterAgent** (`Brain/agents/reporter/reporter_agent.py`) — Generates build report
12. **ClarifierAgent** (`Brain/agents/clarifier_agent.py`) — Additional clarification
13. **LeaderAgent** (`Brain/agents/leader_agent.py`) — High-level coordination

### Key Files to Understand
- `Brain/shared/build_standards.py` — `FULL_STACK_BUILD_STANDARDS` constant injected into all agent prompts
- `Brain/shared/review_loop.py` — `QualityReviewer` class that validates generated code
- `Brain/agents/builder/builder_agent.py` — BuilderAgent with `_validate_saved_files()` post-save validation
- `Brain/shared/todo_agent.py` — TodoAgent with `INTEGRATION_TASK_TEMPLATE`
- `Brain/shared/frontend_entry.py` — APP_TSX template and normalization
- `Brain/services/provider_router.py` — Routes to OpenAI/DeepSeek/Gemini models
- `Brain/modules/chat/service.py` — Main orchestrator pipeline with LangGraph + streaming

### Tech Stack
- **AI Models**: GPT-5.4 (Manager, Questions, Planner, Todo, Builder), DeepSeek (sub-agents: Frontend, Backend, Database, Runner, Watcher, Reporter)
- **Backend Framework**: Python FastAPI on port 8001 (Docker)
- **Frontend Framework**: React + Vite + Tailwind CSS
- **Database**: Supabase (via company-owned proxy)
- **Code Execution**: Remote sandbox MCP server (port 9999 for Vite)
- **Memory**: 14-layer memory system (Redis + PostgreSQL + Qdrant)

### Known Issues (What's Broken)
1. **Placeholder UI output**: AI generates `<h1>Home Page</h1>` instead of full styled components with Tailwind CSS
2. **Orphan components**: Agent creates 10+ component files but only imports 4-5 in App.jsx
3. **React Router v5 vs v6**: Agent generates `<Switch>` and `component={Home}` instead of `<Routes>` and `element={<Home />}`
4. **Missing package.json dependencies**: Agent imports `axios`, `lucide-react`, `@supabase/supabase-js` but forgets to add them to package.json
5. **App.jsx with zero imports**: Sometimes App.jsx imports NONE of the created components
6. **Review loop may not be blocking**: QualityReviewer checks exist but workspaces still produce invalid code

### What "Correct" Looks Like
- Full styled Tailwind CSS UI (hero, features, contact form, footer)
- All components imported and rendered in App.jsx
- React Router v6 syntax (`<Routes>`, `element={<Component />}`)
- All npm dependencies listed in package.json
- Vite running on port 9999 with HMR disabled
- Backend routes mounted in server.js

---

## YOUR TASK

Please analyze the agent system prompts in the codebase and produce CORRECTED system prompts that fix the known issues above. Specifically:

1. **Read and understand** the current system prompts in:
   - `Brain/agents/builder/builder_agent.py` (lines 304-326 for frontend, 328-339 for backend)
   - `Brain/sub_agents/frontend/frontend_agent.py` (lines 35-138)
   - `Brain/shared/build_standards.py` (FULL_STACK_BUILD_STANDARDS constant)
   - `Brain/shared/review_loop.py` (QualityReviewer class)
   - `Brain/agents/todo/todo_agent.py` (system_prompt in execute method)

2. **Identify the root causes** of why agents still produce bad code despite detailed instructions

3. **Produce corrected system prompts** that:
   - Are MORE explicit about React Router v6 syntax (with exact code examples)
   - FORBID placeholder UI with stronger language
   - REQUIRE App.jsx to import ALL created components
   - REQUIRE all npm dependencies to be added to package.json
   - Include validation checklists that agents must mentally verify before responding

4. **Ensure the prompts are compatible** with:
   - LangChain SystemMessage format
   - GPT-5.4 model (1M context window)
   - Tool calling (client_save_code tool)
   - JSON response format for sub-agents

Please output the corrected prompts as copy-pasteable Python code blocks that I can directly replace in the agent files.
