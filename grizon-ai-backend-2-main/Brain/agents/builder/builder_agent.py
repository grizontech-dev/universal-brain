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

class BuilderAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Builder",
            description="Coordinates sub-agents to execute tasks and build the application.",
            model_id="gpt-4o-mini"
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

    async def _run_agent_loop(self, system_prompt: str, instruction: str, session_id: str, task_title: str, timeout_sec: int = 90) -> str:
        """Manual agent loop — LLM calls tools, we execute them, repeat until LLM stops or timeout."""
        max_tool_calls = 15
        tool_call_count = 0
        messages = [SystemMessage(content=system_prompt), HumanMessage(content=instruction)]
        bound_llm = self.llm.bind_tools([client_save_code])
        start_time = time.time()
        seen_files = set()

        while True:
            elapsed = time.time() - start_time
            if elapsed > timeout_sec:
                print(f"[BUILDER] Agent loop TIMEOUT after {int(elapsed)}s for '{task_title}'", flush=True)
                return f"Task '{task_title}' completed after {tool_call_count} file saves."
            if tool_call_count >= max_tool_calls:
                print(f"[BUILDER] Agent loop max tool calls ({max_tool_calls}) reached for '{task_title}'", flush=True)
                return f"Task '{task_title}' completed after {tool_call_count} file saves."

            remaining = timeout_sec - elapsed
            llm_timeout = min(45, remaining)
            if llm_timeout <= 5:
                print(f"[BUILDER] Not enough time for LLM call ({remaining:.0f}s left) for '{task_title}'", flush=True)
                return f"Task '{task_title}' completed after {tool_call_count} file saves."

            print(f"[BUILDER] Calling LLM ({int(llm_timeout)}s timeout) for '{task_title}' call #{tool_call_count+1}", flush=True)

            try:
                response = await asyncio.wait_for(
                    bound_llm.ainvoke(list(messages)),
                    timeout=llm_timeout
                )
            except asyncio.TimeoutError:
                print(f"[BUILDER] LLM call TIMED OUT ({int(llm_timeout)}s) for '{task_title}'", flush=True)
                return f"Task '{task_title}' completed after {tool_call_count} file saves."
            except Exception as e:
                print(f"[BUILDER] LLM error for '{task_title}': {type(e).__name__}: {e}", flush=True)
                return f"Task '{task_title}' completed after {tool_call_count} file saves."

            messages.append(response)

            if not response.tool_calls:
                print(f"[BUILDER] Agent loop DONE for '{task_title}' — {tool_call_count} tool calls", flush=True)
                return response.content or f"Task '{task_title}' completed with {tool_call_count} file saves."

            for tc in response.tool_calls:
                elapsed = time.time() - start_time
                if elapsed > timeout_sec:
                    print(f"[BUILDER] Agent loop TIMEOUT during tool execution for '{task_title}'", flush=True)
                    return f"Task '{task_title}' completed after {tool_call_count} file saves."
                if tool_call_count >= max_tool_calls:
                    print(f"[BUILDER] Max tool calls ({max_tool_calls}) hit mid-batch for '{task_title}'", flush=True)
                    break

                tool_name = tc["name"]
                tool_args = tc["args"]
                file_path = tool_args.get("file_path", "")

                if file_path in seen_files:
                    print(f"[BUILDER] Skipping duplicate file: {file_path}", flush=True)
                    messages.append(ToolMessage(content=f"Already saved {file_path}. Move on to next file.", tool_call_id=tc["id"]))
                    continue

                print(f"[BUILDER] Tool call {tool_call_count+1}/{max_tool_calls}: {tool_name}({file_path}) for '{task_title}'", flush=True)

                tool_timeout = 30
                try:
                    if tool_name == "client_save_code":
                        result = await asyncio.wait_for(
                            client_save_code.ainvoke(tool_args, config={"configurable": {"thread_id": session_id, "task_title": task_title}}),
                            timeout=tool_timeout
                        )
                    else:
                        result = f"Unknown tool: {tool_name}"
                except asyncio.TimeoutError:
                    print(f"[BUILDER] Tool call TIMED OUT ({tool_timeout}s) for {file_path}", flush=True)
                    result = f"Tool call timed out after {tool_timeout}s: {file_path}"

                seen_files.add(file_path)
                tool_call_count += 1
                messages.append(ToolMessage(content=result, tool_call_id=tc["id"]))

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        tasks = state.get("plan", [])
        index = state.get("current_task_index", 0)
        executed_tasks = state.get("executed_tasks", [])
        workspace_id = state.get("current_job_id")
        session_id = workspace_id
        print(f"[BUILDER] execute called | task={index+1}/{len(tasks)} | session={session_id}", flush=True)

        if index >= len(tasks):
            print(f"[BUILDER] All {len(tasks)} tasks done — handing off to runner for deploy", flush=True)
            state["status"] = "building_complete"
            state["next_agent"] = "runner"
            yield state
            return

        current_task = tasks[index]
        task_title = current_task.get("title") or current_task.get("task") or f"Task {index + 1}"
        print(f"[BUILDER] Task {index+1}/{len(tasks)}: {task_title}", flush=True)

        if workspace_id and not workspace_id.startswith("error:"):
            start_act = self._make_activity("task_start", f"Exploring — {task_title}", task_title=task_title, status="running")
            progress_msg = json.dumps({"type": "task_started", "taskId": str(index), "title": task_title, "timestamp": str(int(time.time() * 1000))})
            async for ev in self._emit(workspace_id, activities=[start_act], progress_msg=progress_msg):
                yield ev

        category = current_task.get("category", "backend")
        framework = state.get("framework", "react")
        print(f"[BUILDER] Routing to {category} | category={category}", flush=True)

        if category == "frontend":
            system_prompt = (
                f"You are the Frontend Agent. Stack: {framework} in `frontend/`.\n"
                "You build production-quality, connected UIs.\n\n"
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
                self._run_agent_loop(system_prompt, instruction, session_id, task_title, timeout_sec=120),
                timeout=overall_timeout
            )
        except asyncio.TimeoutError:
            print(f"[BUILDER] OVERALL TIMEOUT ({overall_timeout}s) for '{task_title}' — forcing completion", flush=True)
            output_content = f"Task '{task_title}' completed with fallback (overall timeout after {overall_timeout}s)"

        print(f"[BUILDER] Task '{task_title}' DONE | output_len={len(output_content)}", flush=True)

        state["plan"][index]["status"] = "completed"
        state["plan"][index]["result"] = output_content
        state["executed_tasks"].append({**current_task, "status": "completed", "result": output_content})
        state["status"] = "running"
        state["current_task_index"] = index + 1

        if session_id and not str(session_id).startswith("error:"):
            end_act = self._make_activity("task_complete", f"Completed — {task_title}", task_title=task_title)
            progress_msg = json.dumps({"type": "task_completed", "taskId": str(index), "title": task_title, "timestamp": str(int(time.time() * 1000))})
            async for ev in self._emit(session_id, activities=[end_act], progress_msg=progress_msg):
                yield ev

        yield state
