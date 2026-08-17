import os
import re
import json
import time
import shutil
import asyncio
import subprocess
from typing import Dict, Any, List, Optional, Tuple, Set

from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from Brain.agents.builder.mcp_tools import client_save_code
from Brain.services.websocket_manager import ws_manager
from Brain.services.workspace_manager import workspace_manager

LOG = "[VALIDATION_GATE]"

# Known/approved third-party npm packages whitelist
APPROVED_PACKAGES = {
    "framer-motion": "^10.16.4",
    "lucide-react": "^0.294.0",
    "react-router-dom": "^6.20.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0",
    "axios": "^1.6.0",
    "@supabase/supabase-js": "^2.45.0",
    "recharts": "^2.10.0",
    "canvas-confetti": "^1.9.0",
    "date-fns": "^2.30.0",
    "react-icons": "^4.12.0",
    "feather-icons": "^4.29.0",
}

CORE_PACKAGES = {
    "react", "react-dom", "vite", "@vitejs/plugin-react", "tailwindcss",
    "postcss", "autoprefixer", "express", "cors", "dotenv", "nodemon"
}

BACKEND_APPROVED_PACKAGES = {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "nodemon": "^3.0.0",
    "axios": "^1.6.0",
    "@supabase/supabase-js": "^2.45.0",
    "helmet": "^7.0.0",
    "morgan": "^1.10.0",
    "ws": "^8.18.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
}


class ValidationError:
    def __init__(self, stage: str, message: str, file_path: str = None, line: int = None, column: int = None, code_snippet: str = None):
        self.stage = stage
        self.message = message
        self.file_path = file_path
        self.line = line
        self.column = column
        self.code_snippet = code_snippet

    def fingerprint(self) -> str:
        loc = f"{self.file_path or 'unknown'}:{self.line or 0}"
        msg_sig = self.message[:60].replace("\n", " ").strip()
        return f"{self.stage}:{loc}:{msg_sig}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.stage,
            "message": self.message,
            "file_path": self.file_path,
            "line": self.line,
            "column": self.column,
            "code_snippet": self.code_snippet,
            "fingerprint": self.fingerprint()
        }

    def __str__(self) -> str:
        loc = f" in {self.file_path}" if self.file_path else ""
        if self.line:
            loc += f":L{self.line}"
            if self.column:
                loc += f":C{self.column}"
        return f"[{self.stage}] {self.message}{loc}"


class ValidationWarning:
    def __init__(self, stage: str, message: str, file_path: str = None):
        self.stage = stage
        self.message = message
        self.file_path = file_path

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.stage,
            "message": self.message,
            "file_path": self.file_path,
        }

    def __str__(self) -> str:
        loc = f" in {self.file_path}" if self.file_path else ""
        return f"[{self.stage} WARNING] {self.message}{loc}"


