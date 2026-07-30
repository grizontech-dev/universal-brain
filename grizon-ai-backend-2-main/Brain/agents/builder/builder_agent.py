from typing import Any, Dict, List
import os
import json
import time
import sys
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.services.provider_router import ProviderRouter
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from Brain.agents.builder.mcp_tools import client_save_code, client_execute_in_sandbox, supabase_exec_sql, supabase_create_exec_sql_function
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
            model_id="Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo"
        )
        self.llm = ProviderRouter.get_model("Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo", temperature=0.5)

    @staticmethod
    def _sanitize_code(code: str, file_path: str) -> str:
        """Fix duplicate symbol declarations that cause esbuild errors.
        Pattern: LLM imports `X` from a file, then declares `export default function X()` in same file.
        Fix: Remove the re-declaration since the import already provides it.
        """
        import re

        if not file_path.endswith(('.jsx', '.tsx')):
            return code

        # Extract all imported identifiers
        imported_names = set()
        for match in re.finditer(r'import\s+(?:\w+\s*,\s*)?\{([^}]+)\}\s+from', code):
            for name in match.group(1).split(','):
                name = name.strip()
                if name and not name.startswith('{') and not name.startswith('}'):
                    imported_names.add(name)

        # Also check: import DefaultName from '...'
        for match in re.finditer(r'import\s+(\w+)\s+from\s+["\'][^"\']+["\']', code):
            imported_names.add(match.group(1))

        # Find duplicate: `export default function X()` where X is already imported
        lines = code.split('\n')
        fixed_lines = []
        skipped = False
        for i, line in enumerate(lines):
            stripped = line.strip()
            # Check for `export default function X()` or `function X()` where X is imported
            func_match = re.match(r'export\s+default\s+function\s+(\w+)\s*\(', stripped)
            if func_match:
                func_name = func_match.group(1)
                if func_name in imported_names:
                    print(f"{LOG} ↻ Sanitizing: removing duplicate '{func_name}' declaration (already imported)", flush=True)
                    skipped = True
                    continue
            # Also check `const X = () =>` pattern
            const_match = re.match(r'(?:export\s+)?(?:default\s+)?const\s+(\w+)\s*=\s*(?:\(|function)', stripped)
            if const_match:
                const_name = const_match.group(1)
                if const_name in imported_names:
                    print(f"{LOG} ↻ Sanitizing: removing duplicate '{const_name}' declaration (already imported)", flush=True)
                    skipped = True
                    continue
            fixed_lines.append(line)

        if skipped:
            return '\n'.join(fixed_lines)
        return code

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

        _cat_models = {
            "frontend": "Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo",
            "backend": "Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo",
            "database": "deepseek-v4-flash",
            "runner": "deepseek-v4-pro",
        }
        _model = _cat_models.get(category, "deepseek-v4-pro")
        _llm = ProviderRouter.get_model(_model, temperature=0.5)

        print(f"{LOG} Using model: {_model} | category={category}", flush=True)
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
        bound_llm = _llm.bind_tools(tools)
        messages = [SystemMessage(content=system_prompt), HumanMessage(content=instruction)]

        # Free-form loop — LLM generates files until it stops or timeout
        consecutive_duplicates = 0
        MAX_CONSECUTIVE_DUPLICATES = 3
        sql_failure_count = 0
        MAX_SQL_FAILURES = 3  # Stop if SQL fails 3 times in a row — LLM is stuck
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

                if file_path in files_saved:
                    consecutive_duplicates += 1
                    print(f"{LOG} ⚠ Skip duplicate: {file_path} ({consecutive_duplicates}/{MAX_CONSECUTIVE_DUPLICATES})", flush=True)
                    messages.append(ToolMessage(content=f"Already saved {file_path}. Generate a DIFFERENT file that does not exist yet.", tool_call_id=tc["id"]))
                    if consecutive_duplicates >= MAX_CONSECUTIVE_DUPLICATES:
                        print(f"{LOG} ✖ BREAKING: {consecutive_duplicates} consecutive duplicates. LLM is stuck.", flush=True)
                        stuck = True
                        break
                    continue

                # PATH FIX: Redirect stray root-level files to frontend/src/
                if file_path.startswith("src/pages/") and not file_path.startswith("frontend/src/"):
                    corrected = file_path.replace("src/pages/", "frontend/src/pages/", 1)
                    tool_args["file_path"] = corrected
                    file_path = corrected
                    print(f"{LOG} ↻ Path corrected: {tool_args.get('file_path', '')} → {file_path}", flush=True)
                elif file_path.startswith("pages/") and not file_path.startswith("frontend/"):
                    corrected = file_path.replace("pages/", "frontend/src/pages/", 1)
                    tool_args["file_path"] = corrected
                    file_path = corrected
                    print(f"{LOG} ↻ Path corrected: {tool_args.get('file_path', '')} → {file_path}", flush=True)
                elif file_path.startswith("src/components/") and not file_path.startswith("frontend/src/"):
                    corrected = file_path.replace("src/components/", "frontend/src/components/", 1)
                    tool_args["file_path"] = corrected
                    file_path = corrected
                    print(f"{LOG} ↻ Path corrected: {tool_args.get('file_path', '')} → {file_path}", flush=True)

                # CODE SANITIZATION: Fix duplicate symbol declarations before saving
                code_content = tool_args.get("code_content", "")
                if code_content and file_path.endswith(('.jsx', '.tsx')):
                    sanitized = self._sanitize_code(code_content, file_path)
                    if sanitized != code_content:
                        tool_args["code_content"] = sanitized
                        print(f"{LOG} ↻ Code sanitized for {file_path} (fixed duplicate declarations)", flush=True)

                print(f"{LOG} → [{len(files_saved)+1}] Generating: {file_path} ({code_len} chars)", flush=True)

                tool_timeout = 30
                try:
                    if tool_name == "client_save_code":
                        result = await asyncio.wait_for(
                            client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title, "user_id": user_id}}),
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
                    elif tool_name in ("supabase_exec_sql", "supabase_create_exec_sql_function"):
                        # Handle Supabase SQL tools
                        sql_tool = supabase_exec_sql if tool_name == "supabase_exec_sql" else supabase_create_exec_sql_function
                        try:
                            result = await asyncio.wait_for(
                                sql_tool.ainvoke(tool_args, config={"configurable": {"thread_id": session_id}}),
                                timeout=60
                            )
                            print(f"{LOG} ✓ SQL tool result: {result[:200]}", flush=True)
                            # Track SQL failures — if result contains error patterns, count it
                            is_sql_error = any(kw in result.lower() for kw in [
                                '"error"', "into used with a command", "invalid input syntax",
                                "does not exist", "permission denied", "sql execution error"
                            ])
                            if is_sql_error:
                                sql_failure_count += 1
                                print(f"{LOG} ⚠ SQL failure #{sql_failure_count}/{MAX_SQL_FAILURES}", flush=True)
                                if sql_failure_count >= MAX_SQL_FAILURES:
                                    print(f"{LOG} ✖ BREAKING: {sql_failure_count} consecutive SQL failures. LLM is stuck in SQL loop.", flush=True)
                                    messages.append(ToolMessage(
                                        content="SQL keeps failing. STOP calling supabase_exec_sql. You already have the schema. Focus on generating frontend/backend code files using client_save_code instead.",
                                        tool_call_id=tc["id"]
                                    ))
                                    stuck = True
                                    break
                                messages.append(ToolMessage(content=f"SQL error: {result[:300]}. Do NOT retry this query. Generate code files instead.", tool_call_id=tc["id"]))
                            else:
                                sql_failure_count = 0  # Reset on success
                                messages.append(ToolMessage(content=result, tool_call_id=tc["id"]))
                        except Exception as e:
                            print(f"{LOG} ✖ SQL tool error: {e}", flush=True)
                            sql_failure_count += 1
                            messages.append(ToolMessage(content=f"SQL execution error: {e}", tool_call_id=tc["id"]))
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

            if stuck:
                break

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

        # ═══════════════════════════════════════════════════════════════
        # SELF-HEALING LOOP: Run local esbuild to catch & fix syntax errors
        # ═══════════════════════════════════════════════════════════════
        files_saved = await self._run_self_healing_loop(session_id, task_title, files_saved, timeout_sec)

        return f"Task '{task_title}' completed. Files saved: {', '.join(files_saved)}"

    async def _run_self_healing_loop(self, session_id: str, task_title: str, files_saved: list, timeout_sec: int) -> list:
        """Comprehensive self-healing: validate imports → fix missing files → esbuild syntax check → auto-fix errors."""
        import os as _os
        import re as _re
        import asyncio
        import shutil
        import subprocess as _sp
        import time as _time

        workspace_dir = _os.path.join(_os.getcwd(), "workspaces", session_id)
        frontend_dir = _os.path.join(workspace_dir, "frontend")
        frontend_src = _os.path.join(frontend_dir, "src")

        if not _os.path.isdir(frontend_src):
            return files_saved

        start_time = _time.time()
        _frontend_llm = ProviderRouter.get_model("Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo", temperature=0.5)
        bound_llm = _frontend_llm.bind_tools([client_save_code])

        # ═══════════════════════════════════════════════════════════════
        # PHASE 1: Import validation — find missing imported files
        # ═══════════════════════════════════════════════════════════════
        print(f"{LOG} ═══ SELF-HEALING: Phase 1 — Import validation ═══", flush=True)

        all_jsx_files = []
        for root, dirs, files in _os.walk(frontend_src):
            for f in files:
                if f.endswith(('.jsx', '.js', '.tsx', '.ts')) and not f.startswith('main.'):
                    full = _os.path.join(root, f)
                    rel = _os.path.relpath(full, frontend_src).replace('\\', '/')
                    all_jsx_files.append((full, rel))

        # Check for missing imports
        import_pattern = _re.compile(
            r"import\s+(?:\w+|\{[^}]+\})\s+from\s+['\"]\.\/(components|pages|lib|hooks)\/(\w+)['\"]"
        )
        missing_imports = []
        already_checked = set()

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

                found = False
                for ext in ['.jsx', '.js', '.tsx', '.ts']:
                    if _os.path.exists(_os.path.join(frontend_src, folder, f"{name}{ext}")):
                        found = True
                        break

                if not found:
                    missing_imports.append({
                        "path": f"frontend/src/{folder}/{name}.jsx",
                        "name": name,
                        "folder": folder,
                        "imported_by": rel_path,
                    })
                    print(f"{LOG}   ✖ {rel_path} imports {folder}/{name} → MISSING", flush=True)

        # ═══════════════════════════════════════════════════════════════
        # PHASE 1b: Check App.jsx is not placeholder
        # ═══════════════════════════════════════════════════════════════
        app_jsx_path = _os.path.join(frontend_src, "App.jsx")
        app_is_placeholder = False
        if _os.path.isfile(app_jsx_path):
            try:
                with open(app_jsx_path, 'r', encoding='utf-8') as f:
                    app_content = f.read()
                if any(marker in app_content for marker in ["Brain MUST replace", "Brain UI Builder", "Remove this placeholder"]):
                    app_is_placeholder = True
                    print(f"{LOG}   ✖ App.jsx is still a placeholder — needs real implementation", flush=True)
            except Exception:
                pass

        # Generate missing imports + fix placeholder App.jsx via LLM
        if missing_imports or app_is_placeholder:
            print(f"{LOG} → Generating {len(missing_imports)} missing files + fixing App.jsx...", flush=True)

            sys_msg = (
                "Generate missing React component files.\n"
                "- Dark theme: bg-[#09090b], Tailwind CSS\n"
                "- Real functional content, NOT placeholders\n"
                "- Export default each component\n"
                "- Do NOT call supabase_exec_sql — only use client_save_code\n"
            )

            gen_messages = [SystemMessage(content=sys_msg)]

            # Build context about existing components
            existing_components = []
            for root, dirs, files in _os.walk(frontend_src):
                for f in files:
                    if f.endswith(('.jsx', '.js')) and not f.startswith('main.'):
                        name = f.split('.')[0]
                        rel = _os.path.relpath(_os.path.join(root, f), frontend_src).replace('\\', '/')
                        existing_components.append(f"  - {rel}")

            if existing_components:
                gen_messages.append(HumanMessage(content=(
                    "Existing project files:\n" + "\n".join(existing_components) +
                    "\n\nUse this context to generate proper imports in App.jsx."
                )))

            # Generate each missing file
            for item in missing_imports:
                if _time.time() - start_time > timeout_sec - 60:
                    print(f"{LOG} ✖ Timeout — skipping remaining missing files", flush=True)
                    break

                gen_messages.append(HumanMessage(content=(
                    f"Generate the missing file: {item['path']}\n"
                    f"This is a {item['folder']} component called '{item['name']}'.\n"
                    f"It's imported in {item['imported_by']}.\n"
                    f"Make it a complete, working React component with Tailwind CSS dark theme.\n"
                    f"Use client_save_code to save it to: {item['path']}"
                )))

                try:
                    response = await asyncio.wait_for(bound_llm.ainvoke(list(gen_messages)), timeout=120)
                    gen_messages.append(response)

                    if response.tool_calls:
                        for tc in response.tool_calls:
                            if tc["name"] == "client_save_code":
                                tool_args = tc["args"]
                                fp = tool_args.get("file_path", "")
                                try:
                                    await asyncio.wait_for(
                                        client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title + " (Self-heal)", "user_id": user_id}}),
                                        timeout=30
                                    )
                                    if fp and fp not in files_saved:
                                        files_saved.append(fp)
                                    print(f"{LOG} ✓ Generated missing: {fp}", flush=True)
                                except Exception as e:
                                    print(f"{LOG} ✖ Failed to generate {fp}: {e}", flush=True)
                except Exception as e:
                    print(f"{LOG} ✖ LLM error generating missing file: {e}", flush=True)

            # Fix placeholder App.jsx if needed
            if app_is_placeholder and _time.time() - start_time < timeout_sec - 60:
                # Collect all component names for the prompt
                all_components = []
                for root, dirs, files in _os.walk(frontend_src):
                    for f in files:
                        if f.endswith(('.jsx', '.js')) and f not in ('App.jsx', 'main.jsx', 'index.js'):
                            name = f.split('.')[0]
                            rel = _os.path.relpath(_os.path.join(root, f), frontend_src).replace('\\', '/')
                            import_path = f"./{rel.replace('.jsx', '').replace('.js', '')}"
                            all_components.append({"name": name, "import_path": import_path, "rel": rel})

                component_list = "\n".join([f"  - {c['name']} from '{c['import_path']}'" for c in all_components])

                fix_messages = [
                    SystemMessage(content=(
                        "Replace placeholder App.jsx with a real implementation.\n"
                        "- Use BrowserRouter, Route, Routes from react-router-dom\n"
                        "- Import ALL existing components listed below\n"
                        "- Dark theme, Tailwind CSS\n"
                        "- Do NOT call supabase_exec_sql\n"
                    )),
                    HumanMessage(content=(
                        f"Existing components to import:\n{component_list}\n\n"
                        "Generate a complete App.jsx that imports and renders all these components with proper routing."
                    ))
                ]

                try:
                    response = await asyncio.wait_for(bound_llm.ainvoke(fix_messages), timeout=120)
                    if response.tool_calls:
                        for tc in response.tool_calls:
                            if tc["name"] == "client_save_code":
                                tool_args = tc["args"]
                                fp = tool_args.get("file_path", "")
                                try:
                                    await asyncio.wait_for(
                                        client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title + " (Fix App.jsx)", "user_id": user_id}}),
                                        timeout=30
                                    )
                                    if fp and fp not in files_saved:
                                        files_saved.append(fp)
                                    print(f"{LOG} ✓ Fixed placeholder App.jsx", flush=True)
                                except Exception as e:
                                    print(f"{LOG} ✖ Failed to fix App.jsx: {e}", flush=True)
                except Exception as e:
                    print(f"{LOG} ✖ LLM error fixing App.jsx: {e}", flush=True)
        else:
            print(f"{LOG} ✓ All imports validated — no missing files", flush=True)

        # ═══════════════════════════════════════════════════════════════
        # PHASE 2: esbuild syntax check (max 2 iterations to save credits)
        # ═══════════════════════════════════════════════════════════════
        print(f"{LOG} ═══ SELF-HEALING: Phase 2 — esbuild syntax check ═══", flush=True)

        for iteration in range(2):
            if _time.time() - start_time > timeout_sec - 30:
                print(f"{LOG} ✖ Timeout — skipping remaining esbuild iterations", flush=True)
                break

            # Re-collect files (may have been added in Phase 1)
            all_files = []
            for root, _, files in _os.walk(frontend_src):
                for f in files:
                    if f.endswith(('.jsx', '.js', '.tsx', '.ts')):
                        all_files.append(_os.path.join(root, f))

            if not all_files:
                break

            escaped_files = [f'"{f}"' for f in all_files]

            # Find npx with full path
            npx_full = shutil.which("npx.cmd" if _os.name == 'nt' else "npx")
            if npx_full:
                cmd_str = f'"{npx_full}" --yes esbuild ' + " ".join(escaped_files) + " --bundle --packages=external --outdir=temp_esbuild_out"
            else:
                npx_cli_js = None
                node_full = shutil.which("node")
                if node_full:
                    try:
                        npm_prefix = _sp.check_output(
                            [node_full, _os.path.join(_os.path.dirname(node_full), "node_modules", "npm", "bin", "npm-prefix.js")],
                            text=True, timeout=5
                        ).strip()
                        candidate = _os.path.join(npm_prefix, "node_modules", "npm", "bin", "npx-cli.js")
                        if _os.path.isfile(candidate):
                            npx_cli_js = candidate
                    except Exception:
                        pass

                if node_full and npx_cli_js:
                    cmd_str = f'"{node_full}" "{npx_cli_js}" --yes esbuild ' + " ".join(escaped_files) + " --bundle --packages=external --outdir=temp_esbuild_out"
                else:
                    print(f"{LOG} ⚠ npx not found — skipping esbuild check", flush=True)
                    break

            try:
                process = await asyncio.create_subprocess_shell(
                    cmd_str,
                    cwd=frontend_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await process.communicate()

                temp_dir = _os.path.join(frontend_dir, "temp_esbuild_out")
                if _os.path.isdir(temp_dir):
                    try:
                        import shutil as _shutil
                        _shutil.rmtree(temp_dir, ignore_errors=True)
                    except Exception:
                        pass

                if process.returncode == 0:
                    print(f"{LOG} ✓ esbuild passed (iteration {iteration+1}) — no syntax/import errors", flush=True)
                    break

                error_output = stderr.decode('utf-8', errors='ignore')

                if ("npx: not found" in error_output
                    or "npx is not recognized" in error_output
                    or "command not found" in error_output.lower()
                    or "executable file not found" in error_output.lower()
                    or "no such file or directory" in error_output.lower()):
                    print(f"{LOG} ⚠ npx not found on host. Skipping esbuild check.", flush=True)
                    break

                print(f"{LOG} ⚠ esbuild failed (iter {iteration+1}):\n{error_output[:500]}...", flush=True)

                # Read ALL existing source files for context
                file_context = ""
                for fp in all_files[:8]:  # Reduced from 15 to save tokens
                    try:
                        with open(fp, 'r', encoding='utf-8') as f:
                            content = f.read()
                        rel = _os.path.relpath(fp, frontend_src).replace('\\', '/')
                        file_context += f"\n--- {rel} ---\n```jsx\n{content[:800]}\n```\n"  # Reduced from 1500
                    except Exception:
                        pass

                prompt = (
                    "The React build failed with the following errors. Fix the broken files using `client_save_code`.\n"
                    f"```\n{error_output[:1500]}\n```\n"  # Reduced from 3000 to save tokens
                    "Rules:\n"
                    "- ONLY fix files mentioned in the error messages\n"
                    "- Fix the specific import/syntax issue — do NOT rewrite entire files\n"
                    "- If an import is wrong, fix the import path or fix the export name\n"
                    "- If a component is missing, generate a minimal working version\n"
                    f"{file_context}\n"
                    "--- CURRENT App.jsx (preserve its structure, only fix errors) ---\n"
                )

                if _os.path.isfile(app_jsx_path):
                    try:
                        with open(app_jsx_path, 'r', encoding='utf-8') as f:
                            prompt += f"```jsx\n{f.read()}\n```\n"
                    except Exception:
                        pass

                messages = [
                    SystemMessage(content="Fix ONLY the specific build errors listed below. Do NOT regenerate files. Use client_save_code to save fixes."),
                    HumanMessage(content=prompt)
                ]

                print(f"{LOG} → Asking LLM to fix build errors (iter {iteration+1})...", flush=True)
                response = await asyncio.wait_for(bound_llm.ainvoke(messages), timeout=120)

                if response.tool_calls:
                    fixed_any = False
                    for tc in response.tool_calls:
                        if tc["name"] == "client_save_code":
                            tool_args = tc["args"]
                            file_path = tool_args.get("file_path", "")

                            # PATH FIX for self-healing saves
                            if file_path.startswith("src/") and not file_path.startswith("frontend/src/"):
                                corrected = file_path.replace("src/", "frontend/src/", 1)
                                tool_args["file_path"] = corrected
                                file_path = corrected
                            elif file_path.startswith("pages/") and not file_path.startswith("frontend/"):
                                corrected = file_path.replace("pages/", "frontend/src/pages/", 1)
                                tool_args["file_path"] = corrected
                                file_path = corrected

                            # CODE SANITIZATION
                            code_content = tool_args.get("code_content", "")
                            if code_content and file_path.endswith(('.jsx', '.tsx')):
                                sanitized = self._sanitize_code(code_content, file_path)
                                if sanitized != code_content:
                                    tool_args["code_content"] = sanitized

                            try:
                                await asyncio.wait_for(
                                    client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title + " (Fix Error)", "user_id": user_id}}),
                                    timeout=30
                                )
                                if file_path and file_path not in files_saved:
                                    files_saved.append(file_path)
                                print(f"{LOG} ✓ Fixed: {file_path}", flush=True)
                                fixed_any = True
                            except Exception as e:
                                print(f"{LOG} ✖ Failed to fix {file_path}: {e}", flush=True)
                    if not fixed_any:
                        print(f"{LOG} ⚠ LLM did not provide fixes — stopping", flush=True)
                        break
                else:
                    print(f"{LOG} ⚠ LLM did not provide any fixes — stopping", flush=True)
                    break

            except Exception as e:
                print(f"{LOG} ✖ esbuild error: {e}", flush=True)
                break

        return files_saved

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
                print(f"{LOG} ⚠ {len(orphans)} orphaned components: {orphans}. (Ignoring instead of destructive rewrite)", flush=True)

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
        _frontend_llm2 = ProviderRouter.get_model("Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo", temperature=0.5)
        bound_llm = _frontend_llm2.bind_tools([client_save_code])
        messages = [
            SystemMessage(content=(
                "Generate missing React component files.\n"
                "- Dark theme: bg-[#09090b], Tailwind CSS\n"
                "- Real content, not placeholders\n"
                "- Export default each component\n"
                "- Do NOT call supabase_exec_sql — only use client_save_code\n"
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

                            # CODE SANITIZATION
                            code_content = tool_args.get("code_content", "")
                            if code_content and rel_path.endswith(('.jsx', '.tsx')):
                                sanitized = self._sanitize_code(code_content, rel_path)
                                if sanitized != code_content:
                                    tool_args["code_content"] = sanitized

                            try:
                                result = await asyncio.wait_for(
                                    client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title, "user_id": user_id}}),
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
        _fallback_llm = ProviderRouter.get_model("Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo", temperature=0.5)
        bound_llm = _fallback_llm.bind_tools([client_save_code])
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
                            client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title, "user_id": user_id}}),
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
        user_id = state.get("user_id")
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

        # ═══ DELEGATE TO SUB-AGENTS ═══
        if category in ("frontend", "backend", "database"):
            try:
                if category == "frontend":
                    from Brain.sub_agents.frontend.frontend_agent import FrontendAgent
                    agent = FrontendAgent()
                elif category == "backend":
                    from Brain.sub_agents.backend.backend_agent import BackendAgent
                    agent = BackendAgent()
                else:
                    from Brain.sub_agents.database.database_agent import DatabaseAgent
                    agent = DatabaseAgent()

                print(f"{LOG} → Delegating to {agent.name} | task={task_title}", flush=True)
                result = await asyncio.wait_for(
                    agent.execute(current_task, state),
                    timeout=600
                )

                # Save files from sub-agent result
                files_saved = []
                if isinstance(result, dict) and "files" in result:
                    from Brain.agents.builder.mcp_tools import client_save_code
                    for file_entry in result["files"]:
                        if isinstance(file_entry, dict) and "path" in file_entry and "content" in file_entry:
                            file_path = file_entry["path"]
                            file_content = file_entry["content"]
                            try:
                                save_result = await client_save_code.ainvoke(
                                    {"code_content": file_content, "file_path": file_path},
                                    config={"configurable": {"thread_id": session_id, "task_title": task_title, "user_id": user_id}}
                                )
                                files_saved.append(file_path)
                                print(f"{LOG} ✓ [{len(files_saved)}] Saved: {file_path} ({len(file_content)} chars)", flush=True)
                            except Exception as save_err:
                                print(f"{LOG} ✖ Failed to save {file_path}: {save_err}", flush=True)

                summary = result.get("summary", f"Task completed via {agent.name}") if isinstance(result, dict) else "Task completed"
                output_content = f"Task '{task_title}' completed. Files saved: {', '.join(files_saved)}\n{summary}"
                print(f"{LOG} ✓ TASK DONE: '{task_title}' | files_saved={len(files_saved)} via {agent.name}", flush=True)

            except asyncio.TimeoutError:
                print(f"{LOG} ✖ Sub-agent timeout for '{task_title}', falling back to builder loop", flush=True)
                output_content = None
            except Exception as sub_err:
                print(f"{LOG} ✖ Sub-agent error: {type(sub_err).__name__}: {sub_err}, falling back to builder loop", flush=True)
                output_content = None

            if output_content is not None:
                # Task completed via sub-agent — skip the builder loop
                print(f"{LOG} ▶ Task DONE: '{task_title}' | output_len={len(output_content)}", flush=True)
                print(f"{LOG}   Output preview: {output_content[:300]}", flush=True)
                # Emit completion and move to next task
                if session_id and not str(session_id).startswith("error:"):
                    done_act = self._make_activity("task_done", f"Done — {task_title}", task_title=task_title, status="done")
                    done_msg = json.dumps({"type": "task_completed", "taskId": str(index), "title": task_title, "timestamp": str(int(time.time() * 1000))})
                    async for ev in self._emit(workspace_id, activities=[done_act], progress_msg=done_msg):
                        yield ev
                current_task["status"] = "completed"
                state["current_task_index"] = index + 1
                executed_tasks.append({"title": task_title, "status": "completed", "output": output_content[:500]})
                state["executed_tasks"] = executed_tasks
                yield state
                return

        # ═══ FALLBACK: BUILDER LOOP (for categories without sub-agents) ═══

        # Load skills based on category
        skill_content = ""
        system_prompt = ""
        skill_dir = os.path.join(os.path.dirname(__file__), "..", "..", "skillss")
        
        # Gather EXISTING codebase context — ONLY relevant files per category
        existing_code_context = ""
        try:
            ws_dir = os.path.join(os.getcwd(), "workspaces", session_id)
            if os.path.exists(ws_dir):
                files_to_read = []
                # Only include files relevant to the current task category
                category_dirs = {
                    "frontend": ["frontend/src"],
                    "backend": ["backend"],
                    "database": ["backend/supabase"],
                }
                search_dirs = category_dirs.get(category, ["frontend/src", "backend"])

                for search_dir in search_dirs:
                    full_dir = os.path.join(ws_dir, search_dir)
                    if not os.path.exists(full_dir):
                        continue
                    for root, _, files in os.walk(full_dir):
                        if "node_modules" in root or ".git" in root or "dist" in root:
                            continue
                        for f in files:
                            if f.endswith(('.js', '.jsx', '.ts', '.tsx')):
                                full_path = os.path.join(root, f)
                                rel_path = os.path.relpath(full_path, ws_dir).replace("\\", "/")
                                if "package-lock.json" not in rel_path:
                                    files_to_read.append((rel_path, full_path))

                # Limit to 15 most recent files to avoid token explosion
                files_to_read = files_to_read[-15:]

                if files_to_read:
                    existing_code_context = "\n\n═══ EXISTING FILES (read-only reference) ═══\n"
                    for rel_path, full_path in files_to_read:
                        try:
                            with open(full_path, 'r', encoding='utf-8') as fh:
                                content = fh.read()
                            # Truncate large files to save tokens
                            if len(content) > 2000:
                                content = content[:2000] + "\n... (truncated)"
                            existing_code_context += f"--- {rel_path} ---\n```\n{content}\n```\n\n"
                        except Exception:
                            pass
        except Exception as e:
            print(f"{LOG} Failed to load existing codebase: {e}")

        def _load_skill(name, max_chars=1500):
            try:
                path = os.path.join(skill_dir, name, "SKILL.md")
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                return content[:max_chars]
            except Exception:
                return ""

        skill_content = ""
        if category == "backend":
            skill_content = _load_skill("backend-development", 3000)
        elif category == "database":
            skill_content = _load_skill("supabase", 3000)

        if category == "frontend":
            system_prompt = (
                "You are a Senior React Frontend Engineer. You build COMPLETE, BEAUTIFUL UIs.\n\n"
                "STACK: React + Tailwind CSS + react-router-dom + lucide-react\n"
                "DARK THEME: bg-[#09090b], text-white, gradients\n\n"
                "═══ CRITICAL RULES (violation = broken build) ═══\n"
                "1. Use client_save_code for EVERY file. One tool call per file.\n"
                "2. File paths MUST start with frontend/src/ (e.g., frontend/src/App.jsx)\n"
                "3. Import EVERY component you use at the top of the file\n"
                "4. Do NOT re-declare imported names (if you import X, don't export default function X)\n"
                "5. Use react-router-dom Link, NOT <a href>\n"
                "6. Do NOT import CSS files (Tailwind is global)\n"
                "7. Do NOT use brand icons: Github, Google, Twitter (cause errors)\n\n"
                "═══ OUTPUT FORMAT ═══\n"
                "Generate ONE file per tool call. After ALL files, respond with a short summary.\n\n"
                "═══ EXAMPLE: How to generate a component ═══\n"
                "When asked to create a Navbar component, use client_save_code with:\n"
                "- file_path: frontend/src/components/Navbar.jsx\n"
                "- code_content:\n"
                "```jsx\n"
                "import { Link } from 'react-router-dom';\n"
                "import { Menu, X } from 'lucide-react';\n"
                "import { useState } from 'react';\n\n"
                "export default function Navbar() {\n"
                "  const [open, setOpen] = useState(false);\n"
                "  return (\n"
                "    <nav className=\"bg-[#09090b] border-b border-white/10 sticky top-0 z-50\">\n"
                "      <div className=\"max-w-7xl mx-auto px-4 py-3 flex items-center justify-between\">\n"
                "        <Link to=\"/\" className=\"text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent\">\n"
                "          Grizon AI\n"
                "        </Link>\n"
                "        <div className=\"hidden md:flex gap-6\">\n"
                "          <Link to=\"/\" className=\"text-gray-300 hover:text-white transition\">Home</Link>\n"
                "          <Link to=\"/dashboard\" className=\"text-gray-300 hover:text-white transition\">Dashboard</Link>\n"
                "        </div>\n"
                "        <button onClick={() => setOpen(!open)} className=\"md:hidden text-white\">\n"
                "          {open ? <X size={24} /> : <Menu size={24} />}\n"
                "        </button>\n"
                "      </div>\n"
                "    </nav>\n"
                "  );\n"
                "}\n"
                "```\n\n"
                "═══ App.jsx Structure ═══\n"
                "App.jsx MUST use BrowserRouter + Routes. Import ALL components.\n"
                "```jsx\n"
                "import { BrowserRouter, Routes, Route } from 'react-router-dom';\n"
                "import Navbar from './components/Navbar';\n"
                "import Home from './pages/Home';\n"
                "import Dashboard from './pages/Dashboard';\n\n"
                "export default function App() {\n"
                "  return (\n"
                "    <BrowserRouter>\n"
                "      <div className=\"min-h-screen bg-[#09090b] text-white\">\n"
                "        <Navbar />\n"
                "        <Routes>\n"
                "          <Route path=\"/\" element={<Home />} />\n"
                "          <Route path=\"/dashboard\" element={<Dashboard />} />\n"
                "        </Routes>\n"
                "      </div>\n"
                "    </BrowserRouter>\n"
                "  );\n"
                "}\n"
                "```\n\n"
                "Every component MUST have: Tailwind dark theme, real content (not placeholders), responsive design."
            )
        elif category == "backend":
            system_prompt = (
                "You are a Senior Backend Engineer. Node.js + Express API in `backend/`.\n\n"
                "═══ CRITICAL RULES ═══\n"
                "1. Use CommonJS (require/module.exports). NEVER use ES modules.\n"
                "2. Use client_save_code for EVERY file. One tool call per file.\n"
                "3. Write server.js LAST with ALL routes mounted.\n"
                "4. Every controller starts with: const { supabase } = require('../supabase/client');\n"
                "5. Every route returns JSON: { success: true, data } or { success: false, error }\n"
                "6. Try/catch in every route handler\n\n"
                "═══ FILE STRUCTURE ═══\n"
                "backend/\n"
                "  ├── server.js          (main entry, mounts all routes)\n"
                "  ├── package.json       (dependencies)\n"
                "  ├── routes/\n"
                "  │   └── todos.js       (route definitions)\n"
                "  ├── controllers/\n"
                "  │   └── todos.js       (business logic)\n"
                "  └── supabase/\n"
                "      └── client.js      (supabase client init)\n\n"
                "═══ EXAMPLE: Route file ═══\n"
                "```javascript\n"
                "// routes/todos.js\n"
                "const express = require('express');\n"
                "const router = express.Router();\n"
                "const { getTodos, createTodo } = require('../controllers/todos');\n\n"
                "router.get('/', getTodos);\n"
                "router.post('/', createTodo);\n\n"
                "module.exports = router;\n"
                "```\n\n"
                "═══ EXAMPLE: Controller file ═══\n"
                "```javascript\n"
                "// controllers/todos.js\n"
                "const { supabase } = require('../supabase/client');\n\n"
                "exports.getTodos = async (req, res) => {\n"
                "  try {\n"
                "    const { data, error } = await supabase.from('todos').select('*');\n"
                "    if (error) throw error;\n"
                "    res.json({ success: true, data });\n"
                "  } catch (err) {\n"
                "    res.status(500).json({ success: false, error: err.message });\n"
                "  }\n"
                "};\n\n"
                "exports.createTodo = async (req, res) => {\n"
                "  try {\n"
                "    const { data, error } = await supabase.from('todos').insert(req.body).select();\n"
                "    if (error) throw error;\n"
                "    res.json({ success: true, data });\n"
                "  } catch (err) {\n"
                "    res.status(500).json({ success: false, error: err.message });\n"
                "  }\n"
                "};\n"
                "```\n\n"
                "═══ EXAMPLE: server.js ═══\n"
                "```javascript\n"
                "const express = require('express');\n"
                "const cors = require('cors');\n"
                "const app = express();\n\n"
                "app.use(cors());\n"
                "app.use(express.json());\n\n"
                "app.use('/api/todos', require('./routes/todos'));\n\n"
                "const PORT = process.env.PORT || 3001;\n"
                "app.listen(PORT, () => console.log(`Server running on port ${PORT}`));\n"
                "```"
            )
        elif category == "database":
            system_prompt = (
                "You are a Database Engineer. Supabase PostgreSQL.\n\n"
                "═══ DO NOT ═══\n"
                "- Do NOT use SELECT ... INTO (it doesn't work with JSON returns)\n"
                "- Do NOT retry failing SQL queries — switch to generating code files instead\n"
                "- Do NOT call supabase_exec_sql more than 3 times — if it fails, stop\n\n"
                "═══ DO ═══\n"
                "- Write SQL in backend/supabase/schema.sql\n"
                "- Enable RLS on every table\n"
                "- Add constraints, indexes, foreign keys\n"
                "- After writing SQL file, execute it via supabase_exec_sql\n"
                "- After every CREATE/ALTER TABLE, append: NOTIFY pgrst, 'reload schema';\n"
                "- Use client_save_code for the SQL file, supabase_exec_sql for execution\n\n"
                "Generate files one at a time. After all files, respond with a short summary."
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
            
        if existing_code_context:
            system_prompt += existing_code_context

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
