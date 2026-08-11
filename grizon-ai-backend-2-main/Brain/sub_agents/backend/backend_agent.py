from typing import Any, Dict
import os
import re
import json
import asyncio
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.agents.builder.mcp_tools import client_save_code, read_skill_file
from Brain.services.provider_router import ProviderRouter
from Brain.shared.structured_spec import format_structured_spec


class BackendAgent(BaseAgent):
    _skill_cache = {}

    def __init__(self):
        super().__init__(
            name="Backend Agent",
            description="Specialized in Node.js and Express.js.",
            model_id="Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo"
        )
        self.skill_resolver = SkillResolver()
        self.llm = ProviderRouter.get_model("Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo", temperature=0.1)
        self.bound_llm = self.llm.bind_tools([client_save_code, read_skill_file])
        self.fallback_llm = ProviderRouter.get_model("deepseek-v4-flash", temperature=0.1).bind_tools([client_save_code, read_skill_file])

    async def _safe_tool_call(self, tool, args, config=None):
        try:
            if config:
                return await asyncio.wait_for(tool.ainvoke(args, config=config), timeout=30)
            else:
                return await asyncio.wait_for(tool.ainvoke(args), timeout=30)
        except Exception as e:
            return e

    def _build_system_prompt(self, task: Dict, skills_content: str) -> str:
        prompt = f"""You are a Senior Backend Engineer. Node.js + Express API in `backend/`.

═══ STACK ═══
- Express.js, CommonJS (require/module.exports). NEVER use ES modules.
- Supabase for DB (server-side only — no browser client).
- JSON responses: {{"success": true, "data": ...}} or {{"success": false, "error": "..."}}.

═══ RULES (VIOLATION = BROKEN BUILD) ═══
1. Use client_save_code for EVERY file. One tool call per file.
2. CommonJS only: require() / module.exports. NEVER import/export.
3. Routes: backend/routes/*.js, Controllers: backend/controllers/*.js
4. Use Express.Router in routes: module.exports = router;
5. ALWAYS update backend/server.js — import route + app.use('/api/...', routes)
6. Frontend contract: paths must match /api/... (POST /api/contact, GET /api/programs)
7. ALL packages MUST be in backend/package.json. Return "commands": ["cd backend && npm install"]
8. Port 9999, bind 0.0.0.0 — required for tunnel URL
9. NEVER import browser Supabase client. All DB access is server-side.
10. Supabase: check user's connected connector first, fallback to Python proxy.
11. Schema as backend/supabase/*.sql files only. No Supabase CLI.
12. Write server.js LAST with ALL routes mounted.

═══ SUPABASE PATTERNS ═══
- Shared Table + JSONB: one shared tenant-scoped table with JSONB payload, NOT one table per user.
- Keep payloads sparse, prune large blobs (500 MB free-tier limit).
- Document server-side env vars only. Never request user Supabase credentials.

═══ QUALITY (NON-NEGOTIABLE) ═══
Generate ALL files required for this task. Do NOT omit files to save tokens.
Batch them in one response (2-5 files). Quality is more important than response length.
If task needs routes + controllers + server.js update, generate ALL THREE.

{f"SKILL FILES (read via read_skill_file when needed):{chr(10)}{skills_content}" if skills_content and skills_content != "{{}}" else ""}

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
            if cache_key in BackendAgent._skill_cache:
                skills_content = BackendAgent._skill_cache[cache_key]
                print(f"[BACKEND] Using cached skills: {cache_key}", flush=True)
            else:
                try:
                    skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
                    BackendAgent._skill_cache[cache_key] = skills_content
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
                        server_js_context = f"\n\nCURRENT server.js: {' | '.join(parts)}\nOnly update server.js if this task changes routing. Otherwise leave it unchanged."
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

        print(f"[BACKEND] model=Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo | temp=0.1 | task={task.get('title', 'N/A')}", flush=True)

        files_saved = set()
        max_iterations = 3
        active_llm = self.bound_llm  # Start with Qwen; permanently switch to fallback on first 429
        fallback_tried = False

        for iteration in range(max_iterations):
            try:
                response = await asyncio.wait_for(active_llm.ainvoke(list(msgs)), timeout=60)
            except asyncio.TimeoutError:
                print(f"[BACKEND] Timeout after 60s (iteration {iteration+1})", flush=True)
                break
            except Exception as e:
                err_str = str(e)
                is_rate_limit = ("429" in err_str or "RateLimit" in type(e).__name__
                                 or "engine_overloaded" in err_str or "Model busy" in err_str)
                if is_rate_limit and not fallback_tried:
                    print(f"[BACKEND] ↻ Qwen rate-limited — switching to deepseek-v4-flash permanently", flush=True)
                    active_llm = self.fallback_llm
                    fallback_tried = True
                    continue  # retry immediately with fallback model
                print(f"[BACKEND] LLM error: {e}", flush=True)
                break

            msgs.append(response)

            if not response.tool_calls:
                # Empty or non-tool response — retry with a corrective message
                # instead of giving up and producing a 0-file "done" task.
                last_content = response.content
                if isinstance(last_content, list):
                    last_content = str(last_content)
                parsed = self._format_json_response(last_content) if isinstance(last_content, str) else None
                if isinstance(parsed, dict) and "files" in parsed:
                    break
                print(f"[BACKEND] Empty response (iteration {iteration+1}) — retrying with corrective prompt", flush=True)
                msgs.append(SystemMessage(
                    content="Your previous response was empty or invalid. You MUST respond by calling the "
                           "client_save_code tool for EVERY file. Do not return plain text — make tool calls."
                ))
                continue

            save_calls = [tc for tc in response.tool_calls if tc["name"] == "client_save_code"]
            skill_calls = [tc for tc in response.tool_calls if tc["name"] == "read_skill_file"]

            if skill_calls:
                skill_results = await asyncio.gather(*[
                    self._safe_tool_call(read_skill_file, tc["args"]) for tc in skill_calls
                ], return_exceptions=True)
                for tc, result in zip(skill_calls, skill_results):
                    if isinstance(result, Exception):
                        msgs.append(ToolMessage(content=f"Error: {result}", tool_call_id=tc["id"]))
                    else:
                        msgs.append(ToolMessage(content=result, tool_call_id=tc["id"]))

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

        if not files_saved:
            last_content = msgs[-1].content if msgs else ""
            if isinstance(last_content, list):
                last_content = str(last_content)
            parsed = self._format_json_response(last_content)
            if isinstance(parsed, dict) and "files" in parsed:
                return parsed

        result = {"files": [{"path": f, "content": ""} for f in sorted(files_saved)], "summary": f"Saved {len(files_saved)} files via tool calls"}
        print(f"[BACKEND] Result: files={len(result['files'])} paths={[f['path'] for f in result['files']]}", flush=True)
        return result
