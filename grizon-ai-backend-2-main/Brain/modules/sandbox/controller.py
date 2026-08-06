from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from typing import Optional
from Brain.services.websocket_manager import ws_manager
from Brain.services.workspace_watcher import watcher_manager
from Brain.services.workspace_manager import workspace_manager
from Brain.services.template_service import get_bootstrap_ops, list_frameworks, normalize_framework
from Brain.services.build_resume import get_resume_payload, latest_todo_list_from_messages
from Brain.modules.conversations.service import conversation_service
from Brain.services.sandbox_mcp_service import get_sandbox_mcp_service
import os
import httpx

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
    user_id: Optional[str] = Query(None),
):
    wid = workspace_id or sandbox_id
    if not wid:
        raise HTTPException(status_code=422, detail="sandbox_id or workspace_id is required")
    workspace_path = workspace_manager.resolve_workspace_path(wid, user_id=user_id)
    if not workspace_path or not os.path.exists(workspace_path):
        workspace_path = workspace_manager.resolve_workspace_path(wid)
    if not workspace_path:
        return {"error": "Workspace not found"}

    host_path = os.path.join(workspace_path, path.lstrip("/"))
    if not os.path.exists(host_path):
        return {"error": "File not found", "tried": host_path, "workspace": workspace_path}

    try:
        with open(host_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content, "path": host_path}
    except Exception as e:
        return {"error": str(e)}

@router.post("/write-file")
async def write_file(
    request: Request,
    sandbox_id: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
):
    wid = workspace_id or sandbox_id
    if not wid:
        raise HTTPException(status_code=422, detail="sandbox_id or workspace_id is required")
    workspace_path = workspace_manager.resolve_workspace_path(wid, user_id=user_id)
    if not workspace_path or not os.path.exists(workspace_path):
        workspace_path = workspace_manager.resolve_workspace_path(wid)
    if not workspace_path:
        return {"error": "Workspace not found"}

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid JSON body")

    path = body.get("path", "")
    content = body.get("content")
    if not path or content is None:
        raise HTTPException(status_code=422, detail="path and content are required")

    host_path = os.path.join(workspace_path, path.lstrip("/"))
    try:
        os.makedirs(os.path.dirname(host_path), exist_ok=True)
        with open(host_path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": True, "path": path}
    except Exception as e:
        return {"error": str(e)}

@router.get("/list-files")
async def list_files(
    sandbox_id: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
):
    wid = workspace_id or sandbox_id
    if not wid:
        raise HTTPException(status_code=422, detail="sandbox_id or workspace_id is required")
    host_path = workspace_manager.resolve_workspace_path(wid, user_id=user_id)
    if not host_path or not os.path.exists(host_path):
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


@router.get("/proxy-tunnel/{session_id}/{path:path}")
async def proxy_tunnel(session_id: str, path: str):
    """Reverse-proxy a Cloudflare tunnel URL to avoid mixed-content blocking in iframes.

    For HTML responses, rewrites absolute src="/..." and href="/..." to relative "./..."
    so assets resolve through the proxy instead of hitting localhost:3000 directly.
    """
    import re as _re
    sandbox_mcp = get_sandbox_mcp_service()
    tunnel_url = sandbox_mcp.get_tunnel_url(session_id)
    if not tunnel_url:
        raise HTTPException(status_code=404, detail="No tunnel URL found for this session")

    target = f"{tunnel_url.rstrip('/')}/{path}"
    print(f"[PROXY] {session_id} -> {target}")
    try:
        async with httpx.AsyncClient(verify=False, follow_redirects=True, timeout=30) as client:
            resp = await client.get(target, headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})

        content_type = resp.headers.get("content-type", "application/octet-stream")
        body = resp.content

        if "text/html" in content_type:
            html = body.decode("utf-8", errors="replace")
            html = _re.sub(r'(src|href|action)="/', r'\1="./', html)
            body = html.encode("utf-8")
            headers_dict = {"content-type": "text/html; charset=utf-8", "Cross-Origin-Resource-Policy": "cross-origin"}
        else:
            headers_dict = {"content-type": content_type, "Cross-Origin-Resource-Policy": "cross-origin"}

        excluded_headers = {"content-encoding", "transfer-encoding", "content-length", "connection", "content-type"}
        for k, v in resp.headers.items():
            if k.lower() not in excluded_headers:
                headers_dict[k] = v

        return StreamingResponse(
            iter([body]),
            status_code=resp.status_code,
            headers=headers_dict,
        )
    except httpx.ConnectError as e:
        print(f"[PROXY] Connect error: {e}")
        raise HTTPException(status_code=502, detail=f"Tunnel unreachable: {e}")
    except Exception as e:
        print(f"[PROXY] Error: {e}")
        raise HTTPException(status_code=502, detail=f"Proxy error: {e}")


@router.get("/proxy-tunnel/{session_id}")
async def proxy_tunnel_root(session_id: str):
    """Proxy the root path of a tunnel URL."""
    return await proxy_tunnel(session_id, "")


@router.post("/register-tunnel/{session_id}")
async def register_tunnel(session_id: str, tunnel_url: str = Query(...)):
    """Register a tunnel URL for proxy access (for existing sessions)."""
    sandbox_mcp = get_sandbox_mcp_service()
    sandbox_mcp.store_tunnel_url(session_id, tunnel_url)
    return {"status": "ok", "session_id": session_id, "tunnel_url": tunnel_url}


@router.post("/cleanup-all")
async def cleanup_all_sandboxes():
    """Delete ALL tracked sandboxes and clear all state."""
    sandbox_mcp = get_sandbox_mcp_service()
    result = await sandbox_mcp.cleanup_all()
    return result


@router.delete("/cleanup/{session_id}")
async def cleanup_single_sandbox(session_id: str):
    """Delete a specific sandbox by session ID."""
    sandbox_mcp = get_sandbox_mcp_service()
    result = await sandbox_mcp.delete_sandbox(session_id)
    return result
