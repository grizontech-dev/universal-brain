import os
from typing import Any, Dict, List, Optional

TEMPLATES_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")

# template folder name -> workspace prefix
TEMPLATE_MOUNT_PREFIX = {
    "express-template": "backend",
    "supabase-template": "backend/supabase",
    "react-template": "frontend",
    "next-template": "frontend",
}

FRAMEWORK_TO_FRONTEND_TEMPLATE = {
    "react": "react-template",
    "vite": "react-template",
    "next": "next-template",
    "nextjs": "next-template",
}

DEFAULT_FRAMEWORK = "react"
DEFAULT_BACKEND_TEMPLATES = ["express-template", "supabase-template"]
SKIP_DIRS = {"node_modules", ".git", "__pycache__", "dist", ".next"}


def list_frameworks() -> List[Dict[str, str]]:
    return [
        {"id": "react", "label": "React (Vite)", "template": "react-template"},
        {"id": "next", "label": "Next.js", "template": "next-template"},
    ]


def normalize_framework(framework: Optional[str]) -> str:
    if not framework:
        return DEFAULT_FRAMEWORK
    key = framework.lower().strip()
    if key in FRAMEWORK_TO_FRONTEND_TEMPLATE:
        return key
    if key in ("next.js", "nextjs"):
        return "next"
    return DEFAULT_FRAMEWORK


def _read_template_files(template_name: str) -> List[Dict[str, str]]:
    template_dir = os.path.join(TEMPLATES_ROOT, template_name)
    if not os.path.isdir(template_dir):
        print(f"WARNING: Template not found: {template_dir}")
        return []

    prefix = TEMPLATE_MOUNT_PREFIX.get(template_name, "")
    files: List[Dict[str, str]] = []

    for root, dirs, filenames in os.walk(template_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for filename in filenames:
            abs_path = os.path.join(root, filename)
            rel = os.path.relpath(abs_path, template_dir).replace("\\", "/")
            workspace_path = f"{prefix}/{rel}" if prefix else rel
            try:
                with open(abs_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except UnicodeDecodeError:
                continue
            files.append({"path": workspace_path, "content": content})
    return files


def template_to_workspace_ops(template_name: str) -> List[Dict[str, Any]]:
    from Brain.services.workspace_manager import workspace_manager

    ops: List[Dict[str, Any]] = []
    for f in _read_template_files(template_name):
        path = f["path"].lstrip("/")
        dir_path = os.path.dirname(path)
        if dir_path and dir_path != ".":
            ops.append(workspace_manager.build_op_mkdir(dir_path))
        ops.append(workspace_manager.build_op_write_file(path, f["content"]))
    return ops


def get_bootstrap_ops(framework: Optional[str], include_frontend: bool = True) -> List[Dict[str, Any]]:
    """Default: express + supabase; frontend template from user framework selection."""
    ops: List[Dict[str, Any]] = []
    seen_paths: set = set()

    def add_ops(template_name: str):
        for op in template_to_workspace_ops(template_name):
            if op["op"] == "write_file":
                if op["path"] in seen_paths:
                    continue
                seen_paths.add(op["path"])
            ops.append(op)

    for name in DEFAULT_BACKEND_TEMPLATES:
        add_ops(name)

    if include_frontend:
        fw = normalize_framework(framework)
        front_tpl = FRAMEWORK_TO_FRONTEND_TEMPLATE.get(fw, "react-template")
        add_ops(front_tpl)

    return ops


def apply_templates_to_workspace(workspace_id: str, framework: Optional[str]) -> List[Dict[str, Any]]:
    from Brain.services.workspace_manager import workspace_manager

    ops = get_bootstrap_ops(framework)
    for op in ops:
        if op["op"] == "write_file":
            workspace_manager.write_file(workspace_id, op["path"], op["content"])
        elif op["op"] == "mkdir":
            workspace_manager.mkdir(workspace_id, op["path"])
    return ops
