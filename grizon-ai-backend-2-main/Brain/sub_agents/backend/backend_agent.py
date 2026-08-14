from typing import Any, Dict
import os
import re
import json
import asyncio
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage, AIMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.agents.builder.mcp_tools import client_save_code
from Brain.services.provider_router import ProviderRouter
from Brain.shared.structured_spec import format_structured_spec
from Brain.shared.llm_retry import ainvoke_with_retry


class BackendAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Backend Agent",
            description="Specialized in Node.js and Express.js.",
            model_id="qwen/qwen3-coder"
        )
        # Instance-level cache — avoids cross-build skill contamination between concurrent users
        self._skill_cache: dict = {}
        self.skill_resolver = SkillResolver()
        self.llm = ProviderRouter.get_model("qwen/qwen3-coder", temperature=0.1)
        self.fallback_model = ProviderRouter.get_model("deepseek-v4-flash", temperature=0.1)
        self.bound_llm = self.llm.bind_tools([client_save_code])
        self.fallback_llm = self.fallback_model.bind_tools([client_save_code])

    async def _safe_tool_call(self, tool, args, config=None):
        try:
            if config:
                return await asyncio.wait_for(tool.ainvoke(args, config=config), timeout=30)
            else:
                return await asyncio.wait_for(tool.ainvoke(args), timeout=30)
        except Exception as e:
            return e

    def _build_system_prompt(self, task: Dict, skills_content: str) -> str:
        prompt = f"""You are a Senior Backend Engineer building production-grade Node.js + Express APIs.

═══ STACK ═══
- Runtime: Node.js 20 LTS
- Framework: Express.js 4.x
- Module system: CommonJS ONLY. Every file MUST use `require()` and `module.exports`. NEVER use `import`/`export`.
- Database: Supabase PostgreSQL via shared `tenant_connector_vault` table (JSONB pattern). No ORM.
- Env: dotenv for secrets. Never hardcode credentials.
- Port: `process.env.PORT || 3001`, bind `0.0.0.0`. Vite uses 9999; Express API uses 3001.

═══ FILE STRUCTURE (MANDATORY) ═══
```
backend/
  server.js              # App entry: middleware + route mounts + /health + /api/health
  routes/
    <feature>.js         # Express.Router only — NO business logic
  controllers/
    <feature>.js         # ALL business logic, DB queries, error handling
  supabase/
    client.js            # SINGLE shared Supabase client (create this first)
    schema.sql           # SQL migrations only
  package.json
```

═══ RULES (VIOLATION = BROKEN BUILD) ═══
0. PROJECT ARCHITECTURE OVERRIDES GENERIC SKILL FILES. This project uses Supabase + shared JSONB table pattern. NEVER use Mongoose, Prisma, Sequelize, TypeORM, or any other ORM/ODM. NEVER create domain-specific tables like users, todos, messages. ALL data goes through the shared `tenant_connector_vault` table or the Python Backend Proxy API.
1. For every required file:
   a. Generate the COMPLETE file with all logic — no placeholders, no TODOs, no stubs.
   b. Immediately call client_save_code.
   c. Never return file contents as plain text.
   d. One client_save_code call = one file.
   e. Save ALL required files before finishing.
2. CommonJS ONLY: `require()` / `module.exports`. NEVER `import`/`export`. If you see `import` in generated code, you have failed.
3. Routes in `backend/routes/<feature>.js`: define router, attach middleware, delegate to controller. Example:
   ```js
   const router = require('express').Router();
   const controller = require('../controllers/<feature>');
   router.get('/', controller.list);
   module.exports = router;
   ```
4. Controllers in `backend/controllers/<feature>.js`: async functions with try/catch. Return `{{ success: true, data }}` or `{{ success: false, error }}`.
5. server.js MUST be saved LAST. It imports routes and mounts them:
   ```js
   require('dotenv').config();
   const express = require('express');
   const app = express();
   app.use(express.json());
   // health endpoint (MANDATORY)
   app.get('/health', (req, res) => res.status(200).json({{ status: 'ok' }}));
   app.get('/api/health', (req, res) => res.status(200).json({{ status: 'ok' }}));
   // routes
   const featureRoutes = require('./routes/feature');
   app.use('/api/feature', featureRoutes);
   app.listen(process.env.PORT || 3001, '0.0.0.0');
   ```
6. Frontend contract: paths must match `/api/...` exactly. For every backend feature, choose ONE canonical route family and reuse it everywhere:
   - Feature route format: `/api/<resource>` using lowercase kebab-case plural nouns when natural, e.g. `/api/projects`, `/api/invoices`, `/api/contact-messages`.
   - Backend MUST mount the route in `server.js` and frontend MUST call the exact same path through `frontend/src/lib/api.js`.
   - Do not invent alternate paths for the same feature (`/api/task`, `/api/tasks`, `/api/todo-items`) across files.
   If, and only if, the task needs login/register/auth, create and mount:
   - `POST /api/auth/register`
   - `POST /api/auth/login`
   - optional `GET /api/auth/me`
   Never mount auth at only `/auth`, `/api/users/login`, or `/api/user/register`; those cause 404s.
7. ALL packages MUST be in backend/package.json. If you add a package, include it in the returned `commands`: `["cd backend && npm install"]`.
8. NEVER import browser Supabase client. Use server-side only.
   - If user has connected Supabase connector: direct table queries with `.from()`.
   - Otherwise: Python Backend Proxy with shared `tenant_connector_vault` table (JSONB pattern).
   - Never expose credentials to frontend code.
9. Shared Supabase client (`backend/supabase/client.js`) — create this FIRST if missing:
   ```js
   require('dotenv').config();
   const ws = require('ws');
   const supabaseLib = require('@supabase/supabase-js');
   const createClient = supabaseLib.createClient || supabaseLib;
   const SUPABASE_URL = process.env.SUPABASE_URL;
   const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
   module.exports = createClient(SUPABASE_URL, SUPABASE_KEY, {{
     global: {{ fetch }},
     realtime: {{ transport: ws }}
   }});
   ```
   From controllers use `require('../supabase/client')`. From files inside `backend/routes/` use `require('../supabase/client')`.
10. RESILIENT CONTROLLERS: ALWAYS wrap DB queries in try/catch. If DB table is not ready or returns error, return `{{ success: true, data: [] }}` instead of HTTP 500!
11. MANDATORY HEALTH ENDPOINT — Validation Gate will FAIL if missing:
    ```js
    app.get('/health', (req, res) => res.status(200).json({{ status: 'ok' }}));
    app.get('/api/health', (req, res) => res.status(200).json({{ status: 'ok' }}));
    ```
    Place it BEFORE all other route mounts, right after middleware setup.
12. Schema files go in `backend/supabase/*.sql`. No Supabase CLI commands.
13. AUTH IMPLEMENTATION (ONLY WHEN REQUESTED): Store app auth records in `tenant_connector_vault` using `schema_name = 'auth_users'` and JSONB fields such as email, name, passwordHash, role, createdAt. Never create a physical `users` table. Use bcryptjs for password hashing and jsonwebtoken for tokens; include both packages in `backend/package.json` when auth is generated.
14. UNIVERSAL CRUD CONTRACT: For any resource CRUD feature, expose list/create/update/delete under the chosen canonical `/api/<resource>` route family. Use that same route family in frontend API helpers and never call an unmounted path.

═══ QUALITY (NON-NEGOTIABLE) ═══
- Generate COMPLETE files. No placeholders. No `// TODO`. No `/* implement */`.
- If task needs routes + controllers + server.js update, generate ALL THREE in the correct order: routes first, controllers first, server.js last.
- Use async/await with try/catch in ALL controllers.
- Validate input at the controller level.
- Use proper HTTP status codes: 200/201 for success, 400 for bad input, 404 for not found, 500 for server errors (but catch these and return success: false).

{f"SKILL FILES (project-specific only — generic skillss files are excluded):{chr(10)}{skills_content}" if skills_content and skills_content != "{{}}" else ""}

═══ OUTPUT FORMAT ═══
Respond ONLY in JSON.
{{"files": [{{"path": "backend/...", "content": "..."}}, ...], "commands": [], "summary": "..."}}
"""
        return prompt

    def _get_skill_cache_key(self, task: Dict, task_description: str) -> str:
        """Generate granular cache key based on task sub-type."""
        base = task.get("category", "backend")
        desc_lower = task_description.lower()
        if any(kw in desc_lower for kw in ["auth", "login", "register", "jwt", "token", "oauth", "rbac", "permission"]):
            return f"{base}_auth"
        elif any(kw in desc_lower for kw in ["upload", "image", "file", "storage"]):
            return f"{base}_upload"
        elif any(kw in desc_lower for kw in ["payment", "stripe", "billing", "invoice"]):
            return f"{base}_payment"
        elif any(kw in desc_lower for kw in ["crud", "create", "read", "update", "delete", "list"]):
            return f"{base}_crud"
        elif any(kw in desc_lower for kw in ["websocket", "socket", "realtime", "notification"]):
            return f"{base}_realtime"
        else:
            return f"{base}_api"

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        executed = state.get("executed_tasks", [])[-3:]

        # Skill resolution with granular caching
        task_description = f"{task.get('title', '')} {task.get('description', '')}"
        # Only skip for truly trivial tasks — NOT auth, CRUD, payments, etc.
        simple_keywords = ["health check", "ping", "hello world", "single endpoint", "boilerplate"]
        is_simple = len(task_description) < 60 and any(kw in task_description.lower() for kw in simple_keywords)

        skills_content = "{}"
        if not is_simple:
            cache_key = self._get_skill_cache_key(task, task_description)
            if cache_key in self._skill_cache:
                skills_content = self._skill_cache[cache_key]
                print(f"[BACKEND] Using cached skills: {cache_key}", flush=True)
            else:
                try:
                    skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
                    if skills_content and skills_content.strip() not in ("{}", ""):
                        lines = skills_content.splitlines()
                        filtered_lines = [
                            line for line in lines
                            if not line.strip().lower().startswith("- skillss/")
                            and not line.strip().lower().startswith("skillss/")
                        ]
                        skills_content = "\n".join(filtered_lines)
                    self._skill_cache[cache_key] = skills_content
                    print(f"[BACKEND] Cached skills for: {cache_key}", flush=True)
                except Exception:
                    skills_content = "{}"

        system_prompt = self._build_system_prompt(task, skills_content)

        # server.js metadata — routes and imports only
        server_js_context = ""
        workspace_id = state.get("current_job_id")
        user_id = state.get("user_id")
        if workspace_id and not workspace_id.startswith("error:"):
            from Brain.services.workspace_manager import workspace_manager
            ws_root = workspace_manager.resolve_workspace_path(workspace_id, user_id=user_id)
            if ws_root:
                server_js_path = os.path.join(ws_root, "backend", "server.js")
                if os.path.exists(server_js_path):
                    try:
                        with open(server_js_path, "r", encoding="utf-8") as f:
                            content = f.read()
                        imports = [m.group(0) for m in re.finditer(r"const\s+\w+\s*=\s*require\(['\"].*?['\"]\)", content)]
                        mounts = [m.group(0) for m in re.finditer(r"app\.use\(['\"].*?['\"].*?\)", content)]
                        parts = []
                        if imports:
                            parts.append(f"Imports ({len(imports)}): " + "; ".join(imports[:6]))
                        if mounts:
                            parts.append(f"Mounts ({len(mounts)}): " + "; ".join(mounts[:8]))
                        parts.append(f"Lines: {len(content.splitlines())}")
                        server_js_context = f"\n\nCURRENT server.js: {' | '.join(parts)}\nUpdate server.js ONLY if this task changes routing. Otherwise leave it unchanged."
                    except Exception:
                        pass

        # Compact executed tasks context
        executed_context = ""
        if executed:
            summaries = [t.get("title", "task") for t in executed if t.get("status") == "completed"]
            executed_context = f"\nDone: {', '.join(summaries)}" if summaries else ""

        # Compact structured spec
        structured_hint = format_structured_spec(task)
        spec_context = f"\nSpec: {structured_hint[:800]}" if structured_hint else ""

        # Build compact user message
        user_content = (
            f"Task: {task.get('title')}\n"
            f"Description: {task.get('description', '')}\n"
            f"Acceptance: {task.get('acceptance_criteria', '')}"
            f"{spec_context}"
            f"{executed_context}"
            f"{server_js_context}"
        )

        msgs = [SystemMessage(content=system_prompt), HumanMessage(content=user_content)]

        print(f"[BACKEND] model=qwen/qwen3-coder | temp=0.1 | task={task.get('title', 'N/A')}", flush=True)

        active_llm = self.bound_llm
        fallback_llm = self.fallback_llm

        files_saved = set()
        max_iterations = 4
        fallback_tried = False

        for iteration in range(max_iterations):
            try:
                response = await ainvoke_with_retry(
                    active_llm, msgs, 90,
                    tag="BACKEND",
                    fallback_llm=fallback_llm if not fallback_tried else None,
                    max_retries=1,
                    backoff_base=2.0,
                    backoff_max=10.0,
                )
            except asyncio.TimeoutError:
                print(f"[BACKEND] Timeout after 90s (iteration {iteration+1})", flush=True)
                if not fallback_tried:
                    print(f"[BACKEND] ↻ Timeout — switching to deepseek-v4-flash permanently", flush=True)
                    active_llm = fallback_llm
                    fallback_tried = True
                    continue
                break
            except Exception as e:
                err_str = str(e)
                is_rate_limit = ("429" in err_str or "RateLimit" in type(e).__name__
                                 or "engine_overloaded" in err_str or "Model busy" in err_str)
                is_reasoning_error = "reasoning_content" in err_str
                if (is_rate_limit or is_reasoning_error) and not fallback_tried:
                    print(f"[BACKEND] ↻ LLM error ({'rate limit' if is_rate_limit else 'reasoning_content'}) — switching to fallback permanently", flush=True)
                    active_llm = fallback_llm
                    fallback_tried = True
                    continue
                print(f"[BACKEND] LLM error: {e}", flush=True)
                break

            msgs.append(response)

            if not response.tool_calls:
                last_content = response.content
                if isinstance(last_content, list):
                    last_content = str(last_content)
                is_empty = (
                    last_content is None
                    or (isinstance(last_content, str) and not last_content.strip())
                )
                if is_empty:
                    print(f"[BACKEND] ↻ Empty response (iteration {iteration+1}) — retrying with corrective prompt", flush=True)
                    msgs.append(SystemMessage(
                        content="Your previous response was empty. You MUST respond by calling the "
                               "client_save_code tool for EVERY file. Do not return plain text — make tool calls."
                    ))
                    continue
                parsed = self._format_json_response(last_content) if isinstance(last_content, str) else None
                if isinstance(parsed, dict) and "files" in parsed:
                    break
                print(f"[BACKEND] Malformed response (iteration {iteration+1}) — retrying with corrective prompt", flush=True)
                msgs.append(SystemMessage(
                    content="Your previous response was invalid JSON. You MUST respond by calling the "
                           "client_save_code tool for EVERY file. Do not return plain text — make tool calls."
                ))
                continue

            save_calls = [tc for tc in response.tool_calls if tc["name"] == "client_save_code"]

            if save_calls:
                save_configs = [{"configurable": {
                    "thread_id": state.get("current_job_id"),
                    "task_title": task.get("title", ""),
                    "user_id": state.get("user_id")
                }} for _ in save_calls]

                save_results = await asyncio.gather(*[
                    self._safe_tool_call(client_save_code, tc["args"], config)
                    for tc, config in zip(save_calls, save_configs)
                ], return_exceptions=True)

                for tc, result in zip(save_calls, save_results):
                    file_path = tc["args"].get("file_path", "")
                    code_content = tc["args"].get("code_content", "")
                    if isinstance(result, Exception):
                        print(f"[BACKEND] ✖ Failed: {file_path}: {result}", flush=True)
                        msgs.append(ToolMessage(content=f"Error: {result}", tool_call_id=tc["id"]))
                    else:
                        files_saved.add(file_path)
                        print(f"[BACKEND] ✓ Saved: {file_path} ({len(code_content)} chars)", flush=True)
                        msgs.append(ToolMessage(
                            content=f"Saved: {file_path} ({len(code_content)} chars)",
                            tool_call_id=tc["id"]
                        ))

            # The model produced no files this round —
            # nudge it to save NOW so it doesn't burn the whole iteration budget exploring.
            if not save_calls and iteration < max_iterations - 1:
                print(f"[BACKEND] ↻ No saves this round (tool_calls={len(response.tool_calls)}) — nudging to save files", flush=True)
                msgs.append(SystemMessage(
                    content="You explored the workspace, but you did NOT save any files. STOP exploring. "
                           "Use the client_save_code tool to save the required files NOW — every file, "
                           "one tool call each."
                ))

        if not files_saved:
            last_msg = msgs[-1] if msgs else None
            # Only LLM responses can contain JSON; tool result messages never do.
            if isinstance(last_msg, AIMessage):
                last_content = last_msg.content
                if isinstance(last_content, list):
                    last_content = str(last_content)
                if isinstance(last_content, str) and last_content.strip():
                    parsed = self._format_json_response(last_content)
                    if isinstance(parsed, dict) and "files" in parsed:
                        return parsed

        result = {"files": [{"path": f, "content": ""} for f in sorted(files_saved)], "summary": f"Saved {len(files_saved)} files via tool calls"}
        print(f"[BACKEND] Result: files={len(result['files'])} paths={[f['path'] for f in result['files']]}", flush=True)
        return result
