from typing import Any, Dict, List
from Brain.shared.agent import BaseAgent
from Brain.services.workspace_manager import workspace_manager, RUNTIME_WEBCONTAINER
from Brain.services.template_service import normalize_framework
from Brain.services.websocket_manager import ws_manager

class RunnerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Runner",
            description="Starts the built project in the WebContainer runtime.",
            model_id="deepseek-chat"
        )

    async def _publish_ops(self, workspace_id: str, ops: List[Dict[str, Any]], progress_msg: str = ""):
        if not ops:
            return
        payload: Dict[str, Any] = {"type": "workspace_ops", "ops": ops}
        if progress_msg:
            payload["progress_msg"] = progress_msg
        await ws_manager.broadcast_to_sandbox(workspace_id, payload)

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        workspace_id = state.get("current_job_id")
        if not workspace_id:
            state["run_report"] = "❌ Error: No workspace found."
            return state

        framework = normalize_framework(state.get("framework"))
        preview_port = 3000 if framework == "next" else 5173

        startup_ops = workspace_manager.build_webcontainer_startup_ops(framework)
        run_config = {
            "framework": framework,
            "preview_port": preview_port,
            "steps": [
                "backend: npm install",
                "backend: npm start",
                "frontend: npm install",
                f"frontend: npm run dev (port {preview_port})",
            ],
        }

        plan = state.get("plan", [])
        runner_title = next(
            (t.get("title") or t.get("task") for t in plan if t.get("category") == "runner"),
            "Runner: Install & Start Servers",
        )
        runner_activities = [
            {
                "id": f"act-runner-{int(__import__('time').time())}",
                "type": "run_command",
                "label": "backend: npm install → npm start",
                "status": "running",
                "timestamp": int(__import__("time").time() * 1000),
            },
            {
                "id": f"act-runner-fe-{int(__import__('time').time())}",
                "type": "run_command",
                "label": f"frontend: npm install → npm run dev (port {preview_port})",
                "status": "running",
                "timestamp": int(__import__("time").time() * 1000),
            },
        ]
        import time
        import json
        progress_msg = json.dumps({
            "type": "tool_action",
            "action": "run_command",
            "details": "Starting dev server...",
            "timestamp": str(int(time.time() * 1000))
        })
        await ws_manager.broadcast_to_sandbox(
            workspace_id,
            {
                "type": "workspace_ops",
                "ops": startup_ops,
                "progress_msg": progress_msg,
                "activities": runner_activities,
            },
        )

        for t in plan:
            if t.get("category") == "runner":
                t["status"] = "executing"

        if "sandbox_job" not in state:
            state["sandbox_job"] = {}
        state["sandbox_job"]["runtime"] = RUNTIME_WEBCONTAINER
        state["sandbox_job"]["startup_ops"] = startup_ops
        state["sandbox_job"]["await_preview"] = True

        state["run_config"] = run_config
        state["status"] = "running"
        state["run_report"] = (
            f"### 🚀 Project starting in WebContainer\n"
            f"Framework: {framework}\n"
            f"1. `backend`: npm install → npm start\n"
            f"2. `frontend`: npm install → npm run dev (preview port {preview_port})\n\n"
            f"Preview will appear when Vite is ready."
        )
        state["plan"] = plan
        state["execute_sandbox"] = {
            "workspace_ops": startup_ops,
            "activities": runner_activities,
            "progress_msg": json.dumps({
                "type": "build_success",
                "status": "success",
                "timestamp": str(int(time.time() * 1000))
            }),
            "sandbox_job": state["sandbox_job"],
            "plan": plan,
            "current_task_index": len(plan),
        }

        return state