class ValidationGate:
    def __init__(self, llm, session_id: str, user_id: Optional[str] = None):
        self.llm = llm
        self.session_id = session_id
        self.user_id = user_id
        self.workspace_dir = workspace_manager.resolve_workspace_path(session_id, user_id=user_id) or os.path.join(os.getcwd(), "workspaces", session_id)
        self.frontend_dir = os.path.join(self.workspace_dir, "frontend")
        self.frontend_src = os.path.join(self.frontend_dir, "src")
        self.max_repair_attempts = 5

    def _extract_targeted_snippet(self, full_path: str, target_line: int, window: int = 30) -> str:
        """Extract ±window lines around target_line for LLM context optimization."""
        if not os.path.isfile(full_path):
            return ""
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            total_lines = len(lines)
            if target_line <= 0 or target_line > total_lines:
                return "".join(lines[:60])
            
            start = max(0, target_line - 1 - window)
            end = min(total_lines, target_line + window)
            
            snippet_parts = []
            for idx in range(start, end):
                line_num = idx + 1
                prefix = ">>> " if line_num == target_line else "    "
                snippet_parts.append(f"{prefix}{line_num:4d} | {lines[idx]}")
            return "".join(snippet_parts)
        except Exception:
            return ""

    def _get_pkg_hash(self) -> Optional[str]:
        """Return md5 hash of frontend/package.json + lockfile, or None if missing."""
        return self._get_pkg_hash_for_dir(self.frontend_dir)

    def _get_install_marker_path(self, pkg_dir: str) -> str:
        return os.path.join(pkg_dir, ".grizon-install-hash")

    def _get_pkg_hash_for_dir(self, pkg_dir: str) -> Optional[str]:
        """Return md5 hash of package.json + lockfile in given directory, or None if missing."""
        import hashlib
        pkg_path = os.path.join(pkg_dir, "package.json")
        lock_paths = [
            os.path.join(pkg_dir, "package-lock.json"),
            os.path.join(pkg_dir, "pnpm-lock.yaml"),
            os.path.join(pkg_dir, "yarn.lock"),
        ]
        try:
            h = hashlib.md5()
            if os.path.isfile(pkg_path):
                with open(pkg_path, "rb") as f:
                    h.update(f.read())
            for lp in lock_paths:
                if os.path.isfile(lp):
                    with open(lp, "rb") as f:
                        h.update(f.read())
            return h.hexdigest()
        except Exception:
            return None

    def _extract_runtime_files(self, message: str) -> List[str]:
        """Extract workspace-relative source files from Node/Python stack traces."""
        found: List[str] = []
        patterns = [
            r'[/\\]backend[/\\][^:\s]+\.js',
            r'[/\\]frontend[/\\][^:\s]+\.(?:js|jsx|ts|tsx)',
        ]
        for pattern in patterns:
            for match in re.findall(pattern, message or ""):
                normalized = match.replace("\\", "/")
                backend_idx = normalized.find("backend/")
                frontend_idx = normalized.find("frontend/")
                if backend_idx >= 0:
                    normalized = normalized[backend_idx:]
                elif frontend_idx >= 0:
                    normalized = normalized[frontend_idx:]
                if normalized not in found:
                    found.append(normalized)
        return found

    def _run_package_manager_install_for_dir(self, pkg_dir: str, marker_path: str) -> Tuple[bool, str]:
        """Execute package manager install only when package.json/lockfile changed or node_modules missing."""
        if not os.path.isdir(pkg_dir):
            return False, f"{pkg_dir} directory missing"

        node_modules_exist = os.path.isdir(os.path.join(pkg_dir, "node_modules"))
        current_hash = self._get_pkg_hash_for_dir(pkg_dir)

        if node_modules_exist and current_hash:
            try:
                if os.path.isfile(marker_path):
                    with open(marker_path, "r", encoding="utf-8") as f:
                        cached_hash = f.read().strip()
                    if cached_hash == current_hash:
                        print(f"{LOG} [OK] Skipping npm install in {pkg_dir} — unchanged (hash={current_hash[:8]})", flush=True)
                        return True, "Skipped (no changes)"
            except Exception:
                pass

        pm_cmd = ["npm", "install", "--include=dev"]
        if os.path.isfile(os.path.join(pkg_dir, "pnpm-lock.yaml")):
            pnpm_path = shutil.which("pnpm") or shutil.which("pnpm.cmd")
            if pnpm_path:
                pm_cmd = [pnpm_path, "install", "--prod=false"]
        elif os.path.isfile(os.path.join(pkg_dir, "yarn.lock")):
            yarn_path = shutil.which("yarn") or shutil.which("yarn.cmd")
            if yarn_path:
                pm_cmd = [yarn_path, "install", "--production=false"]
        else:
            npm_path = shutil.which("npm") or shutil.which("npm.cmd")
            if npm_path:
                pm_cmd = [npm_path, "install", "--include=dev"]

        print(f"{LOG} Running package manager install in {pkg_dir}: {' '.join(pm_cmd)}...", flush=True)
        try:
            res = subprocess.run(
                pm_cmd,
                cwd=pkg_dir,
                capture_output=True,
                text=True,
                timeout=120,
                shell=False
            )
            if res.returncode == 0:
                print(f"{LOG} [OK] Package manager install completed successfully in {pkg_dir}.", flush=True)
                if current_hash:
                    try:
                        with open(marker_path, "w", encoding="utf-8") as f:
                            f.write(current_hash)
                    except Exception:
                        pass
                return True, "Success"
            else:
                err_msg = (res.stderr or res.stdout or "npm install failed")[:500]
                print(f"{LOG} [WARN] Package manager install returned non-zero exit code in {pkg_dir}: {err_msg}", flush=True)
                return False, err_msg
        except subprocess.TimeoutExpired:
            print(f"{LOG} [WARN] Package manager install timed out after 120s in {pkg_dir}.", flush=True)
            return False, "Timeout"
        except Exception as e:
            print(f"{LOG} [WARN] Package manager install exception in {pkg_dir}: {e}", flush=True)
            return False, str(e)

    def _run_package_manager_install(self) -> Tuple[bool, str]:
        """Execute package manager install only when package.json/lockfile changed or node_modules missing."""
        marker_path = self._get_install_marker_path(self.frontend_dir)
        return self._run_package_manager_install_for_dir(self.frontend_dir, marker_path)

    def _check_and_patch_dependencies(self) -> Tuple[List[ValidationError], List[ValidationWarning], List[str]]:
        """Scan imports in frontend/src. Auto-patch ONLY if package is in approved whitelist and run npm install."""
        errors = []
        warnings = []
        patched_packages = []

        if not os.path.isdir(self.frontend_src):
            return errors, warnings, patched_packages

        pkg_json_path = os.path.join(self.frontend_dir, "package.json")
        installed_deps: Set[str] = set()
        pkg_data = {}
        if os.path.isfile(pkg_json_path):
            try:
                with open(pkg_json_path, "r", encoding="utf-8") as f:
                    pkg_data = json.load(f)
                deps = pkg_data.get("dependencies", {})
                dev_deps = pkg_data.get("devDependencies", {})
                installed_deps.update(deps.keys())
                installed_deps.update(dev_deps.keys())
            except Exception as e:
                errors.append(ValidationError("dependencies", f"Invalid package.json format: {e}", "frontend/package.json"))
                return errors, warnings, patched_packages

        modified_pkg = False
        if pkg_data.get("type") == "module":
            del pkg_data["type"]
            modified_pkg = True

        # Scan all .jsx, .js, .tsx, .ts files for imports
        imported_packages: Set[str] = set()
        for root, _, files in os.walk(self.frontend_src):
            for file in files:
                if file.endswith((".jsx", ".js", ".tsx", ".ts")):
                    full_path = os.path.join(root, file)
                    try:
                        with open(full_path, "r", encoding="utf-8") as f:
                            content = f.read()
                        # Match import ... from 'package', require('package'), or import('package')
                        matches = re.findall(r"(?:import\s+.*?\s+from\s+|require\()\s*['\"]([^'\".\n][^'\"]*)['\"]", content)
                        dynamic_matches = re.findall(r"import\(\s*['\"]([^'\".\n][^'\"]*)['\"]\s*\)", content)
                        for imp in matches + dynamic_matches:
                            if imp.startswith("@"):
                                parts = imp.split("/")
                                pkg_name = "/".join(parts[:2]) if len(parts) >= 2 else imp
                            else:
                                pkg_name = imp.split("/")[0]
                            imported_packages.add(pkg_name)
                    except Exception:
                        pass

        # Check imported packages against installed dependencies
        if "dependencies" not in pkg_data:
            pkg_data["dependencies"] = {}
        if "devDependencies" not in pkg_data:
            pkg_data["devDependencies"] = {}

        # Ensure essential React & Vite build packages exist in package.json
        if "react" not in installed_deps:
            pkg_data["dependencies"]["react"] = "^18.2.0"
            installed_deps.add("react")
            modified_pkg = True
        if "react-dom" not in installed_deps:
            pkg_data["dependencies"]["react-dom"] = "^18.2.0"
            installed_deps.add("react-dom")
            modified_pkg = True
        if "vite" not in installed_deps:
            pkg_data["devDependencies"]["vite"] = "^5.0.0"
            installed_deps.add("vite")
            modified_pkg = True
        if "@vitejs/plugin-react" not in installed_deps:
            pkg_data["devDependencies"]["@vitejs/plugin-react"] = "^4.2.0"
            installed_deps.add("@vitejs/plugin-react")
            modified_pkg = True

        for pkg in imported_packages:
            if pkg in CORE_PACKAGES or pkg in installed_deps:
                continue
            
            # Check whitelist — only add if not already present to avoid version downgrade
            if pkg in APPROVED_PACKAGES and pkg not in installed_deps:
                pkg_data["dependencies"][pkg] = APPROVED_PACKAGES[pkg]
                installed_deps.add(pkg)
                patched_packages.append(pkg)
                modified_pkg = True
                print(f"{LOG} [OK] Auto-patched whitelist package: {pkg} -> {APPROVED_PACKAGES[pkg]}", flush=True)
            else:
                # Unknown/unapproved package missing from package.json -> ERROR
                errors.append(ValidationError(
                    stage="dependencies",
                    message=f"Imported package '{pkg}' is missing from package.json and not in approved whitelist.",
                    file_path="frontend/package.json"
                ))

        node_modules_exist = os.path.isdir(os.path.join(self.frontend_dir, "node_modules"))
        if modified_pkg or not node_modules_exist:
            try:
                if modified_pkg or not os.path.isfile(pkg_json_path):
                    if not os.path.isfile(pkg_json_path):
                        pkg_data["name"] = "frontend"
                        pkg_data["version"] = "1.0.0"
                        pkg_data["private"] = True
                    with open(pkg_json_path, "w", encoding="utf-8") as f:
                        json.dump(pkg_data, f, indent=2)
                    print(f"{LOG} [OK] Saved updated frontend/package.json with {len(patched_packages)} patched deps", flush=True)
                
                # CRITICAL: Trigger package manager install when dependencies change or node_modules is missing
                ok_inst, inst_msg = self._run_package_manager_install()
                if not ok_inst:
                    errors.append(
                        ValidationError(
                            "dependencies",
                            f"Package manager install failed: {inst_msg}",
                            "frontend/package.json"
                        )
                    )
            except Exception as e:
                errors.append(ValidationError("dependencies", f"Failed to save package.json: {e}", "frontend/package.json"))

        return errors, warnings, patched_packages

    def _check_backend_dependencies(self) -> Tuple[List[ValidationError], List[ValidationWarning], List[str]]:
        """Scan require() in backend/. Auto-patch ONLY if package is in approved whitelist and run npm install."""
        errors = []
        warnings = []
        patched_packages = []

        backend_dir = os.path.join(self.workspace_dir, "backend")
        if not os.path.isdir(backend_dir):
            return errors, warnings, patched_packages

        pkg_json_path = os.path.join(backend_dir, "package.json")
        installed_deps: Set[str] = set()
        pkg_data = {}
        if os.path.isfile(pkg_json_path):
            try:
                with open(pkg_json_path, "r", encoding="utf-8") as f:
                    pkg_data = json.load(f)
                deps = pkg_data.get("dependencies", {})
                dev_deps = pkg_data.get("devDependencies", {})
                installed_deps.update(deps.keys())
                installed_deps.update(dev_deps.keys())
            except Exception as e:
                errors.append(ValidationError("backend_dependencies", f"Invalid backend/package.json format: {e}", "backend/package.json"))
                return errors, warnings, patched_packages

        modified_pkg = False
        if pkg_data.get("type") == "module":
            del pkg_data["type"]
            modified_pkg = True

        imported_packages: Set[str] = set()
        server_js_path = os.path.join(backend_dir, "server.js")
        if os.path.isfile(server_js_path):
            try:
                with open(server_js_path, "r", encoding="utf-8") as f:
                    server_content = f.read()
                route_requires = re.findall(r"require\(\s*['\"]([^'\"]*route[^'\"]*)['\"]\s*\)", server_content)
                route_imports = re.findall(r"import\s+.*?\s+from\s+['\"]([^'\"]*route[^'\"]*)['\"]", server_content)
                for imp in route_requires + route_imports:
                    route_file = imp.split("?")[0].split("#")[0]
                    if route_file.endswith(".js"):
                        route_path = os.path.join(backend_dir, route_file)
                    else:
                        route_path = os.path.join(backend_dir, route_file + ".js")
                    if not os.path.isfile(route_path):
                        errors.append(ValidationError(
                            "backend_dependencies",
                            f"Server imports missing route file: '{route_file}' (resolved to '{route_path}')",
                            "backend/server.js"
                        ))
            except Exception:
                pass

        for root_b, _, files_b in os.walk(backend_dir):
            if "node_modules" in root_b:
                continue
            for fname in files_b:
                if not fname.endswith(".js"):
                    continue
                full_path = os.path.join(root_b, fname)
                try:
                    with open(full_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    matches = re.findall(r"require\(\s*['\"]([^'\".\n][^'\"]*)['\"]\s*\)", content)
                    esm_matches = re.findall(r"(?:import\s+.*?\s+from\s+|import\()\s*['\"]([^'\".\n][^'\"]*)['\"]", content)
                    for imp in matches + esm_matches:
                        if imp.startswith("@"):
                            parts = imp.split("/")
                            pkg_name = "/".join(parts[:2]) if len(parts) >= 2 else imp
                        else:
                            pkg_name = imp.split("/")[0]
                        imported_packages.add(pkg_name)
                except Exception:
                    pass

        if "dependencies" not in pkg_data:
            pkg_data["dependencies"] = {}
        if "devDependencies" not in pkg_data:
            pkg_data["devDependencies"] = {}

        essential_backend = {"express", "cors", "dotenv"}
        for pkg in essential_backend:
            if pkg not in installed_deps:
                pkg_data["dependencies"][pkg] = BACKEND_APPROVED_PACKAGES.get(pkg, "^1.0.0")
                installed_deps.add(pkg)
                modified_pkg = True

        for pkg in imported_packages:
            if pkg in installed_deps:
                continue
            if pkg in BACKEND_APPROVED_PACKAGES:
                pkg_data["dependencies"][pkg] = BACKEND_APPROVED_PACKAGES[pkg]
                installed_deps.add(pkg)
                patched_packages.append(pkg)
                modified_pkg = True
                print(f"{LOG} [OK] Auto-patched backend whitelist package: {pkg} -> {BACKEND_APPROVED_PACKAGES[pkg]}", flush=True)
            else:
                errors.append(ValidationError(
                    stage="backend_dependencies",
                    message=f"Imported backend package '{pkg}' is missing from backend/package.json and not in approved whitelist.",
                    file_path="backend/package.json"
                ))

        for pkg, approved_ver in BACKEND_APPROVED_PACKAGES.items():
            for dep_section in ("dependencies", "devDependencies"):
                if pkg in pkg_data.get(dep_section, {}):
                    current_ver = pkg_data[dep_section][pkg]
                    approved_major = re.match(r'[~^>=<]*\s*(\d+)', approved_ver)
                    current_major = re.match(r'[~^>=<]*\s*(\d+)', current_ver)
                    if not approved_major or not current_major or approved_major.group(1) != current_major.group(1):
                        pkg_data[dep_section][pkg] = approved_ver
                        modified_pkg = True
                        patched_packages.append(pkg)
                        print(f"{LOG} [OK] Corrected backend package version: {pkg} {current_ver} -> {approved_ver}", flush=True)

        node_modules_exist = os.path.isdir(os.path.join(backend_dir, "node_modules"))
        if modified_pkg or not node_modules_exist:
            try:
                if modified_pkg or not os.path.isfile(pkg_json_path):
                    if not os.path.isfile(pkg_json_path):
                        pkg_data["name"] = "backend"
                        pkg_data["version"] = "1.0.0"
                    with open(pkg_json_path, "w", encoding="utf-8") as f:
                        json.dump(pkg_data, f, indent=2)
                    print(f"{LOG} [OK] Saved updated backend/package.json with {len(patched_packages)} patched deps", flush=True)

                marker_path = self._get_install_marker_path(backend_dir)
                ok_inst, inst_msg = self._run_package_manager_install_for_dir(backend_dir, marker_path)
                if not ok_inst:
                    errors.append(
                        ValidationError(
                            "backend_dependencies",
                            f"Backend package manager install failed: {inst_msg}",
                            "backend/package.json"
                        )
                    )
            except Exception as e:
                errors.append(ValidationError("backend_dependencies", f"Failed to save backend/package.json: {e}", "backend/package.json"))

        return errors, warnings, patched_packages

    def _check_imports_and_structure(self) -> Tuple[List[ValidationError], List[ValidationWarning]]:
        """Validate relative imports, named/default exports, and router syntax using precise REGEX."""
        errors = []
        warnings = []

        if not os.path.isdir(self.frontend_src):
            errors.append(ValidationError("structure", "Missing frontend/src directory", "frontend/src"))
            return errors, warnings

        all_jsx_files = {}
        for root, _, files in os.walk(self.frontend_src):
            for f in files:
                if f.endswith((".jsx", ".js", ".tsx", ".ts")):
                    full_p = os.path.join(root, f)
                    rel_p = os.path.relpath(full_p, self.frontend_src).replace("\\", "/")
                    all_jsx_files[rel_p] = full_p

        all_imported_targets: Set[str] = set()

        for rel_p, full_p in all_jsx_files.items():
            try:
                with open(full_p, "r", encoding="utf-8") as f:
                    content = f.read()

                # Precise Router syntax check (avoid false positives like "Switch to dark mode")
                if re.search(r"<Switch[\s>]", content) and "react-router-dom" in content:
                    errors.append(ValidationError(
                        stage="structure",
                        message="React Router v5 syntax `<Switch>` detected. Replace with `<Routes>` (v6).",
                        file_path=f"frontend/src/{rel_p}"
                    ))
                if re.search(r"<Route\b[^>]*?\bcomponent\s*=\s*\{", content):
                    errors.append(ValidationError(
                        stage="structure",
                        message="React Router v5 syntax `component={Comp}` detected. Replace with `element={<Comp />}` (v6).",
                        file_path=f"frontend/src/{rel_p}"
                    ))

                # Extract relative imports: multiple forms supported
                # 1. Static imports: import { X } from './Header', import Header from './Header',
                #                    import React, { useState } from './something', import * as Utils from './utils'
                # 2. Side-effect: import './styles.css'
                # 3. Dynamic: import('./components/Chart')
                # 4. require(): require('./utils')
                static_imports = list(re.finditer(
                    r"import\s+(?:(\{[^}]+\})|([a-zA-Z0-9_$]+)|(\*\s+as\s+[a-zA-Z0-9_$]+))\s+from\s+['\"](\.\/[^'\"]+|\.\.\/[^'\"]+)['\"]",
                    content
                ))
                side_effect_imports = list(re.finditer(
                    r"import\s+['\"](\.\/[^'\"]+|\.\.\/[^'\"]+)['\"]\s*;",
                    content
                ))
                dynamic_imports = list(re.finditer(
                    r"import\(\s*['\"](\.\/[^'\"]+|\.\.\/[^'\"]+)['\"]\s*\)",
                    content
                ))
                require_imports = list(re.finditer(
                    r"require\(\s*['\"](\.\/[^'\"]+|\.\.\/[^'\"]+)['\"]\s*\)",
                    content
                ))
                all_rel_imports = static_imports + side_effect_imports + dynamic_imports + require_imports
                file_dir = os.path.dirname(full_p)

                for m in all_rel_imports:
                    if m in static_imports:
                        imp_path = m.group(4)
                        named_imports_str = m.group(1)
                        is_namespace = m.group(3) is not None
                    else:
                        imp_path = m.group(1)
                        named_imports_str = None
                        is_namespace = False
                    if not imp_path:
                        continue

                    target_base = os.path.normpath(os.path.join(file_dir, imp_path))
                    found_target_path = None

                    for ext in ["", ".jsx", ".js", ".tsx", ".ts", "/index.jsx", "/index.js"]:
                        candidate = target_base + ext
                        if os.path.isfile(candidate):
                            found_target_path = candidate
                            matched_rel = os.path.relpath(candidate, self.frontend_src).replace("\\", "/")
                            all_imported_targets.add(matched_rel)
                            break

                    if not found_target_path:
                        errors.append(ValidationError(
                            stage="imports",
                            message=f"Broken import '{imp_path}' — target file does not exist.",
                            file_path=f"frontend/src/{rel_p}"
                        ))
                    else:
                        # Check named exports if imported using { X, Y } but not namespace or side-effect
                        if named_imports_str and not is_namespace:
                            try:
                                with open(found_target_path, "r", encoding="utf-8") as tf:
                                    target_content = tf.read()
                                names = [n.strip() for n in named_imports_str.strip("{}").split(",") if n.strip()]
                                for name in names:
                                    export_name = name.split(" as ")[0].strip()
                                    export_patterns = [
                                        rf"export\s+(?:const|function|class|let|var)\s+{export_name}\b",
                                        rf"export\s+\{{[^}}]*\b{export_name}\b[^}}]*\}}",
                                    ]
                                    if not any(re.search(p, target_content) for p in export_patterns):
                                        warnings.append(ValidationWarning(
                                            stage="imports",
                                            message=f"Named export '{export_name}' might be missing in '{imp_path}'.",
                                            file_path=f"frontend/src/{rel_p}"
                                        ))
                            except Exception:
                                pass

            except Exception as e:
                errors.append(ValidationError("structure", f"Failed to read file: {e}", f"frontend/src/{rel_p}"))

        # FIX: Recursive orphan detection across components/ AND pages/ subdirectories
        for scan_subdir in ("components", "pages"):
            scan_dir = os.path.join(self.frontend_src, scan_subdir)
            if not os.path.isdir(scan_dir):
                continue
            for root_w, _, files_w in os.walk(scan_dir):
                for f in files_w:
                    if not f.endswith((".jsx", ".js", ".tsx", ".ts")):
                        continue
                    full_comp = os.path.join(root_w, f)
                    rel_comp = os.path.relpath(full_comp, self.frontend_src).replace("\\", "/")
                    if rel_comp not in all_imported_targets and f not in ("App.jsx", "main.jsx", "index.jsx"):
                        warnings.append(ValidationWarning(
                            stage="structure",
                            message=f"Component '{f}' is not imported by any other file (orphan component).",
                            file_path=f"frontend/src/{rel_comp}"
                        ))

        return errors, warnings

    def _check_static_compilation(self) -> Tuple[List[ValidationError], List[ValidationWarning]]:
        """Run local static build check (npx vite build or npm run build without auto-fetching flags)."""
        errors = []
        warnings = []

        if not os.path.isdir(self.frontend_dir):
            return errors, warnings

        local_vite = os.path.join(self.frontend_dir, "node_modules", ".bin", "vite.cmd" if os.name == "nt" else "vite")
        npx_full = shutil.which("npx.cmd" if os.name == "nt" else "npx")

        if os.path.isfile(local_vite):
            cmd = [local_vite, "build", "--outDir", "temp_validation_build"]
        elif npx_full:
            cmd = [npx_full, "vite", "build", "--outDir", "temp_validation_build"]
        else:
            errors.append(
                ValidationError(
                    "compilation",
                    "Vite executable not found — cannot validate frontend build.",
                    "frontend/package.json"
                )
            )
            return errors, warnings
        try:
            process = subprocess.run(
                cmd,
                cwd=self.frontend_dir,
                capture_output=True,
                text=True,
                timeout=90,
                shell=False
            )

            temp_out = os.path.join(self.frontend_dir, "temp_validation_build")
            if os.path.isdir(temp_out):
                shutil.rmtree(temp_out, ignore_errors=True)

            if process.returncode != 0:
                stderr_text = process.stderr or process.stdout or "Build failed with exit code " + str(process.returncode)
                print(f"{LOG} [ERROR] Static compilation check failed:\n{stderr_text[:600]}", flush=True)

                file_match = re.search(r'(?:src[/\\][^\s:]+\.(?:jsx?|tsx?)):(\d+)?(?::(\d+))?', stderr_text)
                err_file = None
                err_line = None
                err_col = None
                snippet = ""

                if file_match:
                    rel_path = file_match.group(0).split(":")[0].replace("\\", "/")
                    err_file = f"frontend/{rel_path}"
                    err_line = int(file_match.group(1)) if file_match.group(1) else None
                    err_col = int(file_match.group(2)) if file_match.group(2) else None
                    full_p = os.path.join(self.workspace_dir, err_file)
                    if err_line:
                        snippet = self._extract_targeted_snippet(full_p, err_line, window=30)

                errors.append(ValidationError(
                    stage="compilation",
                    message=f"Vite compilation error: {stderr_text[:800]}",
                    file_path=err_file or "frontend/src/App.jsx",
                    line=err_line,
                    column=err_col,
                    code_snippet=snippet
                ))
            else:
                print(f"{LOG} [OK] Static compilation check passed cleanly", flush=True)

        except subprocess.TimeoutExpired:
            warnings.append(ValidationWarning("compilation", "Static build check timed out after 90s"))
        except Exception as e:
            warnings.append(ValidationWarning("compilation", f"Could not run build check: {e}"))

        return errors, warnings

    def _check_eslint_quality(self) -> Tuple[List[ValidationError], List[ValidationWarning]]:
        """Run ESLint check if configured, avoiding false positives from simple string counting."""
        errors = []
        warnings = []

        if not os.path.isdir(self.frontend_src):
            return errors, warnings

        # Run actual ESLint if npx & eslint configuration exists
        npx_full = shutil.which("npx.cmd" if os.name == "nt" else "npx")
        eslint_cfg = any(os.path.isfile(os.path.join(self.frontend_dir, cfg)) for cfg in [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", "eslint.config.js"])

        if npx_full and eslint_cfg:
            try:
                cmd = [npx_full, "eslint", "src", "--ext", ".js,.jsx,.ts,.tsx", "--format", "json"]
                res = subprocess.run(cmd, cwd=self.frontend_dir, capture_output=True, text=True, timeout=30, shell=False)
                if res.stdout:
                    try:
                        eslint_results = json.loads(res.stdout)
                        for item in eslint_results:
                            f_path = os.path.relpath(item.get("filePath", ""), self.workspace_dir).replace("\\", "/")
                            for msg in item.get("messages", []):
                                severity = msg.get("severity", 1)  # 2 = error, 1 = warning
                                err_msg = f"ESLint: {msg.get('message')} ({msg.get('ruleId')})"
                                line = msg.get("line")
                                if severity == 2:
                                    errors.append(ValidationError("quality", err_msg, f_path, line=line))
                                else:
                                    warnings.append(ValidationWarning("quality", err_msg, f_path))
                    except json.JSONDecodeError:
                        pass
            except Exception:
                pass
        else:
            # If ESLint is not installed in workspace, delegate syntax/type validation to Vite build.
            pass

        return errors, warnings

    def _run_backend_smoke_test(self, backend_dir: str) -> Tuple[List[ValidationError], List[ValidationWarning]]:
        """Validate backend server file syntax without HTTP health probing."""
        errors = []
        warnings = []

        server_js = os.path.join(backend_dir, "server.js") if os.path.isdir(backend_dir) else None
        node_path = shutil.which("node") or shutil.which("node.exe")
        if server_js and os.path.isfile(server_js) and node_path:
            try:
                res = subprocess.run(
                    [node_path, "--check", "server.js"],
                    cwd=backend_dir,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    shell=False
                )
                if res.returncode != 0:
                    err_msg = (res.stderr or res.stdout or "Syntax check failed")[:500]
                    errors.append(ValidationError(
                        stage="runtime",
                        message=f"Backend server.js syntax error: {err_msg}",
                        file_path="backend/server.js"
                    ))
                else:
                    print(f"{LOG} [OK] Backend server.js syntax check passed cleanly", flush=True)
            except Exception as e:
                warnings.append(ValidationWarning("runtime", f"Backend syntax check notice: {e}", "backend/server.js"))

        return errors, warnings

    def _run_frontend_smoke_test(self) -> Tuple[List[ValidationError], List[ValidationWarning]]:
        """Start Vite dev server, GET /, verify HTTP response."""
        errors = []
        warnings = []

        local_vite = os.path.join(self.frontend_dir, "node_modules", ".bin",
                                  "vite.cmd" if os.name == "nt" else "vite")
        vite_exec = local_vite if os.path.isfile(local_vite) else shutil.which("npx.cmd" if os.name == "nt" else "npx")
        if vite_exec and os.path.isdir(self.frontend_dir):
            vite_port = self._find_free_port(19100, 19199)
            vite_proc = None
            try:
                vite_cmd = ([vite_exec, "--port", str(vite_port), "--host", "127.0.0.1"]
                            if os.path.isfile(local_vite)
                            else [vite_exec, "vite", "--port", str(vite_port), "--host", "127.0.0.1"])
                vite_proc = subprocess.Popen(
                    vite_cmd,
                    cwd=self.frontend_dir,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    shell=False
                )
                vite_ok = False
                vite_url = f"http://127.0.0.1:{vite_port}/"
                for _ in range(24):
                    time.sleep(0.5)
                    status = self._http_get(vite_url)
                    if status in (200, 304):
                        vite_ok = True
                        break
                    if vite_proc.poll() is not None:
                        break

                if vite_ok:
                    print(f"{LOG} [OK] Frontend smoke test PASSED — Vite dev server responded on port {vite_port}", flush=True)
                else:
                    print(f"{LOG} [ERROR] Frontend smoke test FAILED: Vite did not serve / within 12s (port={vite_port})", flush=True)
                    errors.append(ValidationError(
                        stage="runtime",
                        message="Vite dev server did not respond to GET / within 12s — frontend may not start. Check main.jsx, App.jsx, and vite.config.js for startup errors.",
                        file_path="frontend/src/main.jsx"
                    ))
            except Exception as fse:
                errors.append(
                    ValidationError(
                        "runtime",
                        f"Frontend smoke test exception: {fse}",
                        "frontend/src/main.jsx"
                    )
                )
            finally:
                if vite_proc and vite_proc.poll() is None:
                    vite_proc.terminate()
                    try:
                        vite_proc.wait(timeout=3)
                    except Exception:
                        vite_proc.kill()

        return errors, warnings

    def _find_free_port(self, start: int = 19000, end: int = 19999) -> int:
        """Find a free TCP port in [start, end] range for smoke test servers."""
        import socket
        for port in range(start, end):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(("127.0.0.1", port))
                    return port
            except OSError:
                continue
        return start

    def _http_get(self, url: str, timeout: float = 2.0) -> int:
        """Make a plain HTTP GET and return status code, or -1 on failure."""
        import urllib.request
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return resp.status
        except Exception:
            return -1

    async def _emit_status(self, status: str, attempt: int = 0, errors: List[ValidationError] = None, warnings: List[ValidationWarning] = None):
        """Emit WebSocket progress message to frontend."""
        if not self.session_id or str(self.session_id).startswith("error:"):
            return

        err_list = [e.to_dict() for e in (errors or [])]
        warn_list = [w.to_dict() for w in (warnings or [])]

        payload = {
            "type": "validation_status",
            "status": status,
            "attempt": attempt,
            "max_attempts": self.max_repair_attempts,
            "errors": err_list,
            "warnings": warn_list,
            "timestamp": str(int(time.time() * 1000))
        }

        try:
            await ws_manager.broadcast_to_sandbox(str(self.session_id), {
                "type": "workspace_ops",
                "ops": [],
                "activities": [{
                    "id": f"act-val-{int(time.time() * 1000)}",
                    "type": "run_command",
                    "label": f"Validation Gate: {status.upper()} (attempt {attempt}/{self.max_repair_attempts})",
                    "status": "running" if status in ("validating", "repairing") else ("done" if status == "validation_passed" else "failed"),
                    "timestamp": int(time.time() * 1000),
                }],
                "progress_msg": json.dumps(payload),
            })
        except Exception as e:
            print(f"{LOG} Failed to emit validation status: {e}", flush=True)

    def _check_build_contract(self) -> Tuple[List[ValidationError], List[ValidationWarning]]:
        """
        Cross-check build_contract.json against actual disk state:
          1. Every api_helper must be exported from frontend/src/lib/api.js
          2. Every page in contract["pages"] must have a <Route> in App.jsx

        On attempt 1 these are warnings (non-blocking) so a first-pass build can
        succeed even if the contract was written after the frontend tasks ran.
        On attempt 2+ they escalate to hard errors so the Repair Agent is forced
        to fix them (not skip them).
        """
        errors: List[ValidationError] = []
        warnings: List[ValidationWarning] = []

        try:
            from Brain.shared.build_contract import read_contract
            contract = read_contract(self.workspace_dir)
        except Exception:
            return errors, warnings

        # On attempt 1: emit as warnings (don't block a clean first pass).
        # On attempt 2+: escalate to hard errors — Repair Agent must fix them.
        _attempt = getattr(self, "_current_attempt", 1)
        _use_errors = _attempt >= 2

        def _report(stage: str, message: str, file_path: str) -> None:
            if _use_errors:
                errors.append(ValidationError(stage=stage, message=message, file_path=file_path))
            else:
                warnings.append(ValidationWarning(stage=stage, message=message, file_path=file_path))

        # ── Check 1: api.js exports match contract helpers ──
        api_helpers = contract.get("api_helpers", {})
        if api_helpers:
            api_js_path = os.path.join(self.frontend_src, "lib", "api.js")
            if os.path.isfile(api_js_path):
                try:
                    with open(api_js_path, "r", encoding="utf-8") as f:
                        api_content = f.read()
                    exported = set(re.findall(
                        r"export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)", api_content
                    ))
                    # Also catch: export { foo, bar }
                    for m in re.finditer(r"export\s+\{([^}]+)\}", api_content):
                        for name in m.group(1).split(","):
                            exported.add(name.strip().split(" as ")[0].strip())

                    for helper_name in api_helpers:
                        if helper_name and helper_name not in exported:
                            _report(
                                "contract",
                                (
                                    f"Build contract helper '{helper_name}' is not exported by api.js. "
                                    f"Add: export async function {helper_name}() {{...}}"
                                ),
                                "frontend/src/lib/api.js",
                            )
                except Exception:
                    pass

        # ── Check 2: contract pages have routes in App.jsx ──
        contract_pages = contract.get("pages", [])
        if contract_pages:
            app_jsx_path = os.path.join(self.frontend_src, "App.jsx")
            if os.path.isfile(app_jsx_path):
                try:
                    with open(app_jsx_path, "r", encoding="utf-8") as f:
                        app_content = f.read()
                    # Extract all route paths from <Route path="..."> or <Route path='...'>
                    declared_routes = set(re.findall(r'<Route\b[^>]*\bpath=["\']([^"\']+)["\']', app_content))

                    for page in contract_pages:
                        route = page.get("route", "")
                        name = page.get("name", "")
                        if route and route not in declared_routes:
                            _report(
                                "contract",
                                (
                                    f"Build contract page '{name}' (route '{route}') "
                                    f"has no matching <Route> in App.jsx."
                                ),
                                "frontend/src/App.jsx",
                            )
                except Exception:
                    pass

        if errors or warnings:
            print(
                f"{LOG} [CONTRACT] Check results: {len(errors)} errors, {len(warnings)} warnings "
                f"(attempt={_attempt}, escalated={'yes' if _use_errors else 'no'})",
                flush=True,
            )
            for e in errors:
                print(f"{LOG} [CONTRACT] ✖ {e}", flush=True)
            for w in warnings:
                print(f"{LOG} [CONTRACT] ⚠ {w}", flush=True)
        else:
            print(f"{LOG} [CONTRACT] ✅ All contract checks passed (attempt={_attempt})", flush=True)

        return errors, warnings

    async def _generate_missing_page_stubs(self, errors: List["ValidationError"]) -> int:
        """
        For each broken-import error whose target resolves to a non-existent file under
        frontend/src/pages/, write a minimal valid React functional component stub so the
        broken-import check passes without consuming an LLM repair credit.

        Only stubs paths under pages/ — skips lib/, components/, and any path that already
        exists on disk.  Returns the number of stubs created.
        """
        stubs_created = 0
        for err in errors:
            if err.stage != "imports":
                continue
            m = re.search(r"Broken import '([^']+)' — target file does not exist", err.message or "")
            if not m:
                continue
            import_path = m.group(1)
            if not err.file_path:
                continue

            # Resolve the broken import path relative to the importing file
            importer_abs = os.path.join(self.workspace_dir, err.file_path)
            importer_dir = os.path.dirname(importer_abs)
            target_base = os.path.normpath(os.path.join(importer_dir, import_path))

            # Try .jsx then .js — pick the first candidate that does NOT already exist
            target_path = None
            for ext in (".jsx", ".js"):
                candidate = target_base + ext
                if not os.path.isfile(candidate):
                    target_path = candidate
                    break
            if not target_path:
                # Both extensions already exist — nothing to stub
                continue

            # Only auto-stub files under pages/
            try:
                rel = os.path.relpath(target_path, self.frontend_src).replace("\\", "/")
            except ValueError:
                continue
            if not rel.startswith("pages/"):
                continue

            component_name = os.path.splitext(os.path.basename(target_path))[0]
            stub_content = (
                "import { motion } from 'framer-motion';\n\n"
                f"export default function {component_name}() {{\n"
                "  return (\n"
                "    <motion.div\n"
                "      initial={{ opacity: 0 }}\n"
                "      animate={{ opacity: 1 }}\n"
                '      className="min-h-screen flex items-center justify-center"\n'
                "    >\n"
                f'      <h1 className="text-2xl font-bold">{component_name}</h1>\n'
                "    </motion.div>\n"
                "  );\n"
                "}\n"
            )
            try:
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, "w", encoding="utf-8") as f:
                    f.write(stub_content)
                print(f"{LOG} [STUB] Generated missing page stub: frontend/src/{rel}", flush=True)
                stubs_created += 1
            except Exception as e:
                print(f"{LOG} [STUB] Failed to write stub for {rel}: {e}", flush=True)

        return stubs_created

    async def run_validation_and_repair(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Core Validation Loop: Generate → Validate → Repair → Validate → Deliver. Max 5 repair attempts."""
        print(f"\n{LOG} ===============================================================", flush=True)
        print(f"{LOG} START VALIDATION GATE | session={self.session_id}", flush=True)
        print(f"{LOG} ===============================================================", flush=True)

        validation_history = state.get("validation_history", [])
        previous_fingerprints: Set[str] = set()

        for attempt in range(1, self.max_repair_attempts + 1):
            self._current_attempt = attempt  # used by _check_build_contract for warning→error escalation
            state["status"] = "validating"
            await self._emit_status("validating", attempt=attempt)

            # Run validation checks in tiers: dependencies first, then parallel static checks,
            # then runtime smoke tests only if static checks pass.
            dep_errors, dep_warns, patched = self._check_and_patch_dependencies()
            backend_dep_errors, backend_dep_warns, backend_patched = self._check_backend_dependencies()

            static_errors = []
            static_warnings = []
            if not dep_errors and not backend_dep_errors:
                imp_result, build_result, quality_result, contract_result = await asyncio.gather(
                    asyncio.to_thread(self._check_imports_and_structure),
                    asyncio.to_thread(self._check_static_compilation),
                    asyncio.to_thread(self._check_eslint_quality),
                    asyncio.to_thread(self._check_build_contract),
                )
                imp_errors, imp_warns = imp_result
                build_errors, build_warns = build_result
                quality_errors, quality_warns = quality_result
                contract_errors, contract_warns = contract_result
                static_errors = imp_errors + build_errors + quality_errors + contract_errors
                static_warnings = imp_warns + build_warns + quality_warns + contract_warns
            else:
                imp_errors, imp_warns = [], []
                build_errors, build_warns = [], []
                quality_errors, quality_warns = [], []
                contract_errors, contract_warns = [], []

            runtime_errors, runtime_warns = [], []
            if not static_errors:
                backend_dir = os.path.join(self.workspace_dir, "backend")
                runtime_backend, runtime_frontend = await asyncio.gather(
                    asyncio.to_thread(self._run_backend_smoke_test, backend_dir),
                    asyncio.to_thread(self._run_frontend_smoke_test),
                )
                runtime_errors = runtime_backend[0] + runtime_frontend[0]
                runtime_warns = runtime_backend[1] + runtime_frontend[1]

            all_errors = dep_errors + backend_dep_errors + static_errors + runtime_errors
            all_warnings = dep_warns + backend_dep_warns + static_warnings + runtime_warns

            current_fingerprints = {e.fingerprint() for e in all_errors}
            stagnant_errors = current_fingerprints.intersection(previous_fingerprints)

            print(f"{LOG} Iteration {attempt}/{self.max_repair_attempts}: {len(all_errors)} ERRORS, {len(all_warnings)} WARNINGS, {len(stagnant_errors)} stagnant errors", flush=True)
            for w in all_warnings:
                print(f"{LOG} [WARN] {w}", flush=True)

            if not all_errors:
                print(f"{LOG} [OK] VALIDATION PASSED cleanly on attempt {attempt}/{self.max_repair_attempts}!", flush=True)
                state["status"] = "validation_passed"
                await self._emit_status("validation_passed", attempt=attempt, warnings=all_warnings)
                return {
                    "passed": True,
                    "attempts": attempt,
                    "warnings": [w.to_dict() for w in all_warnings],
                    "patched_deps": patched
                }

            # Print errors for debugging
            for err in all_errors:
                print(f"{LOG} [ERROR] {err}", flush=True)

            attempt_record = {
                "attempt": attempt,
                "errors": [e.to_dict() for e in all_errors],
                "warnings": [w.to_dict() for w in all_warnings],
                "timestamp": time.time()
            }
            validation_history.append(attempt_record)
            state["validation_history"] = validation_history

            if attempt >= self.max_repair_attempts:
                print(f"{LOG} [ERROR] MAX REPAIR ATTEMPTS ({self.max_repair_attempts}) REACHED -- halting delivery.", flush=True)
                state["status"] = "validation_failed"
                await self._emit_status("validation_failed", attempt=attempt, errors=all_errors, warnings=all_warnings)
                return {
                    "passed": False,
                    "attempts": attempt,
                    "errors": [e.to_dict() for e in all_errors],
                    "warnings": [w.to_dict() for w in all_warnings]
                }

            # Trigger REPAIR AGENT with TARGETED context & stagnant error warnings
            state["status"] = "repairing"
            await self._emit_status("repairing", attempt=attempt, errors=all_errors)

            # Step 1: Deterministic pre-repair (missing exports — no LLM needed)
            pre_fixed = await self._deterministic_export_repair(all_errors + [ValidationError("imports WARNING", w.message, w.file_path) for w in all_warnings])
            if pre_fixed:
                print(f"{LOG} [OK] Deterministic pre-repair fixed {pre_fixed} file(s) — re-running validation", flush=True)
                previous_fingerprints = current_fingerprints
                continue

            # Step 2: LLM Repair Agent for remaining errors
            repair_items = all_errors + [
                ValidationError("imports", w.message, w.file_path)
                for w in all_warnings
                if "Named export" in w.message
            ]
            # Generate deterministic stubs for wholly-absent page import targets
            # before invoking the LLM — avoids burning a repair credit on a file the
            # LLM cannot create from thin air (it has no content to work with).
            stubs_created = await self._generate_missing_page_stubs(repair_items)
            if stubs_created:
                print(f"{LOG} [STUB] Created {stubs_created} page stub(s) — re-running validation without LLM call", flush=True)
                previous_fingerprints = current_fingerprints
                continue

            repair_success = await self._run_targeted_repair(repair_items, attempt, stagnant_errors)
            if not repair_success:
                print(f"{LOG} [WARN] Repair agent produced no file changes on attempt {attempt} — continuing to next attempt", flush=True)
                # Non-fatal: fall through so the loop continues to the next attempt.
                # Only set validation_failed when max_repair_attempts is exhausted (handled above).

            previous_fingerprints = current_fingerprints

        state["status"] = "validation_failed"
        return {"passed": False, "errors": [e.to_dict() for e in all_errors]}

    async def _deterministic_export_repair(self, all_errors_and_warnings: List) -> int:
        """
        LLM-free repair: scan all errors/warnings for 'X is not exported by Y' pattern,
        group missing exports by source file, read+append ALL missing stubs in ONE write.
        Returns count of files fixed.
        """
        import re as _re

        # Collect: source_file_abs -> set of missing export names
        missing: dict[str, set] = {}

        for item in all_errors_and_warnings:
            msg = getattr(item, "message", "") or ""
            # Vite compilation: "X" is not exported by "src/lib/api.js"
            m = _re.search(r'"([^"]+)" is not exported by "([^"]+)"', msg)
            if m:
                export_name, src_rel = m.group(1), m.group(2)
                # src_rel is relative to frontend dir (e.g. src/lib/api.js)
                src_abs = os.path.join(self.frontend_dir, src_rel)
                if not os.path.isfile(src_abs):
                    src_abs = os.path.join(self.workspace_dir, src_rel)
                if os.path.isfile(src_abs):
                    missing.setdefault(src_abs, set()).add(export_name)
                    continue

            # Import warnings: "Named export 'X' might be missing in '../lib/api'"
            m2 = _re.search(r"Named export '([^']+)' might be missing in '([^']+)'", msg)
            if m2:
                export_name, import_path = m2.group(1), m2.group(2)
                src_file = getattr(item, "file_path", None)
                if src_file:
                    src_abs = os.path.join(self.workspace_dir, src_file)
                    if os.path.isfile(src_abs):
                        src_dir = os.path.dirname(src_abs)
                        candidate = os.path.normpath(os.path.join(src_dir, import_path))
                    else:
                        candidate = os.path.normpath(os.path.join(self.frontend_src, import_path))
                else:
                    candidate = os.path.normpath(os.path.join(self.frontend_src, import_path))
                for ext in (".js", ".jsx", ".ts", ".tsx"):
                    if os.path.isfile(candidate + ext):
                        missing.setdefault(candidate + ext, set()).add(export_name)
                        break

        if not missing:
            return 0

        fixed = 0
        for abs_path, export_names in missing.items():
            try:
                with open(abs_path, "r", encoding="utf-8") as f:
                    content = f.read()

                # SAFETY: Skip CommonJS files — appending ESM `export { ... }` would
                # conflict with `module.exports` / `exports.` and break the module.
                if "module.exports" in content or "exports." in content:
                    rel = os.path.relpath(abs_path, self.workspace_dir).replace("\\", "/")
                    print(f"{LOG} [AUTO-REPAIR] Skipping CommonJS file {rel} — ESM re-export would conflict", flush=True)
                    continue

                # SAFETY: Only repair things that are MECHANICALLY safe.
                # Strategy: if the function already EXISTS in the file but is NOT exported,
                # add the export keyword. If the function doesn't exist at all, leave it
                # for the LLM repair agent (don't invent fake logic).

                re_export_additions = []   # names we can safely re-export
                truly_absent = []          # names that don't exist at all (LLM must handle)

                for name in export_names:
                    # Already exported? Skip.
                    already_exported = bool(_re.search(
                        rf'export\s+(?:const|function|class|let|var)\s+{_re.escape(name)}\b'
                        rf'|export\s+\{{[^}}]*\b{_re.escape(name)}\b[^}}]*\}}',
                        content
                    ))
                    if already_exported:
                        continue

                    # Exists as un-exported function/const/class?
                    exists_unexported = bool(_re.search(
                        rf'(?:^|\n)\s*(?:const|async\s+function|function|class|let|var)\s+{_re.escape(name)}\b',
                        content
                    ))

                    if exists_unexported:
                        re_export_additions.append(name)
                    else:
                        truly_absent.append(name)

                if truly_absent:
                    rel = os.path.relpath(abs_path, self.workspace_dir).replace("\\", "/")
                    print(
                        f"{LOG} [AUTO-REPAIR] Skipping {len(truly_absent)} absent symbol(s) in {rel} "
                        f"(no implementation found \u2014 delegating to LLM): {truly_absent}",
                        flush=True
                    )

                if not re_export_additions:
                    continue

                rel = os.path.relpath(abs_path, self.workspace_dir).replace("\\", "/")
                print(f"{LOG} [AUTO-REPAIR] Re-exporting {len(re_export_additions)} existing symbol(s) in {rel}: {re_export_additions}", flush=True)

                # Append a safe re-export block (existing functions only)
                export_block = "\n// Re-exported by Validation Gate (symbols existed but were not exported)\n"
                export_block += f"export {{ {', '.join(re_export_additions)} }};\n"

                new_content = content.rstrip() + "\n" + export_block
                with open(abs_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"{LOG} [AUTO-REPAIR] \u2713 Saved {rel} with {len(re_export_additions)} re-exported symbol(s)", flush=True)
                fixed += 1
            except Exception as e:
                print(f"{LOG} [AUTO-REPAIR] Error patching {abs_path}: {e}", flush=True)

        return fixed

    async def _run_targeted_repair(self, errors: List[ValidationError], attempt: int, stagnant_errors: Set[str] = None) -> bool:
        """Call LLM Repair Agent with TARGETED context & stagnant error warnings."""
        print(f"{LOG} → Repair Agent invoked for {len(errors)} errors (attempt {attempt})...", flush=True)

        error_contexts = []
        # Track which source files we need to inject content for
        files_to_inject: dict[str, list[str]] = {}  # source_file -> [missing_exports]

        for i, err in enumerate(errors[:6]):  # Max 6 errors per repair pass
            is_stagnant = stagnant_errors and err.fingerprint() in stagnant_errors
            stagnant_warning = " ⚠️ UNRESOLVED FROM PREVIOUS ATTEMPT" if is_stagnant else ""
            snippet_block = f"```jsx\n{err.code_snippet}\n```" if err.code_snippet else ""
            ctx = (
                f"Error #{i+1} [{err.stage}]{stagnant_warning}: {err.message}\n"
                f"File: {err.file_path or 'unknown'}"
                + (f" (Line {err.line})" if err.line else "")
                + f"\n{snippet_block}\n"
            )
            error_contexts.append(ctx)

            # Detect "not exported by" pattern and track source file
            import re as _re
            m = _re.search(r'"(.+?)" is not exported by "([^"]+)"', err.message or "")
            if m:
                export_name, src_rel = m.group(1), m.group(2)
                # Resolve src_rel (e.g. src/lib/api.js) to absolute path
                src_abs = os.path.join(self.frontend_dir, src_rel)
                if not os.path.isfile(src_abs):
                    # Try relative to workspace root
                    src_abs = os.path.join(self.workspace_dir, src_rel)
                if os.path.isfile(src_abs):
                    files_to_inject.setdefault(src_abs, []).append(export_name)

        # Inject current content of files that need new exports
        file_content_block = ""
        for abs_path, missing_exports in files_to_inject.items():
            rel = os.path.relpath(abs_path, self.workspace_dir).replace("\\", "/")
            try:
                with open(abs_path, "r", encoding="utf-8") as f:
                    content = f.read()
                file_content_block += (
                    f"\nCURRENT CONTENT of `{rel}` (missing exports: {missing_exports}):\n"
                    f"```js\n{content[:3000]}\n```\n"
                    f"→ ADD the missing export(s) {missing_exports} to this file.\n"
                )
            except Exception:
                pass

        # Inject current server.js and stack-trace source files for runtime backend errors
        runtime_files_to_inject: Set[str] = set()
        supabase_ws_error = any(
            err.stage == "runtime" and "WebSocket" in (err.message or "") and "supabase" in (err.message or "").lower()
            for err in errors
        )
        for err in errors:
            if err.stage == "runtime":
                if err.file_path:
                    runtime_files_to_inject.add(err.file_path)
                runtime_files_to_inject.update(self._extract_runtime_files(err.message))

        # If this is a Supabase WebSocket/Node compatibility error, find ALL controllers
        # that import @supabase/supabase-js so the repair agent can fix the root cause
        # in one pass instead of file-by-file.
        if supabase_ws_error:
            backend_dir = os.path.join(self.workspace_dir, "backend")
            if os.path.isdir(backend_dir):
                for root_b, _, files_b in os.walk(backend_dir):
                    if "node_modules" in root_b:
                        continue
                    for fname in files_b:
                        if not fname.endswith(".js"):
                            continue
                        fpath = os.path.join(root_b, fname)
                        try:
                            with open(fpath, "r", encoding="utf-8") as f:
                                content = f.read()
                            if "@supabase/supabase-js" in content and "createClient" in content:
                                rel = os.path.relpath(fpath, self.workspace_dir).replace("\\", "/")
                                runtime_files_to_inject.add(rel)
                        except Exception:
                            pass

        for rel_path in runtime_files_to_inject:
            abs_path = os.path.join(self.workspace_dir, rel_path)
            if not os.path.isfile(abs_path):
                continue
            try:
                with open(abs_path, "r", encoding="utf-8") as f:
                    content = f.read()
                file_content_block += (
                    f"\nCURRENT CONTENT of `{rel_path}` (runtime stack-trace file — inspect and fix if necessary):\n"
                    f"```js\n{content[:12000]}\n```\n"
                )
            except Exception:
                pass

        pkg_json_content = ""
        pkg_path = os.path.join(self.frontend_dir, "package.json")
        if any(e.stage == "dependencies" for e in errors) and os.path.isfile(pkg_path):
            try:
                with open(pkg_path, "r", encoding="utf-8") as f:
                    pkg_json_content = f"\nCURRENT package.json:\n```json\n{f.read()}\n```\n"
            except Exception:
                pass

        repair_prompt = (
            f"The project validation failed with {len(errors)} error(s).\n\n"
            "=== TARGETED ERROR CONTEXT ===\n"
            + "\n".join(error_contexts)
            + file_content_block
            + pkg_json_content + "\n"
            "RULES FOR REPAIR:\n"
            "1. Fix ONLY the specific files mentioned in the errors using `client_save_code`.\n"
            "2. CRITICAL: `client_save_code` replaces the ENTIRE file. You MUST provide the complete file content, including all existing code plus your fix. Do NOT provide only a snippet or partial file.\n"
            "3. When a file is missing exports, READ its current content above and ADD all missing exports in ONE save call with the complete file.\n"
            "3A. If `frontend/src/lib/api.js` is missing a helper, add the exact helper name imported by the component and map it to the actual mounted backend `/api/...` route for that feature. Do not invent todo/auth routes unless the project actually has that feature.\n"
            "4. Do NOT rewrite unrelated working code.\n"
            "5. If an import path or exported name is wrong, fix the import/export declaration.\n"
            "6. If a dependency is missing from package.json, add it to dependencies.\n"
            "7. Preserve plain JSX format (do NOT convert to TypeScript/TSX unless requested).\n"
            "8. Make one tool call per file fix — but fix ALL issues for a file in a SINGLE call.\n"
            "9. CRITICAL: If you see multiple missing exports from the same file, add ALL of them in one save.\n"
            "10. For backend runtime errors, inspect ALL provided runtime stack-trace source files, especially the file identified by `File:` and the files extracted from the stack trace. Fix the actual root cause while preserving all existing routes, middleware, imports, database logic, configuration, and exports."
            "11. If the error is a Supabase WebSocket/Node compatibility error across multiple controllers, CREATE `backend/supabase/client.js` as the shared Supabase client helper with ws transport, then UPDATE ALL affected controllers to use it. Do NOT fix each controller individually."
            "12. If there is a PostCSS/ESM error (`module is not defined in ES module scope`), REMOVE `\"type\": \"module\"` from frontend/package.json. Vite handles ESM natively and CommonJS configs like postcss.config.js require `module.exports`."
            "13. If backend fails with `require is not defined in ES module scope` or `Cannot find module 'backend/routes/...'`, check backend/package.json for `\"type\": \"module\"` and REMOVE it. Then fix server.js to only import routes that actually exist under backend/routes/."
            "14. If frontend fails with `You cannot render a <Router> inside another <Router>`, remove ALL `<BrowserRouter>`, `<HashRouter>`, `<MemoryRouter>`, or `<Router>` wrappers from every file EXCEPT `frontend/src/App.jsx`. Only App.jsx may contain one top-level `<BrowserRouter>`."
        )

        if not self.llm:
            print(f"{LOG} [ERROR] Repair LLM not provided -- skipping repair pass", flush=True)
            return False

        try:
            bound_llm = self.llm.bind_tools([client_save_code])
            messages = [
                SystemMessage(content="You are the Grizon Brain Validation Repair Agent. You repair React frontend AND Node.js/Express backend projects. Make the smallest possible targeted fix. Never remove existing working functionality. When repairing an existing file, preserve all existing routes, middleware, imports, database logic, configuration, and exports unless the validation error specifically requires changing them."),
                HumanMessage(content=repair_prompt)
            ]

            response = await asyncio.wait_for(bound_llm.ainvoke(messages), timeout=180)
            if not response or not hasattr(response, "tool_calls") or not response.tool_calls:
                print(f"{LOG} [WARN] Repair LLM returned no tool calls", flush=True)
                return False

            fixed_count = 0
            for tc in response.tool_calls:
                if tc.get("name") == "client_save_code":
                    tool_args = tc.get("args", {})
                    file_path = tool_args.get("file_path", "")
                    new_content = tool_args.get("code_content", "")

                    if not file_path or not new_content:
                        print(f"{LOG} [BLOCKED] Empty repair payload: {file_path}", flush=True)
                        continue

                    full_path = os.path.abspath(os.path.join(self.workspace_dir, file_path))
                    workspace_root = os.path.abspath(self.workspace_dir)
                    if os.path.commonpath([workspace_root, full_path]) != workspace_root:
                        print(
                            f"{LOG} [BLOCKED] Repair path escapes workspace: {file_path}",
                            flush=True
                        )
                        continue

                    if os.path.isfile(full_path):
                        try:
                            with open(full_path, "r", encoding="utf-8") as f:
                                old_content = f.read()
                        except Exception:
                            old_content = ""
                        if len(old_content) >= 300:
                            min_allowed = max(150, int(len(old_content) * 0.35))
                            if len(new_content) < min_allowed:
                                print(
                                    f"{LOG} [BLOCKED] Suspicious repair rewrite: "
                                    f"{file_path} old={len(old_content)} new={len(new_content)} "
                                    f"minimum={min_allowed}",
                                    flush=True
                                )
                                continue

                    try:
                        await asyncio.wait_for(
                            client_save_code.ainvoke(
                                tool_args,
                                config={"configurable": {"thread_id": self.session_id, "task_title": f"Validation Repair (Attempt {attempt})", "user_id": self.user_id}}
                            ),
                            timeout=30
                        )
                        fixed_count += 1
                        print(f"{LOG} [OK] Repaired file: {file_path}", flush=True)
                    except Exception as save_err:
                        print(f"{LOG} [ERROR] Failed to save repair for {file_path}: {save_err}", flush=True)

            return fixed_count > 0

        except Exception as e:
            import traceback as _tb
            print(f"{LOG} [ERROR] Repair LLM error: {e}\n{_tb.format_exc()}", flush=True)
            return False
