import os
import io
import json
import time
import base64
import tarfile
import logging
import asyncio
import threading
from typing import Any, Dict, Optional

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("sandbox_mcp")

RUNTIME_SANDBOX_MCP = "sandbox_mcp"


class SandboxMCPService:
    def __init__(self):
        self._session_activity: Dict[str, float] = {}
        self.TTL_MINUTES = 30
        self._workspace_root: Optional[str] = None
        self._cleanup_task: Optional[asyncio.Task] = None
        self._initialized = False
        self._url: Optional[str] = None
        self._token: Optional[str] = None
        self._tunnel_urls: Dict[str, str] = {}

    async def initialize(self):
        if self._initialized:
            return
        url = os.getenv("SANDBOX_MCP_URL")
        token = os.getenv("SANDBOX_MCP_TOKEN")
        print(f"[SANDBOX_MCP] Initializing... URL={url[:50] if url else 'MISSING'}...")
        if not url or not token:
            print("[SANDBOX_MCP] WARNING: SANDBOX_MCP_URL or SANDBOX_MCP_TOKEN not set. Remote MCP Sandbox will be unavailable.")
            self._initialized = False
            return
        self._url = url
        self._token = token
        try:
            await self._connect()
        except Exception as e:
            print(f"[SANDBOX_MCP] Connection failed: {e}")
            self._initialized = False

    async def _connect(self):
        """Verify MCP server is reachable. Each _call_tool creates its own fresh session."""
        print(f"[SANDBOX_MCP] Connecting to MCP server...")
        # Create a temporary session just to verify connectivity
        try:
            transport_ctx = streamablehttp_client(
                url=self._url,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=30,
            )
        except TypeError:
            # Older MCP library doesn't support headers kwarg
            print("[SANDBOX_MCP] headers kwarg not supported, trying without auth header")
            transport_ctx = streamablehttp_client(
                url=self._url,
                timeout=30,
            )
        try:
            async with streamablehttp_client(
                url=self._url,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=30,
            ) as (read_stream, write_stream, *rest):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools_result = await session.list_tools()
                    tool_names = [t.name for t in tools_result.tools]
                    self._initialized = True
                    print(f"[SANDBOX_MCP] Connected OK | tools={tool_names}")
                    logger.info("Loaded %d tools from sandbox MCP server: %s", len(tool_names), tool_names)
        except Exception as e:
            print(f"[SANDBOX_MCP] Connection failed: {e}")
            self._initialized = False
            raise

    async def _disconnect(self):
        """Reset MCP state. Each _call_tool creates its own fresh session."""
        self._initialized = False

    def _with_client_id(self, arguments: dict, client_id: str = None) -> dict:
        print(f"[SANDBOX_MCP] _with_client_id | client_id={client_id} | type={type(client_id).__name__}")
        if client_id:
            prefixed = f"grizon-{client_id}"
            arguments["client_id"] = str(prefixed)
            print(f"[SANDBOX_MCP] _with_client_id | ADDED client_id={prefixed} to args (prefixed with grizon-)")
        else:
            arguments["client_id"] = "grizon-default"
            print(f"[SANDBOX_MCP] _with_client_id | client_id is None/empty — using grizon-default")
        return arguments

    async def _call_tool(self, name: str, arguments: dict, timeout: float = 600) -> Any:
        """Call an MCP tool using a FRESH session per call to avoid shared session corruption."""
        if not self._initialized:
            await self.initialize()
        if not self._initialized:
            raise RuntimeError(
                "MCP Sandbox is not initialized or configured (SANDBOX_MCP_URL / SANDBOX_MCP_TOKEN are missing or invalid)"
            )

        call_start_time = time.time()
        safe_args = {k: (v[:50] + "..." if isinstance(v, str) and len(v) > 50 else v) for k, v in arguments.items()}
        print(f"[SANDBOX_MCP] _call_tool '{name}' | timeout={timeout}s | args={safe_args}")
        print(f"[SANDBOX_MCP] _call_tool '{name}' | full args_keys={list(arguments.keys())} | args_sizes={ {k: len(str(v)) for k, v in arguments.items()} }")

        # Create a FRESH MCP session for each tool call to avoid:
        # 1. GC killing the shared session mid-call
        # 2. Concurrent calls corrupting the SSE stream
        # 3. anyio cancel-scope cross-task errors
        try:
            transport_ctx = streamablehttp_client(
                url=self._url,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=timeout,
            )
        except TypeError:
            transport_ctx = streamablehttp_client(
                url=self._url,
                timeout=timeout,
            )
        try:
            print(f"[SANDBOX_MCP] Opening transport connection...")
            async with streamablehttp_client(
                url=self._url,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=timeout,
            ) as (read_stream, write_stream, *rest):
                print(f"[SANDBOX_MCP] Creating and initializing session...")
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    elapsed_setup = time.time() - call_start_time
                    print(f"[SANDBOX_MCP] Fresh session ready in {elapsed_setup:.1f}s, calling '{name}'...")

                    task = asyncio.create_task(session.call_tool(name, arguments))
                    done, pending = await asyncio.wait([task], timeout=timeout)
                    if pending:
                        task.cancel()
                        try:
                            await asyncio.wait_for(task, timeout=5)
                        except (asyncio.CancelledError, asyncio.TimeoutError):
                            pass
                        raise RuntimeError(f"MCP call_tool '{name}' timed out after {timeout}s")
                    result = task.result()
                    elapsed = time.time() - call_start_time
                    print(f"[SANDBOX_MCP] _call_tool '{name}' returned in {elapsed:.1f}s | type={type(result).__name__}")
                    return result
        except RuntimeError:
            raise
        except Exception as e:
            elapsed = time.time() - call_start_time
            print(f"[SANDBOX_MCP] _call_tool '{name}' ERROR after {elapsed:.1f}s: {e}")
            raise


    def _parse_response(self, result) -> Dict[str, Any]:
        """Parse MCP CallToolResult into a dict."""
        print(f"[SANDBOX_MCP] _parse_response result type={type(result).__name__}")
        parts = []
        if hasattr(result, "content") and result.content:
            for i, item in enumerate(result.content):
                print(f"[SANDBOX_MCP]   content[{i}] type={type(item).__name__}")
                if hasattr(item, "text") and item.text:
                    parts.append(item.text)
                elif isinstance(item, dict) and "text" in item:
                    parts.append(item["text"])
                else:
                    parts.append(str(item))
        elif isinstance(result, list):
            for i, item in enumerate(result):
                if hasattr(item, "text") and item.text:
                    parts.append(item.text)
                elif isinstance(item, dict) and "text" in item:
                    parts.append(item["text"])
                else:
                    parts.append(str(item))
        else:
            parts.append(str(result))

        text = "\n".join(parts)
        print(f"[SANDBOX_MCP]   FULL TEXT ({len(text)} chars):")
        # Log full text in chunks to avoid truncation
        for chunk_start in range(0, len(text), 500):
            chunk = text[chunk_start:chunk_start+500]
            print(f"[SANDBOX_MCP]   [{chunk_start}:{chunk_start+500}] {chunk}")
        try:
            parsed = json.loads(text)
            print(f"[SANDBOX_MCP]   json.loads OK | keys={list(parsed.keys()) if isinstance(parsed, dict) else 'not dict'}")
            # If parsed is a list with one dict element, unwrap it
            if isinstance(parsed, list) and len(parsed) == 1 and isinstance(parsed[0], dict):
                print(f"[SANDBOX_MCP]   unwrapping single-element list")
                parsed = parsed[0]
            return parsed
        except (json.JSONDecodeError, TypeError) as e:
            print(f"[SANDBOX_MCP]   json.loads FAILED: {e}")
            return {"raw": text}

    async def ensure_tool(self, name: str):
        if not self._initialized:
            await self.initialize()

    def get_workspace_dir(self, session_id: str, user_id: str = None) -> str:
        if not self._workspace_root:
            workspace_base = os.path.join(os.getcwd(), "workspaces")
            os.makedirs(workspace_base, exist_ok=True)
            self._workspace_root = workspace_base
        if user_id:
            d = os.path.abspath(os.path.join(self._workspace_root, user_id, session_id))
        else:
            d = os.path.abspath(os.path.join(self._workspace_root, session_id))
        os.makedirs(d, exist_ok=True)
        return d

    async def save_file(self, session_id: str, filename: str, code: str, user_id: str = None) -> str:
        workspace_dir = self.get_workspace_dir(session_id, user_id=user_id)
        target = os.path.abspath(os.path.join(workspace_dir, filename))
        if not target.startswith(workspace_dir):
            return "ERROR: Path traversal blocked"
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(code)
        self._touch(session_id)
        logger.info("[sandbox_mcp] Saved '%s' for session '%s'", filename, session_id)
        return f"Saved {filename}"

    async def save_code_to_sandbox(self, session_id: str, filename: str, code: str, user_id: str = None) -> Dict[str, Any]:
        try:
            logger.info(
                "[sandbox_mcp] Saving '%s' directly to sandbox '%s' (%d bytes)",
                filename, session_id, len(code),
            )
            result = await self._call_tool("save_code", self._with_client_id({
                "session_id": session_id,
                "filename": filename,
                "code": code,
            }, user_id))
            self._touch(session_id)
            return self._parse_response(result)
        except Exception as e:
            logger.error("[sandbox_mcp] save_code_to_sandbox failed: %s", e)
            return {"status": "error", "error": str(e)}

    def _resolve_entrypoint(self, workspace_dir: str, entrypoint: str) -> str:
        """Resolve entrypoint to full relative path. If 'main.jsx', find 'frontend/src/main.jsx'."""
        if "/" in entrypoint or "\\" in entrypoint:
            return entrypoint
        for root, dirs, files in os.walk(workspace_dir):
            for f in files:
                if f == entrypoint:
                    rel = os.path.relpath(os.path.join(root, f), workspace_dir)
                    print(f"[SANDBOX_MCP] Resolved entrypoint '{entrypoint}' -> '{rel}'")
                    return rel
        print(f"[SANDBOX_MCP] WARNING: entrypoint '{entrypoint}' not found, using as-is")
        return entrypoint

    async def deploy_workspace(
        self, session_id: str, entrypoint: str, user_id: str = None
    ) -> Dict[str, Any]:
        print(f"\n{'='*80}")
        print(f"[SANDBOX_MCP] ===== deploy_workspace START =====")
        print(f"[SANDBOX_MCP] session_id = {session_id}")
        print(f"[SANDBOX_MCP] entrypoint = {entrypoint}")
        print(f"[SANDBOX_MCP] user_id    = {user_id}")
        print(f"[SANDBOX_MCP] user_id type = {type(user_id).__name__}")
        print(f"{'='*80}")

        # Try user_id path first, then fall back to session_id-only path
        workspace_dir = self.get_workspace_dir(session_id, user_id=user_id)
        print(f"[SANDBOX_MCP] STEP-1 workspace_dir (user_id)  = {workspace_dir}")
        print(f"[SANDBOX_MCP] STEP-1 exists={os.path.isdir(workspace_dir)} | empty={not os.listdir(workspace_dir) if os.path.isdir(workspace_dir) else 'N/A'}")

        if not os.path.isdir(workspace_dir) or not os.listdir(workspace_dir):
            fallback_dir = self.get_workspace_dir(session_id)
            print(f"[SANDBOX_MCP] STEP-1 fallback_dir (no user) = {fallback_dir}")
            print(f"[SANDBOX_MCP] STEP-1 fallback exists={os.path.isdir(fallback_dir)} | files={os.listdir(fallback_dir)[:10] if os.path.isdir(fallback_dir) else 'N/A'}")
            if os.path.isdir(fallback_dir) and os.listdir(fallback_dir):
                print(f"[SANDBOX_MCP] STEP-1 USING FALLBACK: {fallback_dir}")
                workspace_dir = fallback_dir
            else:
                print(f"[SANDBOX_MCP] STEP-1 BOTH PATHS EMPTY!")

        entrypoint = self._resolve_entrypoint(workspace_dir, entrypoint)
        print(f"[SANDBOX_MCP] STEP-2 resolved entrypoint = {entrypoint}")

        files = os.listdir(workspace_dir) if os.path.isdir(workspace_dir) else []
        print(f"[SANDBOX_MCP] STEP-2 top-level files = {files}")

        # List all files recursively
        all_files = []
        if os.path.isdir(workspace_dir):
            for root, dirs, fnames in os.walk(workspace_dir):
                if "node_modules" in dirs:
                    dirs.remove("node_modules")
                for f in fnames:
                    rel = os.path.relpath(os.path.join(root, f), workspace_dir)
                    all_files.append(rel)
        print(f"[SANDBOX_MCP] STEP-2 ALL files ({len(all_files)}): {all_files[:50]}")

        if not os.path.isdir(workspace_dir):
            print(f"[SANDBOX_MCP] ERROR: workspace dir not found: {workspace_dir}")
            return {"status": "error", "error": f"Workspace {session_id} not found"}

        # ═══ FALLBACK TEMPLATE CREATION ═══
        # If essential files are missing (template not loaded), create them now
        frontend_src = os.path.join(workspace_dir, "frontend", "src")
        has_frontend = os.path.isdir(frontend_src)

        if has_frontend:
            # Create main.jsx if missing
            main_jsx = os.path.join(frontend_src, "main.jsx")
            if not os.path.isfile(main_jsx):
                print(f"[SANDBOX_MCP] FALLBACK: Creating missing frontend/src/main.jsx")
                os.makedirs(os.path.dirname(main_jsx), exist_ok=True)
                with open(main_jsx, "w") as f:
                    f.write('import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\nReactDOM.createRoot(document.getElementById("root")).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);')

            # Create index.html if missing
            index_html = os.path.join(workspace_dir, "frontend", "index.html")
            if not os.path.isfile(index_html):
                print(f"[SANDBOX_MCP] FALLBACK: Creating missing frontend/index.html")
                with open(index_html, "w") as f:
                    f.write('<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>')

            # Create vite.config.js if missing
            vite_cfg = os.path.join(workspace_dir, "frontend", "vite.config.js")
            if not os.path.isfile(vite_cfg):
                print(f"[SANDBOX_MCP] FALLBACK: Creating missing frontend/vite.config.js")
                with open(vite_cfg, "w") as f:
                    f.write('import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { port: 9999, host: "0.0.0.0", hmr: false, allowedHosts: true },\n  base: "./",\n});')

            # Create frontend/package.json if missing
            pkg_json = os.path.join(workspace_dir, "frontend", "package.json")
            if not os.path.isfile(pkg_json):
                print(f"[SANDBOX_MCP] FALLBACK: Creating missing frontend/package.json")
                with open(pkg_json, "w") as f:
                    f.write('{\n  "name": "frontend",\n  "private": true,\n  "version": "0.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite --port 9999 --host 0.0.0.0",\n    "build": "vite build",\n    "preview": "vite preview"\n  },\n  "dependencies": {\n    "react": "^18.2.0",\n    "react-dom": "^18.2.0",\n    "react-router-dom": "^6.20.0"\n  },\n  "devDependencies": {\n    "@vitejs/plugin-react": "^4.2.0",\n    "vite": "^5.0.0",\n    "tailwindcss": "^3.3.0",\n    "postcss": "^8.4.0",\n    "autoprefixer": "^10.4.0"\n  }\n}')

            # Create frontend/src/index.css if missing (Tailwind entry)
            index_css = os.path.join(frontend_src, "index.css")
            if not os.path.isfile(index_css):
                print(f"[SANDBOX_MCP] FALLBACK: Creating missing frontend/src/index.css")
                with open(index_css, "w") as f:
                    f.write('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody {\n  margin: 0;\n  background: #09090b;\n  color: #fff;\n}\n')

            # Create tailwind.config.js if missing
            tw_cfg = os.path.join(workspace_dir, "frontend", "tailwind.config.js")
            if not os.path.isfile(tw_cfg):
                print(f"[SANDBOX_MCP] FALLBACK: Creating missing frontend/tailwind.config.js")
                with open(tw_cfg, "w") as f:
                    f.write('/** @type {import("tailwindcss").Config} */\nexport default {\n  content: ["./index.html", "./src/**/*.{js,jsx}"],\n  theme: { extend: {} },\n  plugins: [],\n};')

            # Create postcss.config.js if missing
            postcss_cfg = os.path.join(workspace_dir, "frontend", "postcss.config.js")
            if not os.path.isfile(postcss_cfg):
                print(f"[SANDBOX_MCP] FALLBACK: Creating missing frontend/postcss.config.js")
                with open(postcss_cfg, "w") as f:
                    f.write('export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};')

            # Create App.jsx placeholder if missing
            app_jsx = os.path.join(frontend_src, "App.jsx")
            if not os.path.isfile(app_jsx):
                print(f"[SANDBOX_MCP] FALLBACK: Creating placeholder frontend/src/App.jsx")
                with open(app_jsx, "w") as f:
                    f.write('export default function App() {\n  return <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center"><h1 className="text-2xl">App Loading...</h1></div>;\n}\n')

        # Re-scan files after fallback creation
        all_files = []
        if os.path.isdir(workspace_dir):
            for root, dirs, fnames in os.walk(workspace_dir):
                if "node_modules" in dirs:
                    dirs.remove("node_modules")
                for f in fnames:
                    rel = os.path.relpath(os.path.join(root, f), workspace_dir)
                    all_files.append(rel)
        print(f"[SANDBOX_MCP] STEP-3 deploy_workspace | AFTER FALLBACK: {len(all_files)} files")
        if has_frontend:
            frontend_files = [f for f in all_files if f.startswith("frontend/")]
            print(f"[SANDBOX_MCP] STEP-3 frontend files: {frontend_files[:30]}")

        # ═══ VITE + PKG PATCHES ═══
        import re as _re
        vite_cfg = os.path.join(workspace_dir, "frontend", "vite.config.js")
        if os.path.exists(vite_cfg):
            try:
                with open(vite_cfg, "r") as f:
                    content = f.read()
                # Replace entire defineConfig block with clean version
                clean_vite = """import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 9999,
    host: "0.0.0.0",
    hmr: false,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false
      }
    }
  }
});"""
                with open(vite_cfg, "w") as f:
                    f.write(clean_vite)
                print(f"[SANDBOX_MCP] STEP-3 Rewrote vite.config.js: clean version with proxy, port=9999")
            except Exception as e:
                print(f"[SANDBOX_MCP] STEP-3 Could not patch vite.config.js: {e}")

        pkg_json = os.path.join(workspace_dir, "frontend", "package.json")
        if os.path.exists(pkg_json):
            try:
                with open(pkg_json, "r") as f:
                    pkg = json.loads(f.read())
                scripts = pkg.get("scripts", {})
                scripts["dev"] = "vite --port 9999 --host 0.0.0.0"
                scripts["predev"] = "fuser -k 9999/tcp 2>/dev/null || true"
                pkg["scripts"] = scripts
                with open(pkg_json, "w") as f:
                    json.dump(pkg, f, indent=2)
                print(f"[SANDBOX_MCP] STEP-3 Patched package.json: port=9999 + predev kill")
            except Exception as e:
                print(f"[SANDBOX_MCP] STEP-3 Could not patch package.json: {e}")

        # ═══ ENSURE backend/ EXISTS (runner requires it for dual-service mode) ═══
        backend_dir = os.path.join(workspace_dir, "backend")
        if not os.path.isdir(backend_dir):
            print(f"[SANDBOX_MCP] STEP-3 Creating minimal backend/ folder (runner needs it for dual-service mode)")
            os.makedirs(backend_dir, exist_ok=True)
            with open(os.path.join(backend_dir, "server.js"), "w") as f:
                f.write('const express = require("express");\nconst app = express();\napp.get("/api/health", (req, res) => res.json({ status: "ok" }));\napp.listen(3001, "0.0.0.0", () => console.log("Backend running on 3001"));\n')
            with open(os.path.join(backend_dir, "package.json"), "w") as f:
                json.dump({"name": "backend", "version": "1.0.0", "scripts": {"start": "node server.js"}, "dependencies": {"express": "^4.18.0", "cors": "^2.8.5"}}, f, indent=2)

        # Validate App.jsx imports
        app_jsx = os.path.join(workspace_dir, "frontend", "src", "App.jsx")
        components_dir = os.path.join(workspace_dir, "frontend", "src", "components")
        if os.path.exists(app_jsx):
            try:
                with open(app_jsx, "r") as f:
                    app_content = f.read()
                import_matches = _re.findall(r"import\s+\w+\s+from\s+['\"]\.\/components\/(\w+)", app_content)
                import_matches += _re.findall(r"import\s+\w+\s+from\s+['\"]\.\/pages\/(\w+)", app_content)
                actual_files = set()
                if os.path.isdir(components_dir):
                    for fname in os.listdir(components_dir):
                        if fname.endswith(('.jsx', '.tsx', '.js', '.ts')):
                            actual_files.add(fname.split('.')[0])
                pages_dir = os.path.join(workspace_dir, "frontend", "src", "pages")
                if os.path.isdir(pages_dir):
                    for fname in os.listdir(pages_dir):
                        if fname.endswith(('.jsx', '.tsx', '.js', '.ts')):
                            actual_files.add(fname.split('.')[0])
                missing = [imp for imp in import_matches if imp not in actual_files]
                if missing:
                    print(f"[SANDBOX_MCP] STEP-3 WARNING: App.jsx imports missing: {missing}")
                    for imp in missing:
                        app_content = _re.sub(rf"import\s+\w+\s+from\s+['\"]\.\/components\/{imp}['\"].*\n", "", app_content)
                        app_content = _re.sub(rf"import\s+\w+\s+from\s+['\"]\.\/pages\/{imp}['\"].*\n", "", app_content)
                        app_content = _re.sub(rf"<Route[^>]*component\s*=\s*{{?{imp}}}?[^/]*/?>\s*\n?", "", app_content)
                    with open(app_jsx, "w") as f:
                        f.write(app_content)
                    print(f"[SANDBOX_MCP] STEP-3 Auto-fixed App.jsx: removed {len(missing)} broken imports")
                else:
                    print(f"[SANDBOX_MCP] STEP-3 Import validation OK: {len(import_matches)} imports match {len(actual_files)} files")
            except Exception as e:
                print(f"[SANDBOX_MCP] STEP-3 Could not validate App.jsx imports: {e}")

        # ═══ ARCHIVE CREATION ═══
        print(f"[SANDBOX_MCP] STEP-4 Creating archive from: {workspace_dir}")
        buf = io.BytesIO()
        archive_files = []
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for root, dirs, files in os.walk(workspace_dir):
                if "node_modules" in dirs:
                    dirs.remove("node_modules")
                if ".git" in dirs:
                    dirs.remove(".git")
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, workspace_dir)
                    tar.add(full_path, arcname=rel_path)
                    archive_files.append(rel_path)
        raw_bytes = buf.getvalue()
        archive_b64 = base64.b64encode(raw_bytes).decode()
        print(f"[SANDBOX_MCP] STEP-4 archive raw_bytes={len(raw_bytes)} | b64_chars={len(archive_b64)}")
        print(f"[SANDBOX_MCP] STEP-4 archive contains {len(archive_files)} files:")
        for f in archive_files:
            print(f"[SANDBOX_MCP]   -> {f}")

        has_fe = any(f.startswith("frontend/") for f in archive_files)
        has_be = any(f.startswith("backend/") for f in archive_files)
        has_runner = "sandbox_runner.sh" in archive_files
        print(f"[SANDBOX_MCP] STEP-4 archive CHECK: frontend={has_fe} | backend={has_be} | sandbox_runner.sh={has_runner}")

        # ═══ BUILD MCP CALL ARGS ═══
        args_dict = {
            "session_id": session_id,
            "entrypoint": entrypoint,
            "archive_b64": archive_b64,
        }
        args_with_client = self._with_client_id(args_dict, user_id)
        print(f"[SANDBOX_MCP] STEP-5 FINAL args_keys = {list(args_with_client.keys())}")
        print(f"[SANDBOX_MCP] STEP-5 client_id = {repr(args_with_client.get('client_id', 'NOT IN ARGS'))}")
        print(f"[SANDBOX_MCP] STEP-5 session_id = {args_with_client.get('session_id')}")
        print(f"[SANDBOX_MCP] STEP-5 entrypoint = {args_with_client.get('entrypoint')}")
        print(f"[SANDBOX_MCP] STEP-5 archive_b64 len = {len(args_with_client.get('archive_b64', ''))}")

        # ═══ DELETE OLD SANDBOX ═══
        try:
            print(f"[SANDBOX_MCP] STEP-6 Deleting old sandbox to clear port 9999...")
            del_result = await self.delete_sandbox(session_id, user_id=user_id)
            print(f"[SANDBOX_MCP] STEP-6 delete result = {del_result}")
            import asyncio as _dasync
            await _dasync.sleep(2)
        except Exception as e:
            print(f"[SANDBOX_MCP] STEP-6 Delete sandbox exception: {e}")

        # ═══ CALL execute_workspace_archive ═══
        deploy_start = time.time()
        last_exception = None

        for attempt in range(1, 4):
            try:
                print(f"[SANDBOX_MCP] STEP-7 === CALLING execute_workspace_archive (attempt {attempt}/3) ===")
                print(f"[SANDBOX_MCP] STEP-7 MCP URL = {self._url}")
                token_display = self._token[:12] + "..." if self._token and len(self._token) > 12 else self._token
                print(f"[SANDBOX_MCP] STEP-7 MCP token = {token_display}")
                result = await self._call_tool("execute_workspace_archive", args_with_client, timeout=600)
                elapsed = time.time() - deploy_start
                print(f"[SANDBOX_MCP] STEP-7 === MCP CALL RETURNED in {elapsed:.1f}s ===")
                print(f"[SANDBOX_MCP] STEP-7 raw result type = {type(result).__name__}")

                if hasattr(result, 'content'):
                    for i, c in enumerate(result.content):
                        print(f"[SANDBOX_MCP] STEP-7 result.content[{i}] type={type(c).__name__} text={str(c.text)[:400] if hasattr(c, 'text') else str(c)[:400]}")
                if hasattr(result, 'isError'):
                    print(f"[SANDBOX_MCP] STEP-7 result.isError = {result.isError}")

                parsed = self._parse_response(result)
                print(f"[SANDBOX_MCP] STEP-8 === PARSED RESULT ===")
                if isinstance(parsed, dict):
                    for k, v in parsed.items():
                        val_str = str(v)[:300] if v else str(v)
                        print(f"[SANDBOX_MCP] STEP-8   {k} = {val_str}")
                else:
                    print(f"[SANDBOX_MCP] STEP-8   parsed = {str(parsed)[:600]}")

                status = parsed.get('status', 'unknown') if isinstance(parsed, dict) else 'unknown'
                tunnel = (parsed.get('tunnel_url') or 'none')[:150] if isinstance(parsed, dict) else 'none'
                output = (parsed.get('execution_output') or '')[:600] if isinstance(parsed, dict) else ''
                sandbox_name = parsed.get('sandbox_name', 'NONE') if isinstance(parsed, dict) else 'NONE'
                print(f"[SANDBOX_MCP] STEP-9 FINAL: status={status} | sandbox_name={sandbox_name}")
                print(f"[SANDBOX_MCP] STEP-9 tunnel_url={tunnel}")
                if output:
                    print(f"[SANDBOX_MCP] STEP-9 execution_output={output}")

                if status == 'error' and attempt < 3:
                    print(f"[SANDBOX_MCP] Attempt {attempt} returned error status, retrying in 2s...")
                    self._initialized = False
                    await asyncio.sleep(2)
                    continue

                if status == 'error':
                    print(f"[SANDBOX_MCP] STEP-9 FULL ERROR:")
                    print(json.dumps(parsed, indent=2)[:1500])

                self._touch(session_id)
                print(f"[SANDBOX_MCP] ===== deploy_workspace END (status={status}) =====\n")
                return parsed
            except Exception as e:
                last_exception = e
                elapsed = time.time() - deploy_start
                print(f"[SANDBOX_MCP] STEP-7 EXCEPTION after {elapsed:.1f}s: {e}")
                import traceback
                traceback.print_exc()
                self._initialized = False
                if attempt < 3:
                    await asyncio.sleep(2)

        logger.error("[sandbox_mcp] deploy_workspace failed all 3 attempts: %s", last_exception)
        return {"status": "error", "error": str(last_exception or "Deployment failed after 3 attempts")}

    async def get_sandbox_status(self, session_id: str, user_id: str = None) -> Dict[str, Any]:
        try:
            result = await self._call_tool("get_sandbox_status", self._with_client_id({
                "session_id": session_id,
            }, user_id))
            self._touch(session_id)
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def delete_sandbox(self, session_id: str, user_id: str = None) -> Dict[str, Any]:
        try:
            result = await self._call_tool("delete_sandbox", self._with_client_id({
                "session_id": session_id,
            }, user_id))
            self._session_activity.pop(session_id, None)
            self._tunnel_urls.pop(session_id, None)
            # Do NOT delete local workspace — files are needed for re-deploy
            logger.info("[sandbox_mcp] Deleted sandbox '%s'", session_id)
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def list_sandboxes(self, user_id: str = None) -> Dict[str, Any]:
        try:
            result = await self._call_tool("list_sandboxes", self._with_client_id({}, user_id))
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def get_sandbox_logs(self, session_id: str, user_id: str = None) -> Dict[str, Any]:
        try:
            result = await self._call_tool("get_sandbox_logs", self._with_client_id({
                "session_id": session_id,
            }, user_id))
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def execute_in_sandbox(
        self, session_id: str, entrypoint: str, user_id: str = None
    ) -> Dict[str, Any]:
        try:
            result = await self._call_tool("execute_in_sandbox", self._with_client_id({
                "session_id": session_id,
                "entrypoint": entrypoint,
            }, user_id))
            self._touch(session_id)
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def _touch(self, session_id: str):
        self._session_activity[session_id] = time.time()

    async def cleanup_expired(self):
        now = time.time()
        expired = [
            sid
            for sid, last_activity in list(self._session_activity.items())
            if now - last_activity > self.TTL_MINUTES * 60
        ]
        if expired:
            print(f"[SANDBOX_MCP] Cleanup: {len(expired)} expired sandbox(es) to delete")
        for sid in expired:
            try:
                print(f"[SANDBOX_MCP] Deleting expired sandbox: {sid} (idle {int((now - self._session_activity.get(sid, now)) / 60)}min)")
                await self.delete_sandbox(sid)
                self._session_activity.pop(sid, None)
                self._tunnel_urls.pop(sid, None)
                print(f"[SANDBOX_MCP] Deleted expired sandbox: {sid}")
            except Exception as e:
                print(f"[SANDBOX_MCP] Failed to delete sandbox {sid}: {e}")

    async def cleanup_all(self) -> Dict[str, Any]:
        """Delete ALL tracked sandboxes (active + expired)."""
        all_sids = list(self._session_activity.keys())
        if not all_sids and not self._tunnel_urls:
            return {"status": "ok", "deleted": 0, "message": "No active sandboxes"}
        results = []
        for sid in set(all_sids + list(self._tunnel_urls.keys())):
            try:
                await self.delete_sandbox(sid)
                results.append({"session_id": sid, "status": "deleted"})
                print(f"[SANDBOX_MCP] cleanup_all: deleted {sid}")
            except Exception as e:
                results.append({"session_id": sid, "status": "error", "error": str(e)})
                print(f"[SANDBOX_MCP] cleanup_all: failed {sid}: {e}")
        self._session_activity.clear()
        self._tunnel_urls.clear()
        return {"status": "ok", "deleted": len(results), "results": results}

    async def background_cleanup_loop(self):
        print(f"[SANDBOX_MCP] Cleanup loop running (checking every 60s, TTL={self.TTL_MINUTES}min)")
        while True:
            await asyncio.sleep(60)
            await self.cleanup_expired()

    def start_background_cleanup(self):
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self.background_cleanup_loop())

    def record_activity(self, session_id: str):
        if session_id:
            self._touch(session_id)

    def store_tunnel_url(self, session_id: str, tunnel_url: str):
        if session_id and tunnel_url:
            self._tunnel_urls[session_id] = tunnel_url
            print(f"[SANDBOX_MCP] Stored tunnel URL for {session_id}: {tunnel_url[:60]}...")

    def get_tunnel_url(self, session_id: str) -> Optional[str]:
        return self._tunnel_urls.get(session_id)


_sandbox_mcp_instance: Optional[SandboxMCPService] = None


def get_sandbox_mcp_service() -> SandboxMCPService:
    global _sandbox_mcp_instance
    if _sandbox_mcp_instance is None:
        _sandbox_mcp_instance = SandboxMCPService()
    return _sandbox_mcp_instance
