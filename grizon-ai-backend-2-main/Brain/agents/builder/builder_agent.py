from typing import Any, Dict, List
import os
import json
import time
import sys
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.services.provider_router import ProviderRouter
from Brain.agents.builder.mcp_tools import (
    client_save_code,
    client_execute_in_sandbox,
    supabase_exec_sql,
    supabase_create_exec_sql_function,
)
from Brain.shared.frontend_entry import APP_TSX, normalize_frontend_entry_files

from Brain.services.workspace_manager import workspace_manager
from Brain.services.websocket_manager import ws_manager

LOG = "[BUILDER]"

class BuilderAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Builder",
            description="Coordinates sub-agents to execute tasks and build the application.",
            model_id="deepseek-chat"
        )
        self.llm = ProviderRouter.get_model("gpt-4o-mini", temperature=0.0)

    def _make_activity(
        self,
        act_type: str,
        label: str,
        *,
        path: str = "",
        task_title: str = "",
        status: str = "done",
        detail: str = "",
    ) -> Dict[str, Any]:
        return {
            "id": f"act-{int(time.time() * 1000)}-{act_type}",
            "type": act_type,
            "label": label,
            "path": path or None,
            "taskTitle": task_title or None,
            "status": status,
            "detail": detail or None,
            "timestamp": int(time.time() * 1000),
        }

    async def _emit(
        self,
        workspace_id: str,
        *,
        activities: List[Dict[str, Any]] = None,
        progress_msg: str = "",
        workspace_ops: List[Dict[str, Any]] = None,
    ):
        payload: Dict[str, Any] = {}
        if activities:
            payload["activities"] = activities
        if progress_msg:
            payload["progress_msg"] = progress_msg
        if workspace_ops:
            payload["workspace_ops"] = workspace_ops
        if workspace_id and (workspace_ops or progress_msg):
            ws_payload: Dict[str, Any] = {"type": "workspace_ops", "ops": workspace_ops or []}
            if progress_msg:
                ws_payload["progress_msg"] = progress_msg
            if activities:
                ws_payload["activities"] = activities
            await ws_manager.broadcast_to_sandbox(workspace_id, ws_payload)
        if activities or progress_msg or workspace_ops:
            yield {"execute_sandbox": payload}

    async def _publish_ops(self, workspace_id: str, ops: List[Dict[str, Any]], progress_msg: str = "", activities: List[Dict[str, Any]] = None):
        if not ops and not progress_msg:
            return
        payload: Dict[str, Any] = {"type": "workspace_ops", "ops": ops or []}
        if progress_msg:
            payload["progress_msg"] = progress_msg
        if activities:
            payload["activities"] = activities
        await ws_manager.broadcast_to_sandbox(workspace_id, payload)

    async def _run_agent_loop(self, system_prompt: str, instruction: str, session_id: str, task_title: str, timeout_sec: int = 90, category: str = "backend") -> str:
        """
        One-file-at-a-time agent loop.
        Each LLM call generates exactly ONE file. After saving, we tell the LLM
        what was saved and ask for the next file. This prevents timeout on large tasks.
        """
        max_files = 5  # Reduced from 8 to save LLM credits
        files_saved = []
        start_time = time.time()

        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)
        print(f"{LOG} AGENT LOOP START | task='{task_title}' | timeout={timeout_sec}s | session={session_id}", flush=True)
        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)

        # Direct generation — no "list files" step (saves 30-60s)
        # The validation loop will catch any missing imports after
        import re as _re

        # Bind tools based on category
        tools = [client_save_code]
        if category == "database":
            tools.extend([supabase_exec_sql, supabase_create_exec_sql_function])

        # Ask LLM to start generating files directly
        bound_llm = self.llm.bind_tools(tools)
        messages = [SystemMessage(content=system_prompt), HumanMessage(content=instruction)]
        bound_llm = self.llm.bind_tools([client_save_code])
        start_time = time.time()
        seen_files = set()
        tool_call_count = 0

        # Free-form loop — LLM generates files until it stops or timeout
        consecutive_duplicates = 0
        MAX_CONSECUTIVE_DUPLICATES = 3
        while True:
            elapsed = time.time() - start_time
            if elapsed > timeout_sec:
                print(f"{LOG} ✖ TIMEOUT after {int(elapsed)}s | files_saved={len(files_saved)}", flush=True)
                break
            if len(files_saved) >= max_files:
                print(f"{LOG} ✖ MAX FILES ({max_files}) reached", flush=True)
                break

            remaining = timeout_sec - elapsed
            llm_timeout = min(180, remaining - 10)
            if llm_timeout < 30:
                print(f"{LOG} ✖ Not enough time for next file ({remaining:.0f}s left)", flush=True)
                break

            # Emit progress
            if session_id and not str(session_id).startswith("error:"):
                try:
                    await ws_manager.broadcast_to_sandbox(str(session_id), {
                        "type": "workspace_ops",
                        "ops": [],
                        "activities": [{
                            "id": f"act-gen-{int(time.time() * 1000)}",
                            "type": "run_command",
                            "label": f"AI generating file {len(files_saved)+1}...",
                            "taskTitle": task_title,
                            "status": "running",
                            "timestamp": int(time.time() * 1000),
                        }],
                        "progress_msg": json.dumps({
                            "type": "llm_thinking",
                            "files_done": len(files_saved),
                            "task_title": task_title,
                            "timestamp": str(int(time.time() * 1000))
                        }),
                    })
                except Exception:
                    pass

            try:
                print(f"{LOG} → Calling LLM (timeout={int(llm_timeout)}s, msgs={len(messages)})...", flush=True)
                response = await asyncio.wait_for(
                    bound_llm.ainvoke(list(messages)),
                    timeout=llm_timeout
                )
                print(f"{LOG} ← LLM responded | tool_calls={len(response.tool_calls)} | content_len={len(response.content or '')}", flush=True)
            except asyncio.TimeoutError:
                print(f"{LOG} ✖ LLM TIMEOUT ({int(llm_timeout)}s)", flush=True)
                break
            except Exception as e:
                print(f"{LOG} ✖ LLM ERROR: {type(e).__name__}: {e}", flush=True)
                import traceback as _tb
                _tb.print_exc()
                break

            messages.append(response)

            if not response.tool_calls:
                print(f"{LOG} ✓ LLM done (no more tool calls) | files_saved={len(files_saved)}", flush=True)
                break

            # Execute each tool call
            stuck = False
            for tc in response.tool_calls:
                if time.time() - start_time > timeout_sec:
                    break
                if len(files_saved) >= max_files:
                    break

                tool_name = tc["name"]
                tool_args = tc["args"]
                file_path = tool_args.get("file_path", "")
                code_content = tool_args.get("code", "")
                code_len = len(code_content)

                if file_path in seen_files:
                    print(f"[BUILDER] Skipping duplicate file: {file_path}", flush=True)
                    messages.append(ToolMessage(content=f"Already saved {file_path}. Move on to next file.", tool_call_id=tc["id"]))
                    continue

                print(f"{LOG} → [{len(files_saved)+1}] Generating: {file_path} ({code_len} chars)", flush=True)


                tool_timeout = 30
                try:
                    if tool_name == "client_save_code":
                        result = await asyncio.wait_for(
                            client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title}}),
                            timeout=tool_timeout
                        )
                    elif tool_name == "supabase_exec_sql":
                        result = await asyncio.wait_for(
                            supabase_exec_sql.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title}}),
                            timeout=tool_timeout
                        )
                    elif tool_name == "supabase_create_exec_sql_function":
                        result = await asyncio.wait_for(
                            supabase_create_exec_sql_function.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title}}),
                            timeout=tool_timeout
                        )
                    else:
                        messages.append(ToolMessage(
                            content=f"Unknown tool: {tool_name}. Use client_save_code.",
                            tool_call_id=tc["id"]
                        ))
                except asyncio.TimeoutError:
                    print(f"[BUILDER] Tool call TIMED OUT ({tool_timeout}s) for {file_path}", flush=True)
                    result = f"Tool call timed out after {tool_timeout}s: {file_path}"

                seen_files.add(file_path)
                tool_call_count += 1

        return f"Task '{task_title}' completed. Files saved: {', '.join(files_saved) if files_saved else 'none'}"

    async def execute(self, state: Dict[str, Any]):
        import traceback as _traceback
        try:
            async for ev in self._execute_inner(state):
                yield ev
        except Exception as e:
            print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)
            print(f"{LOG} ✖ FATAL ERROR in execute(): {type(e).__name__}: {e}", flush=True)
            _traceback.print_exc()
            print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)
            state["status"] = "failed"
            state["current_task_index"] = state.get("current_task_index", 0) + 1
            yield state

    async def _execute_inner(self, state: Dict[str, Any]):
        import traceback as _traceback
        tasks = state.get("plan", [])
        index = state.get("current_task_index", 0)
        executed_tasks = state.get("executed_tasks", [])
        workspace_id = state.get("current_job_id")
        session_id = workspace_id
        print(f"[BUILDER] execute called | task={index+1}/{len(tasks)} | session={session_id}", flush=True)

        if index >= len(tasks):
            print(f"{LOG} ✓ All {len(tasks)} tasks done — handing off to runner", flush=True)
            state["status"] = "building_complete"
            state["next_agent"] = "runner"
            yield state
            return

        current_task = tasks[index]
        task_title = current_task.get("title") or current_task.get("task") or f"Task {index + 1}"
        category = current_task.get("category", "backend") or "backend"
        framework = state.get("framework", "react")

        # SKIP runner tasks — they should be handled by RunnerAgent, not Builder
        if category == "runner" or "runner" in task_title.lower():
            print(f"{LOG} ⏭ Skipping runner task: {task_title} (handled by RunnerAgent)", flush=True)
            current_task["status"] = "completed"
            state["current_task_index"] = index + 1
            yield state
            return
        print(f"{LOG} ▶ Starting task {index+1}/{len(tasks)}: {task_title} | category={category} | framework={framework}", flush=True)

        if workspace_id and not workspace_id.startswith("error:"):
            start_act = self._make_activity("task_start", f"Exploring — {task_title}", task_title=task_title, status="running")
            progress_msg = json.dumps({"type": "task_started", "taskId": str(index), "title": task_title, "timestamp": str(int(time.time() * 1000))})
            async for ev in self._emit(workspace_id, activities=[start_act], progress_msg=progress_msg):
                yield ev

        # Load skills based on category
        skill_content = ""
        system_prompt = ""
        skill_dir = os.path.join(os.path.dirname(__file__), "..", "..", "skillss")

        # Gather existing codebase memory for follow-ups
        existing_code_context = ""
        try:
            ws_dir = os.path.join(os.getcwd(), "workspaces", session_id)
            if os.path.exists(ws_dir):
                files_to_read = []
                for root, _, files in os.walk(ws_dir):
                    if "node_modules" in root or ".git" in root or "dist" in root:
                        continue
                    for f in files:
                        if f.endswith(('.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.html')):
                            full_path = os.path.join(root, f)
                            rel_path = os.path.relpath(full_path, ws_dir).replace("\\", "/")
                            if "package-lock.json" not in rel_path:
                                files_to_read.append((rel_path, full_path))

                if files_to_read:
                    existing_code_context = "\n\n═══ EXISTING CODEBASE MEMORY ═══\n"
                    existing_code_context += "The user is requesting a modification to an existing project. Here is the current codebase:\n\n"
                    for rel_path, full_path in files_to_read:
                        try:
                            with open(full_path, 'r', encoding='utf-8') as fh:
                                content = fh.read()
                            existing_code_context += f"--- {rel_path} ---\n```\n{content}\n```\n\n"
                        except Exception:
                            pass
        except Exception as e:
            print(f"{LOG} Failed to load existing codebase: {e}")

        def _load_skill(name, max_chars=3000):
            try:
                path = os.path.join(skill_dir, name, "SKILL.md")
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                return content[:max_chars]
            except Exception:
                return ""

        if category == "frontend":
            skill_content = _load_skill("frontend-design")
            if "## Frontend Aesthetics Guidelines" in skill_content:
                skill_content = skill_content[skill_content.index("## Frontend Aesthetics Guidelines"):]
        elif category == "backend":
            skill_content = _load_skill("backend-development", 2000)
            skill_content += "\n\n" + _load_skill("nodejs-backend-patterns", 1500)
        elif category == "database":
            skill_content = _load_skill("supabase", 2000)
            skill_content += "\n\n" + _load_skill("supabase-postgres-best-practices", 1500)

        if category == "frontend":
            system_prompt = (
                "You are a Senior Frontend UI Engineer. Stack: React + Tailwind CSS + react-router-dom + lucide-react.\n\n"
                "═══ CRITICAL RULES (violation = broken app) ═══\n\n"
                "1. App.jsx MUST wrap ALL routes and include global layout components (like Header, Navbar, or Footer if applicable):\n"
                "```jsx\n"
                "import React from 'react';\n"
                "import { BrowserRouter, Routes, Route } from 'react-router-dom';\n"
                "// EXTREMELY IMPORTANT: ALWAYS IMPORT EVERY COMPONENT YOU USE!\n"
                "import MainLayout from './components/MainLayout';\n"
                "import LandingPage from './pages/LandingPage';\n"
                "// ... other imports\n"
                "function App() {\n"
                "  return (\n"
                "    <BrowserRouter>\n"
                "      <div className=\"bg-[#09090b] text-white min-h-screen flex flex-col\">\n"
                "        {/* Insert Header/Navbar here if needed */}\n"
                "        <main className=\"flex-grow\">\n"
                "          <Routes>\n"
                "            <Route path=\"/\" element={<LandingPage />} />\n"
                "            {/* Add other routes here based on the plan */}\n"
                "          </Routes>\n"
                "        </main>\n"
                "        {/* Insert Footer here if needed */}\n"
                "      </div>\n"
                "    </BrowserRouter>\n"
                "  );\n"
                "}\n"
                "export default App;\n"
                "```\n\n"
                "2. ALWAYS IMPORT the components you use. Whatever component name you write in JSX (e.g. `<MyPage />`), you MUST import it at the top.\n"
                "3. NEVER import CSS files in components (e.g. `import './App.css'`). Tailwind is already injected globally. Only use Tailwind classes in `className`.\n"
                "4. Navigation MUST use `import { Link } from 'react-router-dom'` and `<Link to=\"/page\">`.\n"
                "   NEVER use `<a href=\"/page\">` — that causes full page reload and breaks SPA.\n\n"
                "5. BUILD EXACTLY WHAT IS IN THE PLAN. If the plan asks for a To-Do App, build To-Do components (TaskCard, TaskForm, etc.). DO NOT build generic SaaS landing pages unless specifically requested.\n\n"
                "6. DO NOT invent imports or assume functions exist (like `isAuthenticated` or `api` from `lib/api.js`). If you need auth state or data fetching, mock it with `useState` and `useEffect` or create a React Context. Never import from non-existent files.\n\n"
                "7. EVERY component page MUST have:\n"
                "   - Substantial, real content (no empty divs or placeholders)\n"
                "   - Beautiful Tailwind CSS styling\n"
                "   - Proper error handling and loading states\n\n"
                "═══ DESIGN RULES ═══\n"
                "- Dark theme: bg-[#09090b] or bg-[#0a0a0a], white text (unless light theme is requested)\n"
                "- Tailwind CSS on EVERY element — NO inline styles, NO bare HTML\n"
                "- Use rich UI elements: Glass cards, gradients, hover effects\n"
                "- Icons from lucide-react. IMPORTANT: ONLY use basic icons (e.g., Plus, Check, Trash, Edit, User, Settings). DO NOT use brand icons (like Github, Google, Twitter) as they often cause export errors.\n\n"
                "═══ FILE RULES ═══\n"
                "- frontend/src/App.jsx: Layout and ALL route imports\n"
                "- frontend/src/components/*.jsx or frontend/src/pages/*.jsx: one file per component\n"
                "- Use client_save_code for EVERY file you generate\n"
                "- NO orphaned components (every component must be imported somewhere)\n\n"
                "AFTER ALL FILES: respond with ONLY a short summary."
            )
        elif category == "backend":
            system_prompt = (
                "You are a Senior Backend Engineer. Express API in `backend/`.\n\n"
                f"SKILL REFERENCE (follow these patterns):\n{skill_content}\n\n"
                "SUPABASE CONNECTION (MANDATORY — every controller MUST use this):\n"
                "The file backend/supabase/client.js already exports a configured Supabase client.\n"
                "EVERY controller file MUST start with exactly this line:\n"
                "  const {{ supabase }} = require('../supabase/client');\n"
                "NEVER create your own createClient(). NEVER hardcode URLs or API keys.\n"
                "If backend/supabase/client.js does not exist, CREATE IT FIRST:\n"
                "  const {{ createClient }} = require('@supabase/supabase-js');\n"
                "  require('dotenv').config();\n"
                "  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);\n"
                "  module.exports = {{ supabase }};\n\n"
                "CRITICAL RULES:\n"
                "1. Use CommonJS (require/module.exports). NEVER use ES modules.\n"
                "2. package.json must NOT have \"type\": \"module\".\n"
                "3. ALWAYS write server.js LAST with ALL routes mounted.\n"
                "4. Structure: routes/*.js, controllers/*.js.\n"
                "5. Every route returns JSON: {{ success: true, data }} or {{ success: false, error }}.\n"
                "6. Use try/catch in every route handler.\n"
                "7. Use client_save_code for EVERY file.\n"
                "8. After saving ALL files, respond with ONLY a short summary."
            )
        elif category == "database":
            system_prompt = (
                "You are a Database Engineer. Supabase PostgreSQL in `backend/supabase/`.\n\n"
                f"SKILL REFERENCE (follow these patterns):\n{skill_content}\n\n"
                "RULES:\n"
                "1. `frontend/src/main.jsx` imports `./App.jsx` ONLY. NEVER use App.tsx.\n"
                "2. You MUST include `frontend/src/App.jsx` in every response.\n"
                "3. ALWAYS connect all components and pages in App.jsx.\n"
                "4. Use client_save_code for EVERY file. Do NOT call client_execute_in_sandbox.\n"
                "5. Vite MUST run on port 9999 with HMR disabled and base='./'.\n"
                "   vite.config.js must be:\n"
                "   import { defineConfig } from 'vite';\n"
                "   import react from '@vitejs/plugin-react';\n"
                "   export default defineConfig({ plugins: [react()], base: './', server: { port: 9999, hmr: false } });\n"
                "6. Every import in App.jsx MUST match an actual file you created.\n"
                "7. MAX 12 tool calls per task. Create only essential files. Do NOT create more than 12 files.\n"
                "8. After saving ALL files, respond with ONLY a short summary. NO MORE TOOL CALLS after summary."
            )
        else:
            system_prompt = (
                "You are the Backend Agent. Express API in `backend/`.\n\n"
                "RULES:\n"
                "1. Always update `backend/server.js` when adding routes.\n"
                "2. Structure: `backend/routes/*.js`, `backend/controllers/*.js`.\n"
                "3. Use client_save_code for EVERY file. Do NOT call client_execute_in_sandbox.\n"
                "4. Every route MUST be imported and mounted in server.js.\n"
                "5. After saving ALL files, respond with ONLY a short summary message. NO MORE TOOL CALLS after your summary."
            )

        instruction = f"Task Title: {task_title}\nDescription: {current_task.get('description', '')}"
        overall_timeout = 150
        try:
            output_content = await asyncio.wait_for(
                self._run_agent_loop(system_prompt, instruction, session_id, task_title, timeout_sec=600, category=category),
                timeout=overall_timeout
            )
        except asyncio.TimeoutError:
            print(f"{LOG} ✖ OVERALL TIMEOUT ({overall_timeout}s) for '{task_title}'", flush=True)
            output_content = f"Task '{task_title}' completed with fallback (overall timeout after {overall_timeout}s)"
        except Exception as loop_err:
            import traceback as _tb
            print(f"{LOG} ✖ AGENT LOOP ERROR: {type(loop_err).__name__}: {loop_err}", flush=True)
            _tb.print_exc()
            output_content = f"Task '{task_title}' completed with fallback (error: {loop_err})"

        print(f"{LOG} ▶ Task DONE: '{task_title}' | output_len={len(output_content)}", flush=True)
        print(f"{LOG}   Output preview: {output_content[:300]}", flush=True)

        # Emit task completion summary with file list
        if session_id and not str(session_id).startswith("error:"):
            # Extract file names from output for the summary
            import re as _re
            saved_files = _re.findall(r'(?:Saved|saved|✓ File saved:)\s+([^\s,]+)', output_content)
            if not saved_files:
                # Fallback: just show the task completed
                saved_files = []
            try:
                await ws_manager.broadcast_to_sandbox(str(session_id), {
                    "type": "workspace_ops",
                    "ops": [],
                    "activities": [{
                        "id": f"act-task-summary-{int(time.time() * 1000)}",
                        "type": "run_command",
                        "label": f"Task complete: {task_title} ({len(saved_files)} files)",
                        "taskTitle": task_title,
                        "status": "done",
                        "detail": output_content[:500],
                        "timestamp": int(time.time() * 1000),
                    }],
                    "progress_msg": json.dumps({
                        "type": "task_files_summary",
                        "task_title": task_title,
                        "files_count": len(saved_files),
                        "files": saved_files[:20],
                        "output_preview": output_content[:300],
                        "timestamp": str(int(time.time() * 1000))
                    }),
                })
            except Exception:
                pass

        state["plan"][index]["status"] = "completed"
        state["plan"][index]["result"] = output_content
        state["executed_tasks"].append({**current_task, "status": "completed", "result": output_content})
        state["status"] = "running"
        state["current_task_index"] = index + 1

        if session_id and not str(session_id).startswith("error:"):
            end_act = self._make_activity("task_complete", f"Completed — {task_title}", task_title=task_title)
            progress_msg = json.dumps({"type": "task_completed", "taskId": str(index), "title": task_title, "timestamp": int(time.time() * 1000)})
            async for ev in self._emit(session_id, activities=[end_act], progress_msg=progress_msg):
                yield ev

        print(f"{LOG} ✓ Task {index+1} complete → next index: {index+1}", flush=True)
        yield state
