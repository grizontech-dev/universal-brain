import os
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

load_dotenv(override=True)

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


def get_company_supabase_env() -> str:
    """Return .env content with company Supabase credentials for auto-injection."""
    url = os.getenv("COMPANY_SUPABASE_URL", "")
    service_role_key = os.getenv("COMPANY_SUPABASE_SERVICE_ROLE_KEY", "")
    anon_key = os.getenv("COMPANY_SUPABASE_ANON_KEY", "")

    # If anon_key not set, use service_role_key as fallback (same key works for both)
    if not anon_key and service_role_key:
        anon_key = service_role_key

    lines = []
    if url:
        lines.append(f"SUPABASE_URL={url}")
    if anon_key:
        lines.append(f"SUPABASE_ANON_KEY={anon_key}")
    if service_role_key:
        lines.append(f"SUPABASE_SERVICE_ROLE_KEY={service_role_key}")

    return "\n".join(lines) + "\n" if lines else ""


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

    # Auto-inject company Supabase credentials to backend/.env when supabase-template is used
    if template_name == "supabase-template":
        env_content = get_company_supabase_env()
        if env_content:
            ops.append(workspace_manager.build_op_write_file("backend/.env", env_content))

    return ops


def get_bootstrap_ops(framework: Optional[str], include_frontend: bool = True) -> List[Dict[str, Any]]:
    """Default: express + supabase; frontend template from user framework selection."""
    ops: List[Dict[str, Any]] = []
    seen_paths: set = set()

    def add_ops(template_name: str):
        for op in template_to_workspace_ops(template_name):
            if op["op"] == "write_file":
                if op["path"] in seen_paths:
                    # If .env already exists, append company Supabase credentials
                    if op["path"] == "backend/.env":
                        existing_env = op.get("content", "")
                        company_env = get_company_supabase_env()
                        if company_env:
                            lines = [line for line in existing_env.split("\n") if not line.strip().startswith("SUPABASE_")]
                            cleaned_env = "\n".join(lines)
                            op["content"] = cleaned_env + "\n" + company_env
                    continue
                seen_paths.add(op["path"])
            ops.append(op)

    for name in DEFAULT_BACKEND_TEMPLATES:
        add_ops(name)

    # If no .env was created by templates, create one with company credentials
    if "backend/.env" not in seen_paths:
        from Brain.services.workspace_manager import workspace_manager
        env_content = get_company_supabase_env()
        if env_content:
            ops.append(workspace_manager.build_op_write_file("backend/.env", env_content))

    if include_frontend:
        fw = normalize_framework(framework)
        front_tpl = FRAMEWORK_TO_FRONTEND_TEMPLATE.get(fw, "react-template")
        add_ops(front_tpl)

    return ops


def apply_templates_to_workspace(workspace_id: str, framework: Optional[str], user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    from Brain.services.workspace_manager import workspace_manager
    from Brain.shared.frontend_entry import is_boilerplate_app, is_app_jsx_path

    ops = get_bootstrap_ops(framework)
    skipped = []
    ws_root = workspace_manager.resolve_workspace_path(workspace_id, user_id=user_id)
    for op in ops:
        if op["op"] == "write_file":
            path = op.get("path", "")
            # Don't overwrite files that have been customized by the builder/LLM.
            full_path = os.path.join(ws_root, path.lstrip("/")) if ws_root else None
            if full_path and os.path.isfile(full_path):
                try:
                    with open(full_path, "r", encoding="utf-8") as f:
                        existing = f.read()
                except Exception:
                    existing = None
                if existing is not None:
                    if is_app_jsx_path(path) and not is_boilerplate_app(existing):
                        skipped.append(path)
                        continue
                    # For other files, skip only if content differs from template (already customized)
                    if not is_app_jsx_path(path) and existing.strip() != op["content"].strip():
                        skipped.append(path)
                        continue
            workspace_manager.write_file(workspace_id, path, op["content"], user_id=user_id)
        elif op["op"] == "mkdir":
            workspace_manager.mkdir(workspace_id, op["path"], user_id=user_id)
    if skipped:
        print(f"[TEMPLATE] Skipped overwriting {len(skipped)} customized files: {skipped}")
    return ops


def inject_company_supabase_to_workspace(workspace_id: str, user_id: Optional[str] = None) -> bool:
    """Inject company Supabase credentials to existing workspace's backend/.env."""
    from Brain.services.workspace_manager import workspace_manager

    ws_path = workspace_manager.resolve_workspace_path(workspace_id, user_id=user_id)
    if not ws_path:
        return False

    env_path = os.path.join(ws_path, "backend", ".env")
    company_env = get_company_supabase_env()

    if not company_env:
        return False

    # Read existing .env if it exists
    existing_content = ""
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                existing_content = f.read()
        except Exception:
            pass

    # Remove existing SUPABASE_ lines so we can inject the fresh ones
    if existing_content:
        lines = [line for line in existing_content.split("\n") if not line.strip().startswith("SUPABASE_")]
        existing_content = "\n".join(lines)

    new_content = existing_content + "\n" + company_env if existing_content else company_env
    os.makedirs(os.path.dirname(env_path), exist_ok=True)
    with open(env_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    return True

    return False
