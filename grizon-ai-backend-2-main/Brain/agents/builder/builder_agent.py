from typing import Any, Dict, List
import os
import json
import time
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.sub_agents.frontend.frontend_agent import FrontendAgent
from Brain.sub_agents.backend.backend_agent import BackendAgent
from Brain.sub_agents.database.database_agent import DatabaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from Brain.shared.frontend_entry import APP_TSX, normalize_frontend_entry_files
from Brain.services.command_policy import filter_webcontainer_commands
from Brain.services.workspace_manager import workspace_manager
from Brain.services.websocket_manager import ws_manager

class BuilderAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Builder",
            description="Coordinates sub-agents to execute tasks and build the application.",
            model_id="deepseek-chat"
        )
        self.frontend = FrontendAgent()
        self.backend = BackendAgent()
        self.database = DatabaseAgent()

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

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        tasks = state.get("plan", [])
        index = state.get("current_task_index", 0)
        executed_tasks = state.get("executed_tasks", [])
        workspace_id = state.get("current_job_id")
        # Track which dirs were already created this build session to avoid duplicate "Created folder" noise
        if "_created_dirs" not in state:
            state["_created_dirs"] = set()
        created_dirs: set = state["_created_dirs"]

        if index >= len(tasks):
            state["status"] = "building_complete"
            state["next_agent"] = "runner"
            yield state
            return

        current_task = tasks[index]
        task_title = current_task.get("title") or current_task.get("task") or f"Task {index + 1}"
        print(f"DEBUG: Builder executing task {index+1}/{len(tasks)}: {task_title}")

        if workspace_id and not workspace_id.startswith("error:"):
            start_act = self._make_activity(
                "task_start",
                f"Exploring — {task_title}",
                task_title=task_title,
                status="running",
            )
            progress_msg = json.dumps({
                "type": "task_started",
                "taskId": str(index),
                "title": task_title,
                "timestamp": str(int(time.time() * 1000))
            })
            async for ev in self._emit(workspace_id, activities=[start_act], progress_msg=progress_msg):
                yield ev
        
        category = current_task.get("category", "backend")
        print(f"DEBUG: Builder routing to {category} agent...")

        active_decisions = state.get("memory_context", {}).get("decisions", {})
        build_state = {
            **state,
            "build_standards": FULL_STACK_BUILD_STANDARDS,
            "current_build_task": current_task,
            "active_decisions": active_decisions,
        }
        if category == "frontend":
            result = await self.frontend.execute(current_task, build_state)
        elif category == "backend":
            result = await self.backend.execute(current_task, build_state)
        elif category == "database":
            result = await self.database.execute(current_task, build_state)
        elif category == "runner":
            result = {"status": "completed", "summary": "Build finished. Handing over to Runner Agent for deployment..."}
        else:
            result = {"status": "error", "summary": f"Unknown category: {category}"}

        print(f"DEBUG: Builder received result from {category} agent.")
        print(f"DEBUG: BuilderAgent received result for task '{current_task.get('title')}': {json.dumps(result, indent=2)}")

        has_output = bool(result.get("files") or result.get("commands"))
        summary = result.get("summary")
        status_val = result.get("status")

        if status_val == "error":
            error_detail = summary or "Sub-agent returned an error status without details."
            state["plan"][index]["status"] = "failed"
            state["plan"][index]["error"] = error_detail
            state["status"] = "error"
            state["error_msg"] = error_detail
            state["current_task_index"] = index + 1
            yield state
            return

        if not has_output:
            if summary and len(summary) > 20:
                print(f"DEBUG: BuilderAgent - Task '{current_task.get('title')}' has no files/commands but has a valid summary. Marking as completed.")
            else:
                error_detail = result.get("error") or "Sub-agent returned no files, no commands, and no descriptive summary."
                state["plan"][index]["status"] = "failed"
                state["plan"][index]["error"] = error_detail
                state["status"] = "error"
                state["error_msg"] = error_detail
                state["current_task_index"] = index + 1
                yield state
                return

        task_error = None
        task_ops: List[Dict[str, Any]] = []
        print(f"DEBUG: BuilderAgent using workspace_id: {workspace_id}")
        
        if workspace_id and workspace_id.startswith("error:"):
            state["plan"][index]["status"] = "failed"
            state["plan"][index]["error"] = f"Workspace Error: {workspace_id}"
            state["status"] = "error"
            state["error_msg"] = f"Workspace Error: {workspace_id}"
            state["current_task_index"] = index + 1
            yield state
            return

        if workspace_id and result:
            ws_root = workspace_manager.resolve_workspace_path(workspace_id) or ""

            files_to_write = list(result.get("files", []))
            delete_app_tsx = False
            if category == "frontend":
                files_to_write, delete_app_tsx = normalize_frontend_entry_files(files_to_write)
                if delete_app_tsx:
                    tsx_disk = os.path.join(ws_root, APP_TSX) if ws_root else ""
                    if tsx_disk and os.path.isfile(tsx_disk):
                        try:
                            os.remove(tsx_disk)
                        except OSError:
                            pass
                    del_op = workspace_manager.build_op_delete_file(APP_TSX)
                    task_ops.append(del_op)
                    del_act = self._make_activity(
                        "edit_file",
                        "Removed `frontend/src/App.tsx` (preview uses App.jsx only)",
                        path=APP_TSX,
                        task_title=task_title,
                    )
                    progress_msg = json.dumps({
                        "type": "file_deleted",
                        "file": APP_TSX,
                        "reason": "Removed `frontend/src/App.tsx` (preview uses App.jsx only)",
                        "expectedResult": "App.jsx is used instead",
                        "timestamp": str(int(time.time() * 1000))
                    })
                    await self._publish_ops(workspace_id, [del_op], progress_msg, [del_act])

            # --- V0-STYLE: One narration per task, before all files ---
            files_to_write_paths = [f.get('path', '').lstrip('/') for f in files_to_write if f.get('path')]
            file_count = len(files_to_write_paths)
            category_lower = (category or '').lower()
            task_desc = current_task.get('description') or ''

            # Count edits vs creates
            new_files = [p for p in files_to_write_paths if not (ws_root and os.path.isfile(os.path.join(ws_root, p)))]
            edit_files = [p for p in files_to_write_paths if p not in new_files]

            # Build a friendly, conversational intro like v0
            def build_task_narration():
                # If we have a real description, extract first sentence ONLY if it's already conversational
                if task_desc:
                    import re
                    first_sentence = re.split(r'(?<=[.!?])\s+', task_desc.strip())[0].strip()
                    is_conversational = any(first_sentence.startswith(w) for w in ['Now', 'Let', 'I ', "I'll", 'We '])
                    if is_conversational and 15 < len(first_sentence) < 200:
                        return first_sentence

                # Fallback: strictly v0 style generative text based on category
                file_names = ', '.join(f"`{p.split('/')[-1]}`" for p in files_to_write_paths[:2])
                if len(files_to_write_paths) > 2:
                    file_names += f' and {len(files_to_write_paths) - 2} other files'
                
                if not file_names:
                    return "Now let me work on the next set of changes."

                t_lower = task_title.lower()
                c_lower = category_lower

                if 'auth' in t_lower or 'auth' in c_lower or 'login' in t_lower or 'register' in t_lower:
                    if edit_files:
                        return f"Now let me improve the authentication flow. I'll update {file_names} to handle edge cases."
                    return f"Now let me set up the authentication logic. I'll wire up {file_names} to handle user sessions securely."
                elif 'api' in t_lower or 'route' in t_lower or 'backend' in c_lower:
                    if edit_files:
                        return f"Now let me improve the API routes in {file_names} to handle requests more gracefully."
                    return f"Setting up the API layer. I'll create the routes in {file_names} so the frontend can talk to the backend."
                elif 'ui' in t_lower or 'component' in t_lower or 'page' in t_lower or 'frontend' in c_lower:
                    if edit_files:
                        return f"Now let me update the UI in {file_names} to improve the layout and user experience."
                    return f"Let's build the frontend components. I'll set up {file_names} to give users a great experience."
                elif 'database' in c_lower or 'model' in c_lower or 'schema' in t_lower:
                    return f"Now I need to define our data models. I'll set up the structures in {file_names}."
                elif 'style' in t_lower or 'css' in t_lower:
                    return f"Let me polish the styling. I'll update {file_names} to make the interface look modern and clean."
                elif 'config' in c_lower or 'env' in t_lower:
                    return f"Getting the configuration right. I'll modify {file_names} to ensure the app is set up correctly."
                elif edit_files and not new_files:
                    return f"Now let me revisit {file_names} and make the necessary improvements."
                elif new_files and not edit_files:
                    return f"Let's set up {file_names} to implement this part from scratch."
                else:
                    return f"Moving on to the next task. I'll update {file_names} to bring this feature together."

            if file_count > 0:
                task_narration = build_task_narration()
                narr_act = self._make_activity("narration", task_narration, task_title=task_title)
                narr_msg = json.dumps({"type": "narration", "message": task_narration, "timestamp": str(int(time.time() * 1000))})
                async for ev in self._emit(workspace_id, activities=[narr_act], progress_msg=narr_msg):
                    yield ev
                # SLOW DOWN: Give the user time to read the text!
                await asyncio.sleep(1.2)

            for f in files_to_write:
                path = f.get("path", "")
                if path.startswith("/"):
                    path = path[1:]
                content = f.get("content")
                if path and content is not None:
                    dir_path = os.path.dirname(path)
                    if dir_path and dir_path != ".":
                        full_dir = os.path.join(ws_root, dir_path) if ws_root else ""
                        dir_exists_on_disk = bool(full_dir and os.path.isdir(full_dir))
                        dir_seen_this_run = dir_path in created_dirs
                        
                        workspace_manager.mkdir(workspace_id, dir_path)
                        created_dirs.add(dir_path)
                        
                        if not dir_exists_on_disk and not dir_seen_this_run:
                            mkdir_op = workspace_manager.build_op_mkdir(dir_path)
                            task_ops.append(mkdir_op)
                            mkdir_act = self._make_activity("mkdir", f"Created folder `{dir_path}/`", path=dir_path, task_title=task_title)
                            progress_msg = json.dumps({
                                "type": "tool_action",
                                "action": "mkdir",
                                "details": f"Created folder {dir_path}",
                                "timestamp": str(int(time.time() * 1000))
                            })
                            await self._publish_ops(workspace_id, [mkdir_op], progress_msg, [mkdir_act])

                    full_disk = os.path.join(ws_root, path) if ws_root else ""
                    is_edit = bool(full_disk and os.path.isfile(full_disk))
                    act_type = "edit_file" if is_edit else "write_file"
                    filename = path.split('/')[-1]

                    # Build a smart, v0-style file label based on task context
                    def smart_file_label(fname, is_editing, task_t):
                        base = fname.rsplit('.', 1)[0]  # strip extension
                        t_lower = task_t.lower()
                        if 'fix' in t_lower or 'error' in t_lower or 'bug' in t_lower:
                            verb = 'Fixed' if is_editing else 'Created'
                            return f"{verb} {base} error handling"
                        elif 'improve' in t_lower or 'better' in t_lower or 'enhance' in t_lower:
                            return f"Improved {base}"
                        elif 'auth' in t_lower and is_editing:
                            return f"Updated {base} authentication"
                        elif 'add' in t_lower and not is_editing:
                            return f"Added {base}"
                        elif is_editing:
                            return f"Updated {base}"
                        else:
                            return f"Created {base}"

                    file_label = smart_file_label(filename, is_edit, task_title)
                    file_act = self._make_activity(act_type, file_label, path=path, task_title=task_title)

                    lines_added = 0
                    lines_removed = 0
                    if is_edit:
                        try:
                            with open(full_disk, 'r', encoding='utf-8') as df:
                                old_content = df.read()
                            import difflib
                            diff = list(difflib.ndiff(old_content.splitlines(), content.splitlines()))
                            lines_added = sum(1 for line in diff if line.startswith('+ '))
                            lines_removed = sum(1 for line in diff if line.startswith('- '))
                        except Exception:
                            lines_added = len(content.splitlines())
                    else:
                        lines_added = len(content.splitlines())

                    print(f"DEBUG: BuilderAgent writing file '{path}' ({len(content)} bytes)...")
                    success = workspace_manager.write_file(workspace_id, path, content)
                    if not success:
                        print(f"ERROR: BuilderAgent failed to write file: {path}")
                        task_error = f"Failed to write file: {path}"
                        break
                    write_op = workspace_manager.build_op_write_file(path, content)
                    task_ops.append(write_op)
                    event_type = "file_updated" if is_edit else "file_created"
                    progress_msg = json.dumps({
                        "type": event_type,
                        "file": path,
                        "reason": f.get("explanation") or "Updated file based on task requirements",
                        "expectedResult": f"{path} is correctly implemented",
                        "linesAdded": lines_added,
                        "linesRemoved": lines_removed,
                        "timestamp": str(int(time.time() * 1000))
                    })
                    await self._publish_ops(workspace_id, [write_op], progress_msg, [file_act])
                    # SLOW DOWN: step-by-step file rendering
                    await asyncio.sleep(0.4)
                    async for ev in self._emit(workspace_id, activities=[file_act], progress_msg=progress_msg, workspace_ops=[write_op]):
                        yield ev
                    print(f"DEBUG: BuilderAgent successfully wrote file: {path}")

            if not task_error:
                for cmd in filter_webcontainer_commands(result.get("commands", [])):
                    cmd_act = self._make_activity("run_command", f"Running `{cmd}`", detail=cmd, task_title=task_title, status="running")
                    print(f"DEBUG: BuilderAgent queueing command for WebContainer: {cmd}")
                    run_ops = workspace_manager.commands_to_ops([cmd], webcontainer=True)
                    task_ops.extend(run_ops)
                    progress_msg = json.dumps({
                        "type": "tool_action",
                        "action": "run_command",
                        "details": cmd,
                        "timestamp": str(int(time.time() * 1000))
                    })
                    await self._publish_ops(workspace_id, run_ops, progress_msg, [cmd_act])
                    async for ev in self._emit(workspace_id, activities=[cmd_act], progress_msg=progress_msg, workspace_ops=run_ops):
                        yield ev

                done_act = self._make_activity(
                    "task_done",
                    task_title,
                    task_title=task_title,
                    status="done" if not task_error else "failed",
                )
                progress_msg = json.dumps({
                    "type": "task_completed",
                    "taskId": str(index),
                    "title": task_title,
                    "timestamp": str(int(time.time() * 1000))
                })
                async for ev in self._emit(
                    workspace_id,
                    activities=[done_act],
                    progress_msg=progress_msg,
                ):
                    yield ev

        status = "completed" if not task_error else "failed"
        print(f"DEBUG: Task {index+1} execution finished with status: {status}")
        summary = result.get("summary", "Done") if not task_error else task_error

        executed_tasks.append({
            "task": current_task.get("title"),
            "category": category,
            "status": status,
            "summary": summary
        })
        
        tasks[index]["status"] = status
        if task_error:
            tasks[index]["error"] = task_error

        state["executed_tasks"] = executed_tasks
        
        if task_error:
            state["status"] = "error"
            state["error_msg"] = task_error
            state["current_task_index"] = index + 1
            yield state
            return

        state["current_task_index"] = index + 1
        print(f"DEBUG: BuilderAgent finishing - Next Index will be: {state['current_task_index']}")
        
        if state["current_task_index"] < len(tasks):
            state["status"] = "building"
            state["next_agent"] = "builder"
        else:
            state["status"] = "building_complete"
            state["next_agent"] = "runner"
            
        yield state
        return
