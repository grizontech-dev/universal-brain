from typing import Any, Dict, List
import os
import json
import time
import asyncio
from Brain.shared.agent import BaseAgent
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langchain_core.runnables import RunnableConfig
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
            model_id="deepseek-chat"
        )
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.0)

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
        session_id = workspace_id  # alias for clarity — both refer to the same job/session ID
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
        print(f"DEBUG: Builder routing to {category} via LangGraph MCP tools...")

        framework = state.get("framework", "react")

        if category == "frontend":
            system_prompt = (
                f"You are the Frontend Agent. Stack: {framework} in `frontend/`.\n"
                "You build production-quality, connected UIs that appear correctly in the live preview.\n\n"
                "FRONTEND AGENT RULES:\n"
                "1. **CRITICAL — Vite entry**: `frontend/src/main.jsx` imports `./App.jsx` ONLY. `App.tsx` is NEVER used.\n"
                "2. **App.jsx is the product** — You MUST include `frontend/src/App.jsx` in every response that adds or changes components.\n"
                "3. **react-router-dom & Connection** — ALWAYS connect all components, pages, and everything in `App.jsx`.\n"
                "4. **MCP SANDBOX REQUIREMENT (ABSOLUTE)**: You MUST use the client_save_code tool for EVERY file.\n"
                "5. You MUST use client_execute_in_sandbox to run code. ALL web servers MUST run on port 9999 and bind to 0.0.0.0. For Vite, use --port 9999 --host 0.0.0.0.\n"
                "6. After saving files, ALWAYS call client_execute_in_sandbox as the final step.\n"
                "7. If the client_execute_in_sandbox tool returns a Tunnel URL, explicitly include this Tunnel URL in your final response."
            )
        else:
            system_prompt = (
                "You are the Backend Agent. Express API in `backend/`.\n\n"
                "BACKEND AGENT RULES:\n"
                "1. **Always update `backend/server.js`** when you add or change any route.\n"
                "2. **Structure**: `backend/routes/*.js`, `backend/controllers/*.js`.\n"
                "3. **Supabase**: controllers import `{ supabase }` from `../supabase/client.js`.\n"
                "4. **package.json**: add express, cors, @supabase/supabase-js, etc. in dependencies when needed.\n"
                "5. **MCP SANDBOX REQUIREMENT (ABSOLUTE)**: You MUST use the client_save_code tool for EVERY file.\n"
                "6. You MUST use client_execute_in_sandbox to run code. ALL web servers MUST run on port 9999 and bind to 0.0.0.0.\n"
                "7. After saving files, ALWAYS call client_execute_in_sandbox as the final step.\n"
                "8. If the client_execute_in_sandbox tool returns a Tunnel URL, explicitly include this Tunnel URL in your final response."
            )

        agent = create_react_agent(self.llm, tools=[client_save_code, client_execute_in_sandbox], prompt=system_prompt)
        
        config = RunnableConfig(
            configurable={"thread_id": session_id, "task_title": task_title},
            recursion_limit=100
        )
        
        try:
            instruction = f"Task Title: {task_title}\nDescription: {current_task.get('description', '')}"
            res = await agent.ainvoke({"messages": [("user", instruction)]}, config=config)
            output_content = res["messages"][-1].content
        except Exception as e:
            output_content = f"Error during execution: {e}"
            print(f"DEBUG: LangGraph Error: {e}")

        print(f"DEBUG: BuilderAgent completed task '{task_title}'. Output length: {len(output_content)}")

        state["plan"][index]["status"] = "completed"
        state["plan"][index]["result"] = output_content
        state["executed_tasks"].append({
            **current_task,
            "status": "completed",
            "result": output_content
        })
        state["status"] = "running"
        state["current_task_index"] = index + 1
        
        if session_id and not str(session_id).startswith("error:"):
            end_act = self._make_activity(
                "task_complete",
                f"Completed — {task_title}",
                task_title=task_title,
            )
            progress_msg = json.dumps({
                "type": "task_completed",
                "taskId": str(index),
                "title": task_title,
                "timestamp": str(int(time.time() * 1000))
            })
            async for ev in self._emit(session_id, activities=[end_act], progress_msg=progress_msg):
                yield ev

        yield state
