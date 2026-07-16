from typing import Any, Dict, List
import os
import json
import time
import sys
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.services.provider_router import ProviderRouter
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from Brain.agents.builder.mcp_tools import client_save_code, client_execute_in_sandbox
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
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
        self.llm = ProviderRouter.get_model(os.getenv("DEFAULT_CODE_MODEL", "deepseek-coder"), temperature=0.0)

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

    async def _run_agent_loop(self, system_prompt: str, instruction: str, session_id: str, task_title: str, timeout_sec: int = 90) -> str:
        """
        One-file-at-a-time agent loop.
        Each LLM call generates exactly ONE file. After saving, we tell the LLM
        what was saved and ask for the next file. This prevents timeout on large tasks.
        """
        max_files = 8
        files_saved = []
        start_time = time.time()

        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)
        print(f"{LOG} AGENT LOOP START | task='{task_title}' | timeout={timeout_sec}s | session={session_id}", flush=True)
        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)

        # Direct generation — no "list files" step (saves 30-60s)
        # The validation loop will catch any missing imports after
        import re as _re

        # Ask LLM to start generating files directly
        bound_llm = self.llm.bind_tools([client_save_code])
        messages = [SystemMessage(content=system_prompt), HumanMessage(content=instruction)]

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
            for tc in response.tool_calls:
                if time.time() - start_time > timeout_sec:
                    break
                if len(files_saved) >= max_files:
                    break

                tool_name = tc["name"]
                tool_args = tc["args"]
                file_path = tool_args.get("file_path", "")
                code_len = len(tool_args.get("code_content", ""))

                # PATH CORRECTION: Fix common LLM path mistakes
                if file_path == "frontend/App.jsx":
                    file_path = "frontend/src/App.jsx"
                    tool_args["file_path"] = file_path
                    print(f"{LOG} ↻ Path corrected: frontend/App.jsx → frontend/src/App.jsx", flush=True)
                elif file_path.startswith("frontend/") and not file_path.startswith("frontend/src/") and not file_path.startswith("frontend/vite") and not file_path.startswith("frontend/tailwind") and not file_path.startswith("frontend/postcss") and file_path != "frontend/index.html" and file_path != "frontend/package.json":
                    # Any other file wrongly placed in frontend/ instead of frontend/src/
                    corrected = file_path.replace("frontend/", "frontend/src/", 1)
                    tool_args["file_path"] = corrected
                    file_path = corrected
                    print(f"{LOG} ↻ Path corrected: {tool_args.get('file_path', '')} → {file_path}", flush=True)

                # Skip duplicates
                if file_path in files_saved:
                    consecutive_duplicates += 1
                    print(f"{LOG} ⚠ Skip duplicate: {file_path} ({consecutive_duplicates}/{MAX_CONSECUTIVE_DUPLICATES})", flush=True)
                    messages.append(ToolMessage(content=f"Already saved {file_path}. Generate a DIFFERENT file that does not exist yet.", tool_call_id=tc["id"]))
                    if consecutive_duplicates >= MAX_CONSECUTIVE_DUPLICATES:
                        print(f"{LOG} ✖ BREAKING: {consecutive_duplicates} consecutive duplicates. LLM is stuck.", flush=True)
                        break
                    continue

                print(f"{LOG} → [{len(files_saved)+1}] Generating: {file_path} ({code_len} chars)", flush=True)

                tool_timeout = 30
                try:
                    if tool_name == "client_save_code":
                        result = await asyncio.wait_for(
                            client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title}}),
                            timeout=tool_timeout
                        )
                        files_saved.append(file_path)
                        consecutive_duplicates = 0
                        print(f"{LOG} ✓ [{len(files_saved)}] Saved: {file_path} ({code_len} chars)", flush=True)

                        # Emit file saved
                        if session_id and not str(session_id).startswith("error:"):
                            try:
                                await ws_manager.broadcast_to_sandbox(str(session_id), {
                                    "type": "workspace_ops",
                                    "ops": [],
                                    "activities": [{
                                        "id": f"act-saved-{int(time.time() * 1000)}",
                                        "type": "write_file",
                                        "label": f"Saved {file_path.split('/')[-1]}",
                                        "path": file_path,
                                        "taskTitle": task_title,
                                        "status": "done",
                                        "detail": f"{code_len} chars",
                                        "timestamp": int(time.time() * 1000),
                                    }],
                                    "progress_msg": json.dumps({
                                        "type": "file_saved",
                                        "file": file_path,
                                        "chars": code_len,
                                        "files_done": len(files_saved),
                                        "task_title": task_title,
                                        "timestamp": str(int(time.time() * 1000))
                                    }),
                                })
                            except Exception:
                                pass

                        # Tell LLM the file was saved
                        messages.append(ToolMessage(
                            content=f"Saved {file_path} ({code_len} chars). Generate the next file.",
                            tool_call_id=tc["id"]
                        ))
                    else:
                        messages.append(ToolMessage(
                            content=f"Unknown tool: {tool_name}. Use client_save_code.",
                            tool_call_id=tc["id"]
                        ))
                except asyncio.TimeoutError:
                    print(f"{LOG} ✖ Tool TIMEOUT for {file_path}", flush=True)
                    messages.append(ToolMessage(content=f"Timeout saving {file_path}", tool_call_id=tc["id"]))
                except Exception as e:
                    print(f"{LOG} ✖ Tool ERROR for {file_path}: {e}", flush=True)
                    messages.append(ToolMessage(content=f"Error saving {file_path}: {e}", tool_call_id=tc["id"]))

        # ═══════════════════════════════════════════════════════════════
        # VALIDATION LOOP: Scan ALL files for broken imports, auto-fix
        # ═══════════════════════════════════════════════════════════════
        print(f"{LOG} ═══ VALIDATION: Scanning for broken imports ═══", flush=True)
        fixed_files = await self._validate_and_fix_imports(
            session_id, task_title, files_saved, start_time, timeout_sec
        )

        # ═══════════════════════════════════════════════════════════════
        # BACKEND VALIDATION: Check server.js mounts all routes
        # ═══════════════════════════════════════════════════════════════
        await self._validate_backend_routes(session_id)
        files_saved.extend(fixed_files)

        # Summary
        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)
        print(f"{LOG} ✓ TASK DONE: '{task_title}' | files_saved={len(files_saved)}", flush=True)
        print(f"{LOG}   Files: {files_saved}", flush=True)
        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)

        return f"Task '{task_title}' completed. Files saved: {', '.join(files_saved)}"

    async def _validate_and_fix_imports(self, session_id, task_title, files_saved, start_time, timeout_sec):
        """Scan ALL .jsx/.js files for imports, check if imported files exist, generate missing ones."""
        import re as _re
        import os as _os
        fixed = []
        already_checked = set()

        if not files_saved:
            return fixed

        workspace_dir = _os.path.join(_os.getcwd(), "workspaces", session_id)
        frontend_src = _os.path.join(workspace_dir, "frontend", "src")

        if not _os.path.isdir(frontend_src):
            print(f"{LOG} ⚠ No frontend/src dir found", flush=True)
            return fixed

        # Collect ALL .jsx/.js files in frontend/src (components + pages + lib)
        all_jsx_files = []
        for root, dirs, files in _os.walk(frontend_src):
            for f in files:
                if f.endswith(('.jsx', '.js', '.tsx', '.ts')) and not f.startswith('main.'):
                    full = _os.path.join(root, f)
                    rel = _os.path.relpath(full, frontend_src).replace('\\', '/')
                    all_jsx_files.append((full, rel))

        print(f"{LOG} ═══ VALIDATION: Scanning {len(all_jsx_files)} files for broken imports ═══", flush=True)

        # Extract imports from ALL files
        import_pattern = _re.compile(r"import\s+(?:\w+|\{[^}]+\})\s+from\s+['\"]\.\/(components|pages|lib)\/(\w+)['\"]")
        missing = []

        for full_path, rel_path in all_jsx_files:
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception:
                continue

            imports = import_pattern.findall(content)
            for folder, name in imports:
                check_key = f"{folder}/{name}"
                if check_key in already_checked:
                    continue
                already_checked.add(check_key)

                # Check if file exists
                found = False
                for ext in ['.jsx', '.js', '.tsx', '.ts']:
                    candidate = _os.path.join(frontend_src, folder, f"{name}{ext}")
                    if _os.path.exists(candidate):
                        found = True
                        break

                if not found:
                    rel_missing = f"frontend/src/{folder}/{name}.jsx"
                    # Don't re-generate files we already fixed
                    if rel_missing not in fixed:
                        missing.append((rel_missing, name, folder, rel_path))
                        print(f"{LOG}   ✖ {rel_path} imports {name} → {rel_missing} MISSING", flush=True)
                else:
                    print(f"{LOG}   ✓ {rel_path} imports {name} → exists", flush=True)

        # ═══════════════════════════════════════════════════════════════
        # ORPHAN DETECTION: Find components not imported by any file
        # ═══════════════════════════════════════════════════════════════
        components_dir = _os.path.join(frontend_src, "components")
        if _os.path.isdir(components_dir):
            # Find all component files
            component_files = []
            for f in _os.listdir(components_dir):
                if f.endswith(('.jsx', '.js', '.tsx', '.ts')):
                    name = f.split('.')[0]
                    component_files.append(name)

            # Find all imports across ALL files
            all_imports = set()
            for full_path, rel_path in all_jsx_files:
                try:
                    with open(full_path, 'r', encoding='utf-8') as fh:
                        content = fh.read()
                    for match in _re.finditer(r"import\s+\w+\s+from\s+['\"]\.\/(?:components|pages)\/(\w+)['\"]", content):
                        all_imports.add(match.group(1))
                    # Also check ../components imports
                    for match in _re.finditer(r"import\s+\w+\s+from\s+['\"]\.\.\/(?:components|pages)\/(\w+)['\"]", content):
                        all_imports.add(match.group(1))
                except Exception:
                    continue

            # Find orphans
            orphans = [c for c in component_files if c not in all_imports]
            if orphans:
                print(f"{LOG} ⚠ {len(orphans)} orphaned components: {orphans}", flush=True)
                # Rewrite App.jsx to import ALL components
                app_jsx = _os.path.join(frontend_src, "App.jsx")
                if _os.path.exists(app_jsx):
                    # Build new App.jsx with all imports
                    imports = "\n".join([f"import {c} from './components/{c}';" for c in component_files])
                    routes = "\n".join([f'          <Route path="/{c.lower()}" element={{<{c} />}} />' for c in component_files if c not in ('Home', 'Header', 'Footer')])

                    new_app = f"""import React from 'react';
import {{ BrowserRouter, Routes, Route }} from 'react-router-dom';
{imports}

function App() {{
  return (
    <BrowserRouter>
      <div className="bg-[#09090b] text-white min-h-screen">
        <Routes>
          <Route path="/" element={{<Home />}} />
{routes}
        </Routes>
      </div>
    </BrowserRouter>
  );
}}

export default App;
"""
                    try:
                        with open(app_jsx, 'w', encoding='utf-8') as fh:
                            fh.write(new_app)
                        print(f"{LOG} ✓ Rewrote App.jsx with {len(component_files)} component imports", flush=True)
                        fixed.append("frontend/src/App.jsx")
                    except Exception as e:
                        print(f"{LOG} ✖ Failed to rewrite App.jsx: {e}", flush=True)

        # ═══════════════════════════════════════════════════════════════
        # CLEANUP: Remove stray files outside src/
        # ═══════════════════════════════════════════════════════════════
        stray_app = _os.path.join(workspace_dir, "frontend", "App.jsx")
        if _os.path.exists(stray_app):
            try:
                _os.remove(stray_app)
                print(f"{LOG} ✓ Removed stray frontend/App.jsx (outside src/)", flush=True)
            except Exception:
                pass

        if not missing:
            print(f"{LOG} ✓ All imports validated — no missing files", flush=True)
            return fixed

        print(f"{LOG} ⚠ {len(missing)} missing files — auto-generating...", flush=True)

        # Generate each missing file
        bound_llm = self.llm.bind_tools([client_save_code])
        messages = [
            SystemMessage(content=(
                "You are a React frontend engineer. Generate missing component files.\n"
                "Rules:\n"
                "- Dark theme: bg-[#09090b], white text\n"
                "- Tailwind CSS on every element\n"
                "- Use lucide-react for icons\n"
                "- Real content, not placeholders\n"
                "- Each component 50-150 lines\n"
                "- Export default the component\n"
            ))
        ]

        for rel_path, name, folder, imported_by in missing:
            if time.time() - start_time > timeout_sec - 30:
                print(f"{LOG} ✖ Not enough time to generate {rel_path}", flush=True)
                break

            print(f"{LOG} → Generating missing: {rel_path} (imported by {imported_by})", flush=True)

            gen_prompt = (
                f"Generate the missing file: {rel_path}\n"
                f"This is a {folder} component called '{name}'.\n"
                f"It's imported in {imported_by}.\n"
                f"Generate a complete, working React component with Tailwind CSS dark theme.\n"
                f"Use client_save_code to save it to: {rel_path}"
            )
            messages.append(HumanMessage(content=gen_prompt))

            try:
                response = await asyncio.wait_for(
                    bound_llm.ainvoke(list(messages)),
                    timeout=120
                )
                messages.append(response)

                if response.tool_calls:
                    for tc in response.tool_calls:
                        if tc["name"] == "client_save_code":
                            tool_args = tc["args"]
                            tool_args["file_path"] = rel_path
                            try:
                                result = await asyncio.wait_for(
                                    client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title}}),
                                    timeout=30
                                )
                                fixed.append(rel_path)
                                print(f"{LOG} ✓ Generated: {rel_path}", flush=True)
                                messages.append(ToolMessage(content=f"Saved {rel_path}", tool_call_id=tc["id"]))
                            except Exception as e:
                                print(f"{LOG} ✖ Failed to save {rel_path}: {e}", flush=True)
                                messages.append(ToolMessage(content=f"Error: {e}", tool_call_id=tc["id"]))
            except Exception as e:
                print(f"{LOG} ✖ LLM error generating {rel_path}: {e}", flush=True)

        print(f"{LOG} ═══ VALIDATION DONE: {len(fixed)} missing files generated ═══", flush=True)
        return fixed

    async def _validate_backend_routes(self, session_id):
        """Check if server.js mounts all route files. Auto-fix if missing."""
        import os as _os
        workspace_dir = _os.path.join(_os.getcwd(), "workspaces", session_id)
        backend_dir = _os.path.join(workspace_dir, "backend")
        routes_dir = _os.path.join(backend_dir, "routes")
        server_js = _os.path.join(backend_dir, "server.js")

        if not _os.path.exists(server_js) or not _os.path.isdir(routes_dir):
            return

        # Find all route files
        route_files = []
        for f in _os.listdir(routes_dir):
            if f.endswith('.js') and f != 'index.js':
                route_name = f.replace('.js', '')
                route_files.append(route_name)

        if not route_files:
            return

        # Read server.js
        with open(server_js, 'r', encoding='utf-8') as fh:
            server_content = fh.read()

        # Check which routes are mounted
        unmounted = []
        for route_name in route_files:
            # Check for various mount patterns
            patterns = [
                f"/api/{route_name}",
                f"'./routes/{route_name}'",
                f'"./routes/{route_name}"',
                f"require('./routes/{route_name}')",
            ]
            if not any(p in server_content for p in patterns):
                unmounted.append(route_name)

        if not unmounted:
            print(f"{LOG} ✓ All {len(route_files)} routes mounted in server.js", flush=True)
            return

        print(f"{LOG} ⚠ {len(unmounted)} unmounted routes: {unmounted}", flush=True)

        # Add missing route mounts to server.js
        # Find the last app.use line or the app.listen line
        lines = server_content.split('\n')
        insert_idx = len(lines) - 1
        for i, line in enumerate(lines):
            if 'app.listen' in line:
                insert_idx = i
                break
            if 'app.use(' in line and '/api/' in line:
                insert_idx = i + 1

        # Build new route mounts
        new_mounts = []
        for route_name in unmounted:
            new_mounts.append(f"app.use('/api/{route_name}', require('./routes/{route_name}'));")
            print(f"{LOG}   + Mounted /api/{route_name}", flush=True)

        # Insert before app.listen
        for i, mount in enumerate(new_mounts):
            lines.insert(insert_idx + i, mount)

        # Write updated server.js
        with open(server_js, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(lines))

        print(f"{LOG} ✓ Auto-mounted {len(unmounted)} routes in server.js", flush=True)

    async def _run_free_agent_loop(self, system_prompt: str, instruction: str, session_id: str, task_title: str, timeout_sec: int) -> str:
        """Fallback: free-form agent loop when file plan parsing fails."""
        max_tool_calls = 20
        tool_call_count = 0
        messages = [SystemMessage(content=system_prompt), HumanMessage(content=instruction)]
        bound_llm = self.llm.bind_tools([client_save_code])
        start_time = time.time()
        seen_files = set()
        files_saved = []

        while True:
            elapsed = time.time() - start_time
            if elapsed > timeout_sec or tool_call_count >= max_tool_calls:
                break

            remaining = timeout_sec - elapsed
            llm_timeout = min(120, remaining)
            if llm_timeout <= 15:
                break

            try:
                response = await asyncio.wait_for(bound_llm.ainvoke(list(messages)), timeout=llm_timeout)
            except Exception:
                break

            messages.append(response)
            if not response.tool_calls:
                break

            for tc in response.tool_calls:
                if time.time() - start_time > timeout_sec:
                    break
                tool_args = tc["args"]
                file_path = tool_args.get("file_path", "")
                if file_path in seen_files:
                    messages.append(ToolMessage(content=f"Already saved {file_path}. Next file.", tool_call_id=tc["id"]))
                    continue
                try:
                    if tc["name"] == "client_save_code":
                        result = await asyncio.wait_for(
                            client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title}}),
                            timeout=30
                        )
                        files_saved.append(file_path)
                        seen_files.add(file_path)
                        messages.append(ToolMessage(content=f"Saved {file_path}. Next file.", tool_call_id=tc["id"]))
                except Exception:
                    pass
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
        category = "backend"  # SAFE DEFAULT — always defined before use

        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)
        print(f"{LOG} EXECUTE | task={index+1}/{len(tasks)} | session={session_id}", flush=True)
        print(f"{LOG} Total tasks in plan: {len(tasks)}", flush=True)
        for i, t in enumerate(tasks):
            status = t.get("status", "unknown")
            title = t.get("title") or t.get("task") or f"Task {i+1}"
            cat = t.get("category", "?")
            marker = " ← CURRENT" if i == index else (" ✓ DONE" if status == "completed" else (" ✖ FAILED" if status == "failed" else ""))
            print(f"{LOG}   [{i+1}/{len(tasks)}] {cat}/{status}: {title}{marker}", flush=True)
        print(f"{LOG} ═══════════════════════════════════════════════════════════════", flush=True)

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
                "1. App.jsx MUST wrap ALL routes with Header and Footer:\n"
                "```jsx\n"
                "import Header from './components/Header';\n"
                "import Footer from './components/Footer';\n"
                "function App() {{\n"
                "  return (\n"
                "    <BrowserRouter>\n"
                "      <div className=\"bg-[#09090b] text-white min-h-screen flex flex-col\">\n"
                "        <Header />\n"
                "        <main className=\"flex-grow\">\n"
                "          <Routes>\n"
                "            <Route path=\"/\" element={{<Home />}} />\n"
                "          </Routes>\n"
                "        </main>\n"
                "        <Footer />\n"
                "      </div>\n"
                "    </BrowserRouter>\n"
                "  );\n"
                "}}\n"
                "```\n\n"
                "2. Header.jsx MUST use `import {{ Link }} from 'react-router-dom'` and `<Link to=\"/page\">` for navigation.\n"
                "   NEVER use `<a href=\"/page\">` — that causes full page reload and breaks SPA.\n"
                "   Use `useLocation()` to highlight the active nav item.\n\n"
                "3. Home.jsx MUST be a complete landing page with ALL of these sections (150-300 lines):\n"
                "   - Hero section: gradient heading, subtitle, 2 CTA buttons (primary gradient + secondary outline)\n"
                "   - Stats bar: 4 key metrics (e.g., users, revenue, rating, countries)\n"
                "   - Features grid: 4+ cards with icons, titles, descriptions, and links to relevant pages\n"
                "   - Why section: 3 benefit cards with icons\n"
                "   - CTA section: final call-to-action with gradient background\n"
                "   NEVER write a Home.jsx with just a heading and one line of text.\n\n"
                "4. EVERY component page (Dashboard, Features, etc.) MUST have:\n"
                "   - A page header with icon and title\n"
                "   - Substantial content (tables, cards, charts, forms — NOT empty divs)\n"
                "   - Minimum 40 lines per page component\n"
                "   - Real contextual content about the app's domain\n\n"
                "5. Footer.jsx MUST have:\n"
                "   - Brand logo + description\n"
                "   - 3 columns of links (Product, Company, Legal)\n"
                "   - Copyright line + social icons\n"
                "   - Minimum 50 lines\n\n"
                "═══ EXECUTION ORDER ═══\n"
                "1. frontend/src/App.jsx — with Header/Footer layout + ALL route imports\n"
                "2. frontend/src/components/Header.jsx — nav with react-router-dom Link\n"
                "3. frontend/src/components/Footer.jsx — professional footer\n"
                "4. frontend/src/components/Home.jsx — complete landing page (150-300 lines)\n"
                "5. Other page components — each with substantial content\n"
                "6. package.json ONLY if new deps needed\n\n"
                "═══ DESIGN RULES ═══\n"
                "- Dark theme: bg-[#09090b] or bg-[#0a0a0a], white text\n"
                "- Tailwind CSS on EVERY element — NO inline styles, NO bare HTML\n"
                "- Gradients: bg-gradient-to-r from-violet-600 to-indigo-600\n"
                "- Glass cards: bg-white/[0.02] border border-white/5 rounded-2xl\n"
                "- Hover effects: hover:bg-white/[0.05] hover:border-white/10 transition-all\n"
                "- Icons from lucide-react (TrendingUp, Bell, BarChart3, Shield, Zap, Globe, etc.)\n"
                "- Responsive: grid-cols-1 md:grid-cols-2 lg:grid-cols-3\n"
                "- Spacing: py-24 for sections, gap-6 for grids, p-6 for cards\n\n"
                "═══ CONTENT RULES ═══\n"
                "- NEVER write placeholder text like 'Welcome to Our Platform' or 'Feature 1: Description'\n"
                "- Write REAL, specific content about the app's domain (trading, healthcare, e-commerce, etc.)\n"
                "- Use actual product names, real feature descriptions, meaningful button text\n"
                "- Every CTA button must link to a real route using `<Link to=\"/page\">`\n\n"
                "═══ FILE RULES ═══\n"
                "- frontend/src/App.jsx: Header/Footer layout, ALL component imports, ALL routes\n"
                "- frontend/src/components/*.jsx: one file per component, 40-300 lines each\n"
                "- Use client_save_code for EVERY file\n"
                "- NO duplicates, NO orphaned components (every component must be imported in App.jsx)\n\n"
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
                "1. Write SQL migration files in backend/supabase/.\n"
                "2. Use Supabase CLI patterns for schema changes.\n"
                "3. Always enable RLS on new tables.\n"
                "4. Use proper constraints, indexes, and foreign keys.\n"
                "5. Use client_save_code for EVERY file.\n"
                "6. After saving ALL files, respond with ONLY a short summary."
            )
        else:
            system_prompt = (
                "You are a Backend Engineer. Express API in `backend/`.\n\n"
                "CRITICAL RULES:\n"
                "1. Use CommonJS (require/module.exports). NEVER use ES modules.\n"
                "2. ALWAYS write server.js LAST with ALL routes mounted.\n"
                "3. Use client_save_code for EVERY file.\n"
                "4. After saving ALL files, respond with ONLY a short summary."
            )

        # SAFETY: Ensure system_prompt is always defined
        if not system_prompt:
            system_prompt = (
                "You are a Backend Engineer. Express API in `backend/`.\n\n"
                "CRITICAL RULES:\n"
                "1. Use CommonJS (require/module.exports). NEVER use ES modules.\n"
                "2. ALWAYS write server.js LAST with ALL routes mounted.\n"
                "3. Use client_save_code for EVERY file.\n"
                "4. After saving ALL files, respond with ONLY a short summary."
            )

        instruction = (
            f"Task Title: {task_title}\n"
            f"Description: {current_task.get('description', '')}\n\n"
            "REMINDER: This is a PRODUCTION application. Every component must be visually stunning "
            "with dark theme, gradients, animations, real content, and responsive design. "
            "Do NOT create minimal/placeholder components. Build complete, beautiful UI.\n\n"
            "BEFORE WRITING App.jsx: List ALL component files you created and ONLY import those. "
            "Do NOT import components that don't exist as files in the workspace.\n\n"
            "CONTENT RULE: Every component must contain REAL, contextual content — not generic placeholders. "
            "Use actual product names, real feature descriptions, and meaningful button text."
        )
        overall_timeout = 1200
        print(f"{LOG} Starting agent loop with {overall_timeout}s overall timeout...", flush=True)

        try:
            output_content = await asyncio.wait_for(
                self._run_agent_loop(system_prompt, instruction, session_id, task_title, timeout_sec=600),
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
