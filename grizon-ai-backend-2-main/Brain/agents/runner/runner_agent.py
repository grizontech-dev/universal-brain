from typing import Any, Dict, List
from Brain.shared.agent import BaseAgent
from Brain.services.sandbox_mcp_service import (
    get_sandbox_mcp_service,
    RUNTIME_SANDBOX_MCP,
)
from Brain.services.websocket_manager import ws_manager

import json
import time


class RunnerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Runner",
            description="Deploys the built project to the remote sandbox MCP server.",
            model_id="deepseek-chat"
        )

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        session_id = state.get("current_job_id")
        if not session_id:
            state["run_report"] = "Error: No workspace found."
            return state

        # Determine entrypoint — prefer frontend (Vite) over backend
        tasks = state.get("plan", [])
        has_frontend = any(t.get("category") == "frontend" for t in tasks)
        entrypoint = "frontend/package.json" if has_frontend else (state.get("sandbox_entrypoint") or "backend/server.js")

        sandbox_mcp = get_sandbox_mcp_service()

        deploy_act = {
            "id": f"act-deploy-{int(time.time())}",
            "type": "run_command",
            "label": f"Packaging workspace and deploying to sandbox…",
            "status": "running",
            "timestamp": int(time.time() * 1000),
        }
        progress_msg = json.dumps({
            "type": "tool_action",
            "action": "deploy_sandbox",
            "details": f"Deploying workspace to remote MCP sandbox…",
            "timestamp": str(int(time.time() * 1000))
        })
        await ws_manager.broadcast_to_sandbox(
            str(session_id),
            {
                "type": "workspace_ops",
                "ops": [],
                "progress_msg": progress_msg,
                "activities": [deploy_act],
            },
        )

        # Use deploy_workspace which tars the local workspace and uploads it
        deploy_result = await sandbox_mcp.deploy_workspace(
            str(session_id), entrypoint
        )

        plan = state.get("plan", [])
        for t in plan:
            if t.get("category") == "runner":
                t["status"] = "executing"

        status = deploy_result.get("status", "unknown")
        execution_output = deploy_result.get("raw") or deploy_result.get("execution_output", "")
        tunnel_url = deploy_result.get("tunnel_url")

        print(f"DEBUG: RunnerAgent deploy_result: {json.dumps(deploy_result, default=str)[:500]}")
        print(f"DEBUG: RunnerAgent tunnel_url: {tunnel_url}")

        # If tunnel_url in raw output, extract it
        if not tunnel_url and execution_output:
            import re
            match = re.search(r'https://[\w-]+\.trycloudflare\.com', str(execution_output))
            if match:
                tunnel_url = match.group(0)
                print(f"DEBUG: RunnerAgent extracted tunnel_url from output: {tunnel_url}")

        if "sandbox_job" not in state:
            state["sandbox_job"] = {}
        state["sandbox_job"]["runtime"] = RUNTIME_SANDBOX_MCP
        state["sandbox_job"]["tunnel_url"] = tunnel_url
        state["sandbox_job"]["deploy_result"] = deploy_result
        state["sandbox_job"]["await_preview"] = True

        # Broadcast the tunnel URL over WebSocket so the frontend canvas loads it
        if tunnel_url:
            await ws_manager.broadcast_to_sandbox(str(session_id), {
                "type": "sandbox_ready",
                "tunnel_url": tunnel_url,
                "url": tunnel_url,
                "stream_url": tunnel_url,
            })
            ready_act = {
                "id": f"act-live-{int(time.time())}",
                "type": "terminal_output",
                "label": f"Live at: {tunnel_url}",
                "status": "done",
                "detail": tunnel_url,
                "timestamp": int(time.time() * 1000),
            }
            await ws_manager.broadcast_to_sandbox(str(session_id), {
                "type": "workspace_ops",
                "ops": [],
                "activities": [ready_act],
                "progress_msg": f"Sandbox ready: {tunnel_url}",
            })

        state["status"] = "running" if status != "error" else "error"
        state["run_report"] = (
            f"### Sandbox Deployment\n"
            f"Status: {status}\n"
            f"Entrypoint: {entrypoint}\n"
            f"Output:\n{execution_output}\n"
        )
        if tunnel_url:
            state["run_report"] += f"\nTunnel URL: {tunnel_url}"

        state["plan"] = plan
        state["execute_sandbox"] = {
            "workspace_ops": [],
            "activities": [
                {
                    "id": f"act-deploy-done-{int(time.time())}",
                    "type": "run_command",
                    "label": f"Sandbox deployment: {status}",
                    "status": "done" if status != "error" else "failed",
                    "timestamp": int(time.time() * 1000),
                }
            ],
            "progress_msg": json.dumps({
                "type": "build_success" if status != "error" else "build_error",
                "status": status,
                "tunnel_url": tunnel_url,
                "timestamp": str(int(time.time() * 1000))
            }),
            "sandbox_job": state["sandbox_job"],
            "plan": plan,
            "current_task_index": len(plan),
        }

        return state

