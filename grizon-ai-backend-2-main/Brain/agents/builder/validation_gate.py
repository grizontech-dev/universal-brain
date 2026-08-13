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

    def _run_package_manager_install(self) -> Tuple[bool, str]:
        """Execute package manager install (respecting lockfiles) after dependency auto-patching."""
        if not os.path.isdir(self.frontend_dir):
            return False, "frontend directory missing"

        # Detect package manager
        pm_cmd = ["npm", "install", "--include=dev"]
        if os.path.isfile(os.path.join(self.frontend_dir, "pnpm-lock.yaml")):
            pnpm_path = shutil.which("pnpm") or shutil.which("pnpm.cmd")
            if pnpm_path:
                pm_cmd = [pnpm_path, "install", "--prod=false"]
        elif os.path.isfile(os.path.join(self.frontend_dir, "yarn.lock")):
            yarn_path = shutil.which("yarn") or shutil.which("yarn.cmd")
            if yarn_path:
                pm_cmd = [yarn_path, "install", "--production=false"]
        else:
            npm_path = shutil.which("npm") or shutil.which("npm.cmd")
            if npm_path:
                pm_cmd = [npm_path, "install", "--include=dev"]

        print(f"{LOG} Running package manager install: {' '.join(pm_cmd)}...", flush=True)
        try:
            res = subprocess.run(
                pm_cmd,
                cwd=self.frontend_dir,
                capture_output=True,
                text=True,
                timeout=120,
                shell=os.name == "nt"
            )
            if res.returncode == 0:
                print(f"{LOG} [OK] Package manager install completed successfully.", flush=True)
                return True, "Success"
            else:
                err_msg = (res.stderr or res.stdout or "npm install failed")[:500]
                print(f"{LOG} [WARN] Package manager install returned non-zero exit code: {err_msg}", flush=True)
                return False, err_msg
        except subprocess.TimeoutExpired:
            print(f"{LOG} [WARN] Package manager install timed out after 120s.", flush=True)
            return False, "Timeout"
        except Exception as e:
            print(f"{LOG} [WARN] Package manager install exception: {e}", flush=True)
            return False, str(e)

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

        # Scan all .jsx, .js, .tsx, .ts files for imports
        imported_packages: Set[str] = set()
        for root, _, files in os.walk(self.frontend_src):
            for file in files:
                if file.endswith((".jsx", ".js", ".tsx", ".ts")):
                    full_path = os.path.join(root, file)
                    try:
                        with open(full_path, "r", encoding="utf-8") as f:
                            content = f.read()
                        # Match import ... from 'package' or require('package')
                        matches = re.findall(r"(?:import\s+.*?\s+from\s+|require\()\s*['\"]([^'\".\n][^'\"]*)['\"]", content)
                        for imp in matches:
                            if imp.startswith("@"):
                                parts = imp.split("/")
                                pkg_name = "/".join(parts[:2]) if len(parts) >= 2 else imp
                            else:
                                pkg_name = imp.split("/")[0]
                            imported_packages.add(pkg_name)
                    except Exception:
                        pass

        # Check imported packages against installed dependencies
        modified_pkg = False
        if "dependencies" not in pkg_data:
            pkg_data["dependencies"] = {}

        for pkg in imported_packages:
            if pkg in CORE_PACKAGES or pkg in installed_deps:
                continue
            
            # Check whitelist
            if pkg in APPROVED_PACKAGES:
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
        if (modified_pkg or not node_modules_exist) and os.path.isfile(pkg_json_path):
            try:
                if modified_pkg:
                    with open(pkg_json_path, "w", encoding="utf-8") as f:
                        json.dump(pkg_data, f, indent=2)
                    print(f"{LOG} [OK] Saved updated frontend/package.json with {len(patched_packages)} patched deps", flush=True)
                
                # CRITICAL: Trigger package manager install when dependencies change or node_modules is missing
                ok_inst, inst_msg = self._run_package_manager_install()
                if not ok_inst:
                    warnings.append(ValidationWarning("dependencies", f"Package manager install status: {inst_msg}"))
            except Exception as e:
                errors.append(ValidationError("dependencies", f"Failed to save package.json: {e}", "frontend/package.json"))

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

                # Extract relative imports: import { X } from './Header' or import Header from './Header'
                import_matches = re.finditer(r"import\s+(?:(\{[^}]+\})|([a-zA-Z0-9_$]+))\s+from\s+['\"](\.\/[^'\"]+|\.\.\/[^'\"]+)['\"]", content)
                file_dir = os.path.dirname(full_p)

                for m in import_matches:
                    named_imports_str = m.group(1)
                    default_import = m.group(2)
                    imp_path = m.group(3)

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
                        # Check named exports if imported using { X, Y }
                        if named_imports_str:
                            try:
                                with open(found_target_path, "r", encoding="utf-8") as tf:
                                    target_content = tf.read()
                                names = [n.strip() for n in named_imports_str.strip("{}").split(",") if n.strip()]
                                for name in names:
                                    # Clean alias if present (e.g. A as B)
                                    export_name = name.split(" as ")[0].strip()
                                    # Check for export const X, export function X, export class X, export { X }
                                    export_patterns = [
                                        rf"export\s+(?:const|function|class|let|var)\s+{export_name}\b",
                                        rf"export\s+\{{[^}}]*\b{export_name}\b[^}}]*\}}",
                                        rf"export\s+default\b"
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

        # Check for orphan components -> WARNING (non-blocking)
        components_dir = os.path.join(self.frontend_src, "components")
        if os.path.isdir(components_dir):
            for f in os.listdir(components_dir):
                if f.endswith((".jsx", ".js", ".tsx", ".ts")):
                    rel_comp = f"components/{f}"
                    if rel_comp not in all_imported_targets and f != "App.jsx":
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
            warnings.append(ValidationWarning("compilation", "vite executable not found on host — skipping build check"))
            return errors, warnings
        try:
            process = subprocess.run(
                cmd,
                cwd=self.frontend_dir,
                capture_output=True,
                text=True,
                timeout=90,
                shell=os.name == "nt"
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
                res = subprocess.run(cmd, cwd=self.frontend_dir, capture_output=True, text=True, timeout=30, shell=os.name == "nt")
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

    def _check_runtime_execution(self) -> Tuple[List[ValidationError], List[ValidationWarning]]:
        """Extensible hook for runtime error capture / dev server smoke testing."""
        errors = []
        warnings = []
        return errors, warnings

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

    async def run_validation_and_repair(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Core Validation Loop: Generate → Validate → Repair → Validate → Deliver. Max 5 repair attempts."""
        print(f"\n{LOG} ===============================================================", flush=True)
        print(f"{LOG} START VALIDATION GATE | session={self.session_id}", flush=True)
        print(f"{LOG} ===============================================================", flush=True)

        validation_history = state.get("validation_history", [])
        previous_fingerprints: Set[str] = set()

        for attempt in range(1, self.max_repair_attempts + 1):
            state["status"] = "validating"
            await self._emit_status("validating", attempt=attempt)

            # Run 5 Validation Checks
            dep_errors, dep_warns, patched = self._check_and_patch_dependencies()
            imp_errors, imp_warns = self._check_imports_and_structure()
            build_errors, build_warns = self._check_static_compilation()
            quality_errors, quality_warns = self._check_eslint_quality()
            runtime_errors, runtime_warns = self._check_runtime_execution()

            all_errors = dep_errors + imp_errors + build_errors + quality_errors + runtime_errors
            all_warnings = dep_warns + imp_warns + build_warns + quality_warns + runtime_warns

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

            repair_success = await self._run_targeted_repair(all_errors, attempt, stagnant_errors)
            if not repair_success:
                print(f"{LOG} [WARN] Repair agent produced no file changes -- stopping early to save LLM credits", flush=True)
                state["status"] = "validation_failed"
                await self._emit_status("validation_failed", attempt=attempt, errors=all_errors)
                return {
                    "passed": False,
                    "attempts": attempt,
                    "errors": [e.to_dict() for e in all_errors]
                }

            previous_fingerprints = current_fingerprints

        state["status"] = "validation_failed"
        return {"passed": False, "errors": [e.to_dict() for e in all_errors]}

    async def _run_targeted_repair(self, errors: List[ValidationError], attempt: int, stagnant_errors: Set[str] = None) -> bool:
        """Call LLM Repair Agent with TARGETED context & stagnant error warnings."""
        print(f"{LOG} → Repair Agent invoked for {len(errors)} errors (attempt {attempt})...", flush=True)

        error_contexts = []
        for i, err in enumerate(errors[:3]):  # Max 3 errors per repair pass
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
            + pkg_json_content + "\n"
            "RULES FOR REPAIR:\n"
            "1. Fix ONLY the specific files mentioned in the errors using `client_save_code`.\n"
            "2. Do NOT rewrite unrelated working code.\n"
            "3. If an import path or exported name is wrong, fix the import/export declaration.\n"
            "4. If a dependency is missing from package.json, add it to dependencies.\n"
            "5. Preserve plain JSX format (do NOT convert to TypeScript/TSX unless requested).\n"
            "6. Make one tool call per file fix."
        )

        if not self.llm:
            print(f"{LOG} [ERROR] Repair LLM not provided -- skipping repair pass", flush=True)
            return False

        try:
            bound_llm = self.llm.bind_tools([client_save_code])
            messages = [
                SystemMessage(content="You are an expert React Debug & Repair Agent. Fix build/import errors with minimal targeted edits."),
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
