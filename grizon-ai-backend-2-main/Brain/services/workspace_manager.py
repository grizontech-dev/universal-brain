"""
File-based workspace manager for Brain (WebContainer runtime).
Agents write to disk for persistence; the browser executes commands via workspace_ops.
"""
import os
import uuid
from typing import Any, Dict, List, Optional

RUNTIME_WEBCONTAINER = "webcontainer"

from Brain.services.command_policy import (  # noqa: E402
    filter_webcontainer_commands,
    command_to_op_payloads,
    should_skip_webcontainer_command,
)


class WorkspaceManager:
    def __init__(self):
        self.container_workspaces_path = "/app/workspaces"
        if not os.path.exists(self.container_workspaces_path):
            try:
                os.makedirs(self.container_workspaces_path)
            except OSError:
                self.container_workspaces_path = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    "workspaces",
                )
        os.makedirs(self.container_workspaces_path, exist_ok=True)
        print(f"DEBUG: Workspace path: {self.container_workspaces_path}")

    def create_workspace(self, name: Optional[str] = None) -> str:
        workspace_id = name or f"workspace-{uuid.uuid4().hex[:8]}"
        local_path = os.path.join(self.container_workspaces_path, workspace_id)
        os.makedirs(local_path, exist_ok=True)
        print(f"DEBUG: Workspace '{workspace_id}' ready at {local_path}")
        return workspace_id

    def write_file(self, workspace_id: str, path: str, content: str) -> bool:
        try:
            full_path = os.path.join(self.container_workspaces_path, workspace_id, path.lstrip("/"))
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            return True
        except Exception as e:
            print(f"CRITICAL: write_file '{path}' in {workspace_id}: {e}")
            return False

    def mkdir(self, workspace_id: str, path: str) -> bool:
        try:
            full_path = os.path.join(self.container_workspaces_path, workspace_id, path.lstrip("/"))
            os.makedirs(full_path, exist_ok=True)
            return True
        except Exception as e:
            print(f"WARNING: mkdir '{path}' in {workspace_id}: {e}")
            return False

    def resolve_workspace_path(self, workspace_id: str, user_id: str = None) -> Optional[str]:
        target_path = os.path.join(self.container_workspaces_path, user_id, workspace_id) if user_id else os.path.join(self.container_workspaces_path, workspace_id)
        
        # If target path already exists, return it
        if os.path.exists(target_path):
            return target_path
            
        # If a legacy path exists and we're looking for a user path, check if it has files
        # (This helps with backward compatibility, but we shouldn't use it if we want strict user isolation.
        # However, to be safe, we'll just create the target path.)
        
        try:
            os.makedirs(target_path, exist_ok=True)
            print(f"DEBUG: Auto-created workspace directory: {target_path}")
            return target_path
        except OSError as e:
            print(f"WARNING: Could not create workspace directory {target_path}: {e}")
            return None

    def build_op_write_file(self, path: str, content: str) -> Dict[str, Any]:
        p = path.lstrip("/")
        return {"op": "write_file", "path": p, "content": content}

    def build_op_mkdir(self, path: str) -> Dict[str, Any]:
        return {"op": "mkdir", "path": path.lstrip("/")}

    def build_op_delete_file(self, path: str) -> Dict[str, Any]:
        return {"op": "delete_file", "path": path.lstrip("/")}

    @staticmethod
    def _is_long_running_dev_command(command: str) -> bool:
        c = command.lower()
        if "install" in c:
            return False
        return any(
            x in c
            for x in ("npm run dev", "vite", "next dev", "npm start", "node server")
        )

    def build_op_run(self, command: str, cwd: str = "", background: bool = False) -> Dict[str, Any]:
        op: Dict[str, Any] = {"op": "run", "command": command}
        if cwd:
            clean = cwd.strip().strip("'\"").lstrip("/").rstrip("/")
            if clean and clean != ".":
                op["cwd"] = clean
        if background or self._is_long_running_dev_command(command):
            op["background"] = True
        return op

    def build_op_install_packages(
        self, packages: List[str], cwd: str = "", dev: bool = False
    ) -> Dict[str, Any]:
        op: Dict[str, Any] = {"op": "install_packages", "packages": list(packages)}
        if cwd:
            clean = cwd.strip().strip("'\"").lstrip("/").rstrip("/")
            if clean and clean != ".":
                op["cwd"] = clean
        if dev:
            op["dev"] = True
        return op

    def apply_files_to_workspace(
        self, workspace_id: str, files: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        ops: List[Dict[str, Any]] = []
        for f in files:
            path = (f.get("path") or "").lstrip("/")
            content = f.get("content")
            if not path or content is None:
                continue
            dir_path = os.path.dirname(path)
            if dir_path and dir_path != ".":
                self.mkdir(workspace_id, dir_path)
                ops.append(self.build_op_mkdir(dir_path))
            self.write_file(workspace_id, path, content)
            ops.append(self.build_op_write_file(path, content))
        return ops

    def build_webcontainer_startup_ops(self, framework: str = "react") -> List[Dict[str, Any]]:
        """Sequential: backend install → backend start → frontend install → frontend dev."""
        ops: List[Dict[str, Any]] = [
            self.build_op_mkdir("backend"),
            self.build_op_run("npm install", cwd="backend"),
            self.build_op_run("npm start", cwd="backend", background=True),
            self.build_op_mkdir("frontend"),
            self.build_op_run("npm install", cwd="frontend"),
        ]
        if framework == "next":
            ops.append(
                self.build_op_run("npm run dev -- -H 0.0.0.0 -p 3000", cwd="frontend", background=True)
            )
        else:
            ops.append(self.build_op_run("npm run dev", cwd="frontend", background=True))
        return ops

    def commands_to_ops(self, commands: List[str], webcontainer: bool = True) -> List[Dict[str, Any]]:
        if webcontainer:
            commands = filter_webcontainer_commands(commands)
        ops: List[Dict[str, Any]] = []
        for cmd in commands:
            if webcontainer:
                cwd = ""
                command = cmd
                if cmd.strip().startswith("cd "):
                    parts = cmd.split("&&", 1)
                    if len(parts) == 2:
                        cd_part = parts[0].strip()
                        cwd = cd_part.replace("cd", "", 1).strip().strip("'\"")
                        command = parts[1].strip()
                    elif "&&" not in cmd:
                        cwd = cmd.replace("cd", "", 1).strip().strip("'\"")
                        command = ""
                background = "nohup" in cmd or "&" in cmd.rstrip()
                command = command.replace("nohup ", "").rstrip(" &").strip()
                if not command or command == "true":
                    if cwd:
                        ops.append(self.build_op_mkdir(cwd))
                    continue
                for payload in command_to_op_payloads(command, cwd=cwd):
                    if payload.get("op") == "run" and background:
                        payload["background"] = True
                    ops.append(payload)
            else:
                ops.append(self.build_op_run(cmd))
        return ops


class _CompatWorkspace(WorkspaceManager):
    """Aliases for code that still calls Docker sandbox APIs."""

    def create_sandbox(self, name=None):
        return self.create_workspace(name)

    def stop_sandbox(self, container_id: str):
        pass

    def execute_command(self, container_id: str, command: str, user: str = "root"):
        return {"exit_code": 0, "output": "", "delegated": "webcontainer"}

    def get_preview_url(self, container_id: str, target_port: int = 3000):
        return None


workspace_manager = _CompatWorkspace()
sandbox_manager = workspace_manager
