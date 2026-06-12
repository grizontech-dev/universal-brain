"""WebContainer command policy — block CLI noise, allow npm package installs."""
import re
import shlex
from typing import List, Optional


def is_supabase_cli_command(cmd: str) -> bool:
    c = (cmd or "").strip()
    if not c:
        return False
    if re.match(r"^supabase(\s|$)", c, re.I):
        return True
    if re.search(r"\bsupabase\s+(init|link|login|migration|db|start|stop)\b", c, re.I):
        return True
    return False


def is_echo_instruction(cmd: str) -> bool:
    return bool(re.match(r"^echo\s+", (cmd or "").strip(), re.I))


def is_env_copy_command(cmd: str) -> bool:
    c = (cmd or "").strip().lower()
    return c.startswith("cp .env") or ".env.example" in c


def parse_npm_install_packages(cmd: str) -> Optional[List[str]]:
    m = re.match(r"^npm\s+install\s*(.*)$", (cmd or "").strip(), re.I)
    if not m:
        return None
    tail = (m.group(1) or "").strip()
    if not tail:
        return []
    try:
        tokens = shlex.split(tail)
    except ValueError:
        tokens = tail.split()
    packages = [t for t in tokens if t and not t.startswith("-")]
    return packages


def is_bare_npm_install(cmd: str) -> bool:
    pkgs = parse_npm_install_packages(cmd)
    if pkgs is None:
        return bool(re.match(r"^npm\s+ci\b", (cmd or "").strip(), re.I))
    return len(pkgs) == 0


def should_skip_webcontainer_command(cmd: str) -> bool:
    c = (cmd or "").strip()
    if not c:
        return True
    if is_supabase_cli_command(c):
        return True
    if is_echo_instruction(c):
        return True
    if is_env_copy_command(c):
        return True
    if re.match(r"^npx\s+create[-\s]", c, re.I):
        return True
    # Runner runs bare install + dev/start at the end
    if is_bare_npm_install(c):
        return True
    if re.search(r"\bnpm\s+run\s+dev\b", c, re.I):
        return True
    if re.search(r"\bnpm\s+start\b", c, re.I) or re.search(r"\bnpm\s+run\s+start\b", c, re.I):
        return True
    if re.match(r"^(yarn|pnpm)\s+install\b", c, re.I):
        return True
    return False


def filter_webcontainer_commands(commands: List[str]) -> List[str]:
    out: List[str] = []
    for cmd in commands or []:
        if should_skip_webcontainer_command(cmd):
            print(f"DEBUG: Skipping WebContainer command: {cmd}")
            continue
        out.append(cmd)
    return out


def command_to_op_payloads(cmd: str, cwd: str = "") -> List[dict]:
    """Turn a shell command into structured workspace op payloads (no WorkspaceManager)."""
    c = (cmd or "").strip()
    if not c or should_skip_webcontainer_command(c):
        return []

    packages = parse_npm_install_packages(c)
    if packages is not None and len(packages) > 0:
        op: dict = {"op": "install_packages", "packages": packages}
        if cwd:
            clean = cwd.strip().strip("'\"").lstrip("/").rstrip("/")
            if clean and clean != ".":
                op["cwd"] = clean
        return [op]

    op = {"op": "run", "command": c}
    if cwd:
        clean = cwd.strip().strip("'\"").lstrip("/").rstrip("/")
        if clean and clean != ".":
            op["cwd"] = clean
    return [op]
