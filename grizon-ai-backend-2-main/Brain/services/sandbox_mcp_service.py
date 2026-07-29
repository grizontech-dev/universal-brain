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
            transport = await transport_ctx.__aenter__()
            read_stream, write_stream = transport[0], transport[1]
            session_ctx = ClientSession(read_stream, write_stream)
            session = await session_ctx.__aenter__()
            await session.initialize()
            tools_result = await session.list_tools()
            tool_names = [t.name for t in tools_result.tools]
            # Clean up immediately — don't store shared session
            await session_ctx.__aexit__(None, None, None)
            await transport_ctx.__aexit__(None, None, None)
            self._initialized = True
            print(f"[SANDBOX_MCP] Connected OK | tools={tool_names}")
            logger.info("Loaded %d tools from sandbox MCP server: %s", len(tool_names), tool_names)
        except Exception as e:
            print(f"[SANDBOX_MCP] Connection failed: {e}")
            try:
                await transport_ctx.__aexit__(None, None, None)
            except Exception:
                pass
            raise

    async def _disconnect(self):
        """Reset MCP state. Each _call_tool creates its own fresh session."""
        self._initialized = False

    async def _call_tool(self, name: str, arguments: dict, timeout: float = 600) -> Any:
        """Call an MCP tool using a FRESH session per call to avoid shared session corruption."""
        if not self._initialized:
            await self.initialize()
        if not self._initialized:
            raise RuntimeError(
                "MCP Sandbox is not initialized or configured (SANDBOX_MCP_URL / SANDBOX_MCP_TOKEN are missing or invalid)"
            )

        call_start_time = time.time()
        print(f"[SANDBOX_MCP] _call_tool '{name}' | timeout={timeout}s | args_keys={list(arguments.keys())}")

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
            # NO asyncio.wait_for here — anyio cancel scope can't handle it.
            # Let the connection establish at its own pace.
            print(f"[SANDBOX_MCP] Opening transport connection...")
            transport = await transport_ctx.__aenter__()
            read_stream, write_stream = transport[0], transport[1]

            session_ctx = ClientSession(read_stream, write_stream)
            print(f"[SANDBOX_MCP] Creating session...")
            session = await session_ctx.__aenter__()
            print(f"[SANDBOX_MCP] Initializing session...")
            await session.initialize()

            elapsed_setup = time.time() - call_start_time
            print(f"[SANDBOX_MCP] Fresh session ready in {elapsed_setup:.1f}s, calling '{name}'...")

            # Use asyncio.wait for timeout (NOT asyncio.wait_for which breaks on Windows)
            task = asyncio.create_task(session.call_tool(name, arguments))
            try:
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
            finally:
                # Clean up session — MUST be in same task context as __aenter__
                # Do NOT use asyncio.wait_for here (breaks anyio cancel scope)
                try:
                    await session_ctx.__aexit__(None, None, None)
                except Exception:
                    pass
                try:
                    await transport_ctx.__aexit__(None, None, None)
                except Exception:
                    pass
        except RuntimeError:
            raise
        except Exception as e:
            elapsed = time.time() - call_start_time
            print(f"[SANDBOX_MCP] _call_tool '{name}' ERROR after {elapsed:.1f}s: {e}")
            try:
                await transport_ctx.__aexit__(None, None, None)
            except Exception:
                pass
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

    def get_workspace_dir(self, session_id: str) -> str:
        if not self._workspace_root:
            workspace_base = os.path.join(os.getcwd(), "workspaces")
            os.makedirs(workspace_base, exist_ok=True)
            self._workspace_root = workspace_base
        d = os.path.abspath(os.path.join(self._workspace_root, session_id))
        os.makedirs(d, exist_ok=True)
        return d

    async def save_file(self, session_id: str, filename: str, code: str) -> str:
        workspace_dir = self.get_workspace_dir(session_id)
        target = os.path.abspath(os.path.join(workspace_dir, filename))
        if not target.startswith(workspace_dir):
            return "ERROR: Path traversal blocked"
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(code)
        self._touch(session_id)
        logger.info("[sandbox_mcp] Saved '%s' for session '%s'", filename, session_id)
        return f"Saved {filename}"

    async def save_code_to_sandbox(self, session_id: str, filename: str, code: str) -> Dict[str, Any]:
        try:
            logger.info(
                "[sandbox_mcp] Saving '%s' directly to sandbox '%s' (%d bytes)",
                filename, session_id, len(code),
            )
            result = await self._call_tool("save_code", {
                "session_id": session_id,
                "filename": filename,
                "code": code,
            })
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
        self, session_id: str, entrypoint: str
    ) -> Dict[str, Any]:
        workspace_dir = self.get_workspace_dir(session_id)
        entrypoint = self._resolve_entrypoint(workspace_dir, entrypoint)
        files = os.listdir(workspace_dir) if os.path.isdir(workspace_dir) else []
        print(f"[SANDBOX_MCP] deploy_workspace | session={session_id} | entrypoint={entrypoint} | files={files}")
        if not os.path.isdir(workspace_dir):
            print(f"[SANDBOX_MCP] ERROR: workspace dir not found: {workspace_dir}")
            return {"status": "error", "error": f"Workspace {session_id} not found"}

        # Enforce port 9999 + disable HMR in vite.config.js and package.json before archiving
        import re as _re
        vite_cfg = os.path.join(workspace_dir, "frontend", "vite.config.js")
        if os.path.exists(vite_cfg):
            try:
                with open(vite_cfg, "r") as f:
                    content = f.read()
                patched = _re.sub(r'port:\s*5173', 'port: 9999', content)
                
                # If no server config exists, inject it right after defineConfig({
                if 'server:' not in patched and 'server :' not in patched and 'defineConfig({' in patched:
                    patched = _re.sub(r'defineConfig\(\{', 'defineConfig({\n  server: { port: 9999, host: "0.0.0.0", hmr: false, allowedHosts: true },\n  base: "./",', patched)
                else:
                    # Fallback logic if server config exists
                    if "base:" not in patched and "base :" not in patched:
                        patched = patched.replace(
                            'server: {',
                            'base: "./",\n  server: {'
                        ) if 'server: {' in patched else patched.replace(
                            'server:{',
                            'base:"./",server:{'
                        )
                    if 'hmr' not in patched:
                        patched = patched.replace(
                            'server: {',
                            'server: { hmr: false, host: "0.0.0.0", allowedHosts: true,'
                        ) if 'server: {' in patched else patched.replace(
                            'server:{',
                            'server:{ hmr: false, host: "0.0.0.0", allowedHosts: true,'
                        )
                
                if patched != content:
                    with open(vite_cfg, "w") as f:
                        f.write(patched)
                    print(f"[SANDBOX_MCP] Patched vite.config.js: base='./', port=9999, hmr=false")
            except Exception as e:
                print(f"[SANDBOX_MCP] Could not patch vite.config.js: {e}")

        pkg_json = os.path.join(workspace_dir, "frontend", "package.json")
        if os.path.exists(pkg_json):
            try:
                with open(pkg_json, "r") as f:
                    content = f.read()
                patched = content.replace("--port 5173", "--port 9999")
                # Also catch default vite dev script and force port
                patched = _re.sub(r'"dev":\s*"vite"', '"dev": "vite --port 9999 --host 0.0.0.0"', patched)
                if patched != content:
                    with open(pkg_json, "w") as f:
                        f.write(patched)
                    print(f"[SANDBOX_MCP] Patched package.json: 5173 -> 9999")
            except Exception as e:
                print(f"[SANDBOX_MCP] Could not patch package.json: {e}")

        # Validate App.jsx imports match actual component files
        app_jsx = os.path.join(workspace_dir, "frontend", "src", "App.jsx")
        components_dir = os.path.join(workspace_dir, "frontend", "src", "components")
        if os.path.exists(app_jsx):
            try:
                with open(app_jsx, "r") as f:
                    app_content = f.read()
                # Find all import paths from ./components/XXX
                import_matches = _re.findall(r"import\s+\w+\s+from\s+['\"]\.\/components\/(\w+)", app_content)
                # Also check ./pages/XXX imports
                import_matches += _re.findall(r"import\s+\w+\s+from\s+['\"]\.\/pages\/(\w+)", app_content)

                # Get actual files
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

                # Check for missing imports
                missing = [imp for imp in import_matches if imp not in actual_files]
                if missing:
                    print(f"[SANDBOX_MCP] WARNING: App.jsx imports missing components: {missing}")
                    print(f"[SANDBOX_MCP] Actual files: {sorted(actual_files)}")
                    # Auto-fix: rewrite App.jsx to only import existing components
                    for imp in missing:
                        # Remove the import line and any route using it
                        app_content = _re.sub(rf"import\s+\w+\s+from\s+['\"]\.\/components\/{imp}['\"].*\n", "", app_content)
                        app_content = _re.sub(rf"import\s+\w+\s+from\s+['\"]\.\/pages\/{imp}['\"].*\n", "", app_content)
                        # Remove route lines referencing this component
                        app_content = _re.sub(rf"<Route[^>]*component\s*=\s*{{?{imp}}}?[^/]*/?>\s*\n?", "", app_content)
                    with open(app_jsx, "w") as f:
                        f.write(app_content)
                    print(f"[SANDBOX_MCP] Auto-fixed App.jsx: removed {len(missing)} broken imports")
                else:
                    print(f"[SANDBOX_MCP] Import validation OK: {len(import_matches)} imports match {len(actual_files)} files")
            except Exception as e:
                print(f"[SANDBOX_MCP] Could not validate App.jsx imports: {e}")

        buf = io.BytesIO()
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
        archive_b64 = base64.b64encode(buf.getvalue()).decode()
        print(f"[SANDBOX_MCP] Archive ready | size={len(archive_b64)} chars | files={len([f for _, _, files in os.walk(workspace_dir) for f in files])} total")
        deploy_start = time.time()
        try:
            print(f"[SANDBOX_MCP] Calling MCP execute_workspace_archive (timeout=600s)...")
            result = await self._call_tool("execute_workspace_archive", {
                "session_id": session_id,
                "entrypoint": entrypoint,
                "archive_b64": archive_b64,
            }, timeout=600)
            elapsed = time.time() - deploy_start
            print(f"[SANDBOX_MCP] MCP call completed in {elapsed:.1f}s | raw type={type(result).__name__}")
            parsed = self._parse_response(result)
            status = parsed.get('status', 'unknown') if isinstance(parsed, dict) else 'unknown'
            tunnel = (parsed.get('tunnel_url') or 'none')[:80] if isinstance(parsed, dict) else 'none'
            output = (parsed.get('execution_output') or '')[:300] if isinstance(parsed, dict) else ''
            print(f"[SANDBOX_MCP] Parsed result | status={status} | tunnel={tunnel} | elapsed={elapsed:.1f}s")
            if output:
                print(f"[SANDBOX_MCP] execution_output: {output}")
            if status == 'error':
                print(f"[SANDBOX_MCP] FULL RESPONSE: {json.dumps(parsed, indent=2)[:500]}")
            self._touch(session_id)
            return parsed
        except Exception as e:
            elapsed = time.time() - deploy_start
            print(f"[SANDBOX_MCP] ERROR: deploy failed after {elapsed:.1f}s: {e}")
            logger.error("[sandbox_mcp] deploy_workspace failed: %s", e)
            return {"status": "error", "error": str(e)}

    async def get_sandbox_status(self, session_id: str) -> Dict[str, Any]:
        try:
            result = await self._call_tool("get_sandbox_status", {
                "session_id": session_id,
            })
            self._touch(session_id)
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def delete_sandbox(self, session_id: str) -> Dict[str, Any]:
        try:
            result = await self._call_tool("delete_sandbox", {
                "session_id": session_id,
            })
            self._session_activity.pop(session_id, None)
            self._tunnel_urls.pop(session_id, None)
            # Do NOT delete local workspace — files are needed for re-deploy
            logger.info("[sandbox_mcp] Deleted sandbox '%s'", session_id)
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def list_sandboxes(self) -> Dict[str, Any]:
        try:
            result = await self._call_tool("list_sandboxes", {})
            return self._parse_response(result)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def execute_in_sandbox(
        self, session_id: str, entrypoint: str
    ) -> Dict[str, Any]:
        try:
            result = await self._call_tool("execute_in_sandbox", {
                "session_id": session_id,
                "entrypoint": entrypoint,
            })
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
