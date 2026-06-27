from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query
from typing import Optional
from Brain.services.websocket_manager import ws_manager
from Brain.services.workspace_watcher import watcher_manager
from Brain.services.workspace_manager import workspace_manager
from Brain.services.template_service import get_bootstrap_ops, list_frameworks, normalize_framework
from Brain.services.build_resume import get_resume_payload, latest_todo_list_from_messages
from Brain.modules.conversations.service import conversation_service
import os

router = APIRouter(prefix="/brain/sandbox", tags=["sandbox"])


@router.get("/frameworks")
async def get_frameworks():
    return {"frameworks": list_frameworks()}


@router.get("/resume/{workspace_id}")
async def resume_workspace(
    workspace_id: str,
    framework: Optional[str] = "react",
):
    """
    After page reload: restore files into WebContainer and return startup ops if build is complete.
    """
    host = workspace_manager.resolve_workspace_path(workspace_id)
    if not host or not os.path.exists(host):
        raise HTTPException(status_code=404, detail="Workspace not found")

    messages = conversation_service.get_messages(workspace_id)
    todos = latest_todo_list_from_messages(messages)
    return get_resume_payload(workspace_id, framework=framework or "react", todos=todos)


@router.get("/template-ops")
async def get_template_ops(framework: Optional[str] = "react", frontend_only: bool = False):
    """Return workspace ops to mount templates. Default: express + supabase + frontend."""
    fw = normalize_framework(framework)
    if frontend_only:
        from Brain.services.template_service import FRAMEWORK_TO_FRONTEND_TEMPLATE, template_to_workspace_ops
        tpl = FRAMEWORK_TO_FRONTEND_TEMPLATE.get(fw, "react-template")
        ops = template_to_workspace_ops(tpl)
    else:
        ops = get_bootstrap_ops(fw, include_frontend=True)
    return {"framework": fw, "ops": ops}

@router.websocket("/sync/{workspace_id}")
async def workspace_sync_endpoint(websocket: WebSocket, workspace_id: str):
    """WebContainer workspace sync: file changes + workspace_ops from agents."""
    await ws_manager.connect(websocket, workspace_id)

    host_path = workspace_manager.resolve_workspace_path(workspace_id)
    if host_path and os.path.exists(host_path):
        async def on_file_change(data):
            await ws_manager.broadcast_to_sandbox(workspace_id, data)

        watcher_manager.start_watching(workspace_id, host_path, on_file_change)

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, workspace_id)
    except Exception as e:
        print(f"WebSocket error in {workspace_id}: {e}")
        ws_manager.disconnect(websocket, workspace_id)

@router.get("/read-file")
async def read_file(
    path: str,
    sandbox_id: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
):
    wid = workspace_id or sandbox_id
    if not wid:
        raise HTTPException(status_code=422, detail="sandbox_id or workspace_id is required")
    workspace_path = workspace_manager.resolve_workspace_path(wid)
    if not workspace_path:
        return {"error": "Workspace not found"}

    host_path = os.path.join(workspace_path, path.lstrip("/"))
    if not os.path.exists(host_path):
        return {"error": "File not found"}

    try:
        with open(host_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        return {"error": str(e)}

@router.get("/list-files")
async def list_files(
    sandbox_id: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
):
    wid = workspace_id or sandbox_id
    if not wid:
        raise HTTPException(status_code=422, detail="sandbox_id or workspace_id is required")
    host_path = workspace_manager.resolve_workspace_path(wid)
    print(f"DEBUG: list_files for {wid} -> host_path: {host_path}")
    if not host_path or not os.path.exists(host_path):
        print(f"DEBUG: list_files failed - path does not exist: {host_path}")
        return {"error": "Workspace not found", "files": []}

    def get_tree(path):
        nodes = []
        for item in os.listdir(path):
            if item in [".git", "node_modules", ".next", "dist", "build"]:
                continue
            item_path = os.path.join(path, item)
            rel_path = os.path.relpath(item_path, host_path).replace("\\", "/")
            if os.path.isdir(item_path):
                nodes.append({
                    "name": item,
                    "type": "folder",
                    "path": rel_path,
                    "children": get_tree(item_path)
                })
            else:
                nodes.append({
                    "name": item,
                    "type": "file",
                    "path": rel_path
                })
        return nodes

    try:
        tree = get_tree(host_path)
        return {"files": tree, "runtime": "sandbox_mcp"}
    except Exception as e:
        return {"error": str(e)}
