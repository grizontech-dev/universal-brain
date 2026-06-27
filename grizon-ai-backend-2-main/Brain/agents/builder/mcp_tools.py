import os
import json
import time
import base64
import tarfile
import io
from typing import List, Dict, Any
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from Brain.services.workspace_manager import workspace_manager
from Brain.services.websocket_manager import ws_manager
from Brain.services.sandbox_mcp_service import get_sandbox_mcp_service

def _make_activity(act_type: str, label: str, path: str = "", task_title: str = "") -> Dict[str, Any]:
    return {
        "id": f"act-{int(time.time() * 1000)}-{act_type}",
        "type": act_type,
        "label": label,
        "path": path or None,
        "taskTitle": task_title or None,
        "status": "done",
        "timestamp": int(time.time() * 1000),
    }

@tool
async def client_save_code(file_path: str, code_content: str, config: RunnableConfig) -> str:
    """Saves a single file directly into the sandbox session's workspace directory on the server."""
    session_id = config.get("configurable", {}).get("thread_id")
    task_title = config.get("configurable", {}).get("task_title", "Writing Code")
    
    print(f"[MCP_TOOLS] client_save_code called | file={file_path} | session={session_id}")

    if not session_id:
        return "ERROR: session_id (thread_id) not provided in config."

    ws_root = workspace_manager.resolve_workspace_path(str(session_id))
    if not ws_root:
        print(f"[MCP_TOOLS] ERROR: workspace not found for session={session_id}")
        return f"ERROR: Could not resolve workspace path for session '{session_id}'."

    abs_path = os.path.abspath(os.path.join(ws_root, file_path))
    if not abs_path.startswith(os.path.abspath(ws_root)):
        return "ERROR: Invalid file path."

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(code_content)

    print(f"[MCP_TOOLS] Saved OK | {file_path} -> {abs_path} | size={len(code_content)}")

    # Emit WebSocket event
    act = _make_activity("edit_file", f"Saved {file_path}", path=file_path, task_title=task_title)
    progress_msg = json.dumps({
        "type": "file_updated",
        "file": file_path,
        "timestamp": str(int(time.time() * 1000))
    })
    
    await ws_manager.broadcast_to_sandbox(session_id, {
        "type": "workspace_ops",
        "ops": [],
        "activities": [act],
        "progress_msg": progress_msg
    })

    return f"Successfully saved {file_path} to local workspace."

@tool
async def client_execute_in_sandbox(commands_to_run: List[str], entry_file: str, port_to_expose: int, config: RunnableConfig) -> str:
    """Packages the workspace, deploys it to the remote sandbox, and runs the commands."""
    session_id = config.get("configurable", {}).get("thread_id")
    task_title = config.get("configurable", {}).get("task_title", "Deploying")

    print(f"[MCP_TOOLS] client_execute_in_sandbox called | session={session_id} | entry={entry_file}")

    if not session_id:
        return "ERROR: session_id not provided."
        
    ws_root = workspace_manager.resolve_workspace_path(str(session_id))
    if not ws_root or not os.path.exists(ws_root):
        print(f"[MCP_TOOLS] ERROR: workspace not found for session={session_id}")
        return "ERROR: Workspace directory not found."

    print(f"[MCP_TOOLS] Packaging workspace from: {ws_root}")

    # Package workspace to base64
    memory_file = io.BytesIO()
    with tarfile.open(fileobj=memory_file, mode="w:gz") as tar:
        for root, dirs, files in os.walk(ws_root):
            if "node_modules" in dirs:
                dirs.remove("node_modules")
            if ".git" in dirs:
                dirs.remove(".git")
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, ws_root)
                tar.add(full_path, arcname=rel_path)
    
    memory_file.seek(0)
    encoded_archive = base64.b64encode(memory_file.read()).decode("utf-8")
    print(f"[MCP_TOOLS] Archive ready | size={len(encoded_archive)} chars")

    act = _make_activity("terminal", f"Running '{' && '.join(commands_to_run)}'", task_title=task_title)
    await ws_manager.broadcast_to_sandbox(session_id, {
        "type": "workspace_ops",
        "ops": [],
        "activities": [act],
        "progress_msg": f"Deploying to sandbox: {commands_to_run}"
    })

    sandbox_mcp = get_sandbox_mcp_service()
    if not sandbox_mcp._initialized:
        await sandbox_mcp.initialize()
        
    mcp_tool = sandbox_mcp._tools.get("execute_workspace_archive")
    if not mcp_tool:
        return "ERROR: execute_workspace_archive tool not found on remote server."

    try:
        print(f"[MCP_TOOLS] Calling MCP execute_workspace_archive...")
        response = await mcp_tool.ainvoke({
            "session_id": session_id,
            "entrypoint": entry_file,
            "archive_b64": encoded_archive,
        })
        print(f"[MCP_TOOLS] MCP response type: {type(response).__name__} | len={len(str(response)[:200])}")
        
        # MCP returns list format: [{'type': 'text', 'text': '{...json...}'}]
        output_data = response
        if isinstance(response, list) and response:
            inner = response[0]
            inner_text = inner.get("text", str(inner)) if isinstance(inner, dict) else str(inner)
            try:
                output_data = json.loads(inner_text)
            except Exception:
                output_data = {"raw": inner_text}
        elif isinstance(response, str):
            try:
                output_data = json.loads(response)
            except Exception:
                pass
                
        if isinstance(output_data, dict):
            output_text = output_data.get("output", output_data.get("execution_output", str(response)))
            tunnel_url = output_data.get("tunnel_url", "")
            if tunnel_url:
                print(f"[MCP_TOOLS] TUNNEL URL: {tunnel_url}")
                output_text += f"\nTunnel URL: {tunnel_url}"
                # Broadcast dedicated sandbox_ready event so the frontend canvas loads the preview
                await ws_manager.broadcast_to_sandbox(session_id, {
                    "type": "sandbox_ready",
                    "tunnel_url": tunnel_url,
                    "url": tunnel_url,
                    "stream_url": tunnel_url,
                })
                # Also embed in a workspace_ops progress_msg so the regex scanner picks it up
                ready_act = _make_activity("terminal_output", f"Live at: {tunnel_url}", task_title=task_title)
                await ws_manager.broadcast_to_sandbox(session_id, {
                    "type": "workspace_ops",
                    "ops": [],
                    "activities": [ready_act],
                    "progress_msg": f"Sandbox ready: {tunnel_url}"
                })
                
            term_act = _make_activity("terminal_output", f"Sandbox Output", task_title=task_title)
            await ws_manager.broadcast_to_sandbox(session_id, {
                "type": "workspace_ops",
                "ops": [],
                "activities": [term_act],
                "progress_msg": f"Sandbox execution complete."
            })
            return f"Execution Output:\n{output_text}"
            
        return f"Execution Output:\n{response}"
        
    except Exception as e:
        print(f"[MCP_TOOLS] ERROR in execute_in_sandbox: {e}")
        return f"ERROR: Remote execution call failed: {e}"
