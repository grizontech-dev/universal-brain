"""Resume Brain builds after page reload."""
import os
from typing import Any, Dict, List, Optional, Tuple

from Brain.services.workspace_manager import workspace_manager
from Brain.services.template_service import normalize_framework

SKIP_DIRS = {
    "node_modules",
    ".git",
    "__pycache__",
    ".next",
    "dist",
    "build",
    ".turbo",
    ".cache",
}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
MAX_FILE_BYTES = 512_000
MAX_FILES = 400

DONE_STATUSES = {"completed", "success", "done"}
ACTIVE_STATUSES = {"executing", "running", "pending_confirmation"}


def compute_resume_index(todos: List[Dict[str, Any]]) -> Tuple[int, bool]:
    """Return (current_task_index, build_complete)."""
    if not todos:
        return 0, False
    for i, t in enumerate(todos):
        status = (t.get("status") or "pending").lower()
        if status in ("failed", "error"):
            return i, False
        if status not in DONE_STATUSES:
            return i, False
    return len(todos), True


def latest_todo_list_from_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Find the most complete plan from messages.
    
    Strategy: Find the LARGEST todoList (the full plan), then update task
    statuses from the most recent todoList (which may have progress updates).
    This handles the case where user requests changes → plan gets partial update
    → we still want the full plan with updated statuses.
    """
    if not messages:
        return []
    
    # Step 1: Find the largest todoList (likely the full plan)
    largest_plan = []
    largest_idx = -1
    for i, msg in enumerate(messages):
        todos = msg.get("todoList") or msg.get("todo_list")
        if isinstance(todos, list) and len(todos) > len(largest_plan):
            largest_plan = todos
            largest_idx = i
        meta = msg.get("metadata") or {}
        if isinstance(meta, str):
            continue
        plan = meta.get("plan") or meta.get("todoList")
        if isinstance(plan, list) and len(plan) > len(largest_plan):
            largest_plan = plan
            largest_idx = i
    
    if not largest_plan:
        return []
    
    # Step 2: Find the most recent todoList for status updates
    latest_statuses = {}
    for msg in reversed(messages):
        todos = msg.get("todoList") or msg.get("todo_list")
        if isinstance(todos, list) and todos:
            for t in todos:
                tid = t.get("id") or t.get("task", "")
                status = (t.get("status") or "pending").lower()
                if status in DONE_STATUSES or status in ACTIVE_STATUSES or status == "failed":
                    latest_statuses[tid] = status
            break
    
    # Step 3: Merge - keep full plan, update statuses from latest
    if latest_statuses:
        for task in largest_plan:
            tid = task.get("id") or task.get("task", "")
            if tid in latest_statuses:
                task["status"] = latest_statuses[tid]
    
    return largest_plan


def workspace_disk_to_ops(workspace_id: str, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Sync on-disk workspace into WebContainer write_file ops."""
    host = workspace_manager.resolve_workspace_path(workspace_id, user_id=user_id)
    if not host:
        return []

    # Fallback: if user-scoped dir exists but is empty, use legacy unscoped dir (backward compat).
    try:
        if user_id and not any(os.scandir(host)):
            legacy = workspace_manager.resolve_workspace_path(workspace_id)
            if legacy and legacy != host and any(os.scandir(legacy)):
                host = legacy
                print(f"[RESUME] User workspace empty, falling back to legacy path: {legacy}")
    except OSError:
        pass

    ops: List[Dict[str, Any]] = []
    count = 0

    for root, dirs, files in os.walk(host):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if count >= MAX_FILES:
                return ops
            if name in SKIP_FILES:
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, host).replace("\\", "/")
            try:
                size = os.path.getsize(full)
                if size > MAX_FILE_BYTES:
                    continue
                with open(full, "r", encoding="utf-8") as f:
                    content = f.read()
            except (OSError, UnicodeDecodeError):
                continue
            dir_path = os.path.dirname(rel)
            if dir_path and dir_path != ".":
                ops.append(workspace_manager.build_op_mkdir(dir_path))
            ops.append(workspace_manager.build_op_write_file(rel, content))
            count += 1
    return ops


def get_resume_payload(
    workspace_id: str,
    framework: str = "react",
    todos: Optional[List[Dict[str, Any]]] = None,
    user_id: Optional[str] = None,
    build_active: bool = False,
    was_stopped_by_user_override: Optional[bool] = None,
) -> Dict[str, Any]:
    from Brain.services.sandbox_mcp_service import get_sandbox_mcp_service
    fw = normalize_framework(framework)
    plan = todos or []
    index, build_complete = compute_resume_index(plan)

    workspace_ops = workspace_disk_to_ops(workspace_id, user_id=user_id)
    
    sandbox_mcp = get_sandbox_mcp_service()
    tunnel_url = sandbox_mcp.get_tunnel_url(workspace_id)

    # Detect if build was stopped by user
    # Priority: explicit override > DB message agentStep check
    if was_stopped_by_user_override is not None:
        was_stopped_by_user = was_stopped_by_user_override
    else:
        was_stopped_by_user = False
        try:
            from Brain.modules.conversations.service import conversation_service
            messages = conversation_service.get_messages(workspace_id)
            for msg in reversed(messages):
                meta = msg.get("metadata") or {}
                if isinstance(meta, str):
                    continue
                step = meta.get("agentStep")
                if step:
                    was_stopped_by_user = (step == "stopped")
                    break
        except Exception:
            pass
    
    return {
        "workspace_id": workspace_id,
        "framework": fw,
        "todos": plan,
        "current_task_index": index,
        "build_complete": build_complete,
        "build_active": build_active,
        "workspace_ops": workspace_ops,
        "runtime": "sandbox_mcp",
        "tunnel_url": tunnel_url,
        "was_stopped_by_user": was_stopped_by_user,
    }
