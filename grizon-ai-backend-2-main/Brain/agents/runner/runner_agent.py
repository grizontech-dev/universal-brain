from typing import Any, Dict, List
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.services.sandbox_mcp_service import (
    get_sandbox_mcp_service,
    RUNTIME_SANDBOX_MCP,
)
from Brain.services.websocket_manager import ws_manager

import json
import os
import time

WS_BASE = os.getenv("WS_BASE_URL", "ws://localhost:8001")

LOG = "[RUNNER]"

class RunnerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Runner",
            description="Deploys the built project to the remote sandbox MCP server.",
            model_id="gemma-4-26b-a4b-it"
        )

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        session_id = state.get("current_job_id")
        print(f"{LOG} ═══ EXECUTE ═══ session={session_id} | tasks={len(state.get('plan', []))}", flush=True)
        if not session_id:
            state["run_report"] = "Error: No workspace found."
            yield state
            return

        # Determine entrypoint — prefer frontend (Vite) over backend
        tasks = state.get("plan", [])
        has_frontend = any(t.get("category") == "frontend" for t in tasks)
        entrypoint = "frontend/src/main.jsx" if has_frontend else (state.get("sandbox_entrypoint") or "backend/server.js")

        sandbox_mcp = get_sandbox_mcp_service()
        sandbox_available = False
        if not sandbox_mcp._initialized:
            try:
                await asyncio.wait_for(sandbox_mcp.initialize(), timeout=15)
                sandbox_available = True
            except asyncio.TimeoutError:
                print("[RUNNER] WARNING: Sandbox MCP init timed out after 15s. Skipping remote deploy.")
            except Exception as e:
                print(f"[RUNNER] WARNING: Sandbox MCP init failed: {e}. Skipping remote deploy.")
        else:
            sandbox_available = True

        if not sandbox_available:
            print("[RUNNER] Sandbox MCP unavailable — skipping remote deploy. Code is in workspace.")
            state["status"] = "complete"
            state["run_report"] = "Build complete. Code saved to workspace. Remote sandbox unavailable — preview not generated."
            state["sandbox_job"] = state.get("sandbox_job") or {}
            state["sandbox_job"]["runtime"] = "local"
            state["sandbox_job"]["await_preview"] = False
            state["execute_sandbox"] = {
                "workspace_ops": [],
                "status": "complete_local",
                "progress_msg": "Build complete (local mode — no remote preview)",
            }
            yield state
            return

        existing_tunnel = sandbox_mcp.get_tunnel_url(str(session_id))
        if existing_tunnel:
            print(f"{LOG} SKIP DEPLOY: tunnel URL already exists from builder: {existing_tunnel}")
            sandbox_job = state.get("sandbox_job") or {}
            sandbox_job["job_id"] = str(session_id)
            sandbox_job["runtime"] = RUNTIME_SANDBOX_MCP
            sandbox_job["tunnel_url"] = existing_tunnel
            sandbox_job["stream_url"] = existing_tunnel
            sandbox_job["await_preview"] = True
            sandbox_job["sync_url"] = f"{WS_BASE}/brain/sandbox/sync/{session_id}"
            state["sandbox_job"] = sandbox_job
            state["tunnel_url"] = existing_tunnel
            state["status"] = "running"
            state["run_report"] = f"Deploy already complete. Tunnel URL: {existing_tunnel}"
            state["execute_sandbox"] = {
                "workspace_ops": [],
                "status": "complete",
                "progress_msg": f"Sandbox ready: {existing_tunnel}",
            }
            await ws_manager.broadcast_to_sandbox(str(session_id), {
                "type": "sandbox_ready",
                "tunnel_url": existing_tunnel,
                "url": existing_tunnel,
                "stream_url": existing_tunnel,
            })
            yield state
            return

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

        # Spawn deploy as a DETACHED background task so it survives
        # the HTTP request cancel scope. The deploy takes 30-300s (npm install + tunnel).
        # If awaited inside the request handler, anyio cancels it when the client disconnects.
        import asyncio as _bgio

        async def _background_deploy(_sid, _entrypoint, _state):
            """Runs outside the HTTP request cancel scope."""
            print(f"[RUNNER] _background_deploy started | session={_sid}")

            _user_id = _state.get("user_id")
            print(f"[RUNNER] _background_deploy | user_id={_user_id} | type={type(_user_id).__name__}")
            print(f"[RUNNER] _background_deploy | state keys={list(_state.keys())[:15]}")

            try:
                deploy_result = await sandbox_mcp.deploy_workspace(
                    str(_sid), _entrypoint, user_id=_user_id
                )
            except Exception as e:
                print(f"[RUNNER] _background_deploy FAILED: {e}")
                deploy_result = {"status": "error", "error": str(e)}

            print(f"[RUNNER] _background_deploy done | status={deploy_result.get('status')} | tunnel={(deploy_result.get('tunnel_url') or 'none')[:80]}")

            execution_output = deploy_result.get("raw") or deploy_result.get("execution_output", "")
            tunnel_url = deploy_result.get("tunnel_url")

            if not tunnel_url and execution_output:
                import re
                match = re.search(r'https://[\w-]+\.trycloudflare\.com', str(execution_output))
                if match:
                    tunnel_url = match.group(0)
                    print(f"[RUNNER] extracted tunnel_url from output: {tunnel_url}")

            sandbox_job = _state.get("sandbox_job", {})
            sandbox_job["job_id"] = str(_sid)
            sandbox_job["runtime"] = RUNTIME_SANDBOX_MCP
            sandbox_job["tunnel_url"] = tunnel_url
            sandbox_job["stream_url"] = tunnel_url
            sandbox_job["deploy_result"] = deploy_result
            sandbox_job["await_preview"] = True
            sandbox_job["sync_url"] = f"{WS_BASE}/brain/sandbox/sync/{_sid}"

            if tunnel_url:
                sandbox_mcp.store_tunnel_url(str(_sid), tunnel_url)
                print(f"[RUNNER] Broadcasting tunnel URL: {tunnel_url}")
                await ws_manager.broadcast_to_sandbox(str(_sid), {
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
                await ws_manager.broadcast_to_sandbox(str(_sid), {
                    "type": "workspace_ops",
                    "ops": [],
                    "activities": [ready_act],
                    "progress_msg": f"Sandbox ready: {tunnel_url}",
                })

            status = deploy_result.get("status", "unknown")
            exe_status = "running" if status != "error" else "error"
            run_report = (
                f"### Sandbox Deployment\n"
                f"Status: {status}\n"
                f"Entrypoint: {_entrypoint}\n"
                f"Output:\n{execution_output}\n"
            )
            if tunnel_url:
                run_report += f"\nTunnel URL: {tunnel_url}"

            final_payload = {
                "type": "build_success" if status != "error" else "build_error",
                "status": status,
                "tunnel_url": tunnel_url,
                "timestamp": str(int(time.time() * 1000))
            }
            await ws_manager.broadcast_to_sandbox(str(_sid), {
                "type": "workspace_ops",
                "ops": [],
                "activities": [
                    {
                        "id": f"act-deploy-done-{int(time.time())}",
                        "type": "run_command",
                        "label": f"Sandbox deployment: {status}",
                        "status": "done" if status != "error" else "failed",
                        "timestamp": int(time.time() * 1000),
                    }
                ],
                "progress_msg": json.dumps(final_payload),
                "sandbox_job": sandbox_job,
                "plan": _state.get("plan", []),
                "current_task_index": len(_state.get("plan", [])),
            })

            _state["sandbox_job"] = sandbox_job
            _state["run_report"] = run_report
            _state["status"] = exe_status
            _state["tunnel_url"] = tunnel_url
            print(f"[RUNNER] _background_deploy finished | session={_sid} | status={exe_status} | tunnel={tunnel_url}")

        print(f"[RUNNER] Spawning detached deploy task | entrypoint={entrypoint}")
        _bgio.create_task(_background_deploy(session_id, entrypoint, state))

        state["status"] = "running"
        existing_sj = state.get("sandbox_job") or {}
        existing_sj["runtime"] = RUNTIME_SANDBOX_MCP
        existing_sj["await_preview"] = True
        existing_sj["sync_url"] = f"{WS_BASE}/brain/sandbox/sync/{session_id}"
        state["sandbox_job"] = existing_sj
        state["run_report"] = "Deploy started in background — tunnel URL will arrive via WebSocket."
        state["execute_sandbox"] = {
            "workspace_ops": [],
            "activities": [
                {
                    "id": f"act-deploy-start-{int(time.time())}",
                    "type": "run_command",
                    "label": "Deploying workspace to sandbox…",
                    "status": "running",
                    "timestamp": int(time.time() * 1000),
                }
            ],
            "progress_msg": json.dumps({
                "type": "deploy_started",
                "timestamp": str(int(time.time() * 1000))
            }),
        }

        yield state
        return
