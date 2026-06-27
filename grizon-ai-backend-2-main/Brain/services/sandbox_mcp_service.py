import os
import io
import json
import time
import base64
import tarfile
import logging
import asyncio
from typing import Any, Dict, List, Optional

from langchain_mcp_adapters.client import MultiServerMCPClient
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("sandbox_mcp")

RUNTIME_SANDBOX_MCP = "sandbox_mcp"


class SandboxMCPService:
    def __init__(self):
        self._client: Optional[MultiServerMCPClient] = None
        self._tools: Dict[str, Any] = {}
        self._session_activity: Dict[str, float] = {}
        self.TTL_MINUTES = 30
        self._workspace_root: Optional[str] = None
        self._cleanup_task: Optional[asyncio.Task] = None
        self._initialized = False

    async def initialize(self):
        if self._initialized:
            return
        url = os.getenv("SANDBOX_MCP_URL")
        token = os.getenv("SANDBOX_MCP_TOKEN")
        print(f"[SANDBOX_MCP] Initializing... URL={url[:50] if url else 'MISSING'}...")
        if not url or not token:
            print("[SANDBOX_MCP] ERROR: SANDBOX_MCP_URL or SANDBOX_MCP_TOKEN not set!")
            raise RuntimeError(
                "SANDBOX_MCP_URL and SANDBOX_MCP_TOKEN must be set in environment"
            )
        self._client = MultiServerMCPClient({
            "sandbox": {
                "transport": "streamable_http",
                "url": url,
                "headers": {"Authorization": f"Bearer {token}"},
                "sse_read_timeout": 30,
            }
        })
        tools = await self._client.get_tools()
        self._tools = {t.name: t for t in tools}
        self._initialized = True
        print(f"[SANDBOX_MCP] Initialized OK | tools={list(self._tools.keys())}")
        logger.info("Loaded %d tools from sandbox MCP server", len(self._tools))

    async def ensure_tool(self, name: str):
        if name not in self._tools:
            raise RuntimeError(f"MCP tool '{name}' not available from sandbox server")

    def get_workspace_dir(self, session_id: str) -> str:
        if not self._workspace_root:
            # Use SAME path as WorkspaceManager so agent files are visible here
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
        await self.ensure_tool("save_code")
        try:
            logger.info(
                "[sandbox_mcp] Saving '%s' directly to sandbox '%s' (%d bytes)",
                filename, session_id, len(code),
            )
            res = await self._tools["save_code"].ainvoke({
                "session_id": session_id,
                "filename": filename,
                "code": code,
            })
            self._touch(session_id)
            return self._parse_response(res)
        except Exception as e:
            logger.error("[sandbox_mcp] save_code_to_sandbox failed: %s", e)
            return {"status": "error", "error": str(e)}

    async def deploy_workspace(
        self, session_id: str, entrypoint: str
    ) -> Dict[str, Any]:
        workspace_dir = self.get_workspace_dir(session_id)
        files = os.listdir(workspace_dir) if os.path.isdir(workspace_dir) else []
        print(f"[SANDBOX_MCP] deploy_workspace | session={session_id} | entrypoint={entrypoint} | files={files}")
        if not os.path.isdir(workspace_dir):
            print(f"[SANDBOX_MCP] ERROR: workspace dir not found: {workspace_dir}")
            return {"status": "error", "error": f"Workspace {session_id} not found"}
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(workspace_dir, arcname=".")
        archive_b64 = base64.b64encode(buf.getvalue()).decode()
        print(f"[SANDBOX_MCP] Archive ready | size={len(archive_b64)} chars")
        await self.ensure_tool("execute_workspace_archive")
        tool = self._tools["execute_workspace_archive"]
        try:
            print(f"[SANDBOX_MCP] Calling MCP execute_workspace_archive...")
            res = await tool.ainvoke({
                "session_id": session_id,
                "entrypoint": entrypoint,
                "archive_b64": archive_b64,
            })
            print(f"[SANDBOX_MCP] MCP raw response type={type(res).__name__}")
            if isinstance(res, list):
                for i, item in enumerate(res):
                    print(f"[SANDBOX_MCP]   item[{i}] type={type(item).__name__} | val={str(item)[:200]}")
            else:
                print(f"[SANDBOX_MCP]   raw={str(res)[:300]}")
            parsed = self._parse_response(res)
            status = parsed.get('status', 'unknown') if isinstance(parsed, dict) else 'unknown'
            tunnel = (parsed.get('tunnel_url') or 'none')[:60] if isinstance(parsed, dict) else 'none'
            output = (parsed.get('execution_output') or '')[:300] if isinstance(parsed, dict) else ''
            print(f"[SANDBOX_MCP] Parsed result | status={status} | tunnel={tunnel}")
            if output:
                print(f"[SANDBOX_MCP] execution_output: {output}")
            if status == 'error':
                print(f"[SANDBOX_MCP] FULL RESPONSE: {json.dumps(parsed, indent=2)[:500]}")
            self._touch(session_id)
            return parsed
        except Exception as e:
            print(f"[SANDBOX_MCP] ERROR: deploy failed: {e}")
            logger.error("[sandbox_mcp] deploy_workspace failed: %s", e)
            return {"status": "error", "error": str(e)}

    async def get_sandbox_status(self, session_id: str) -> Dict[str, Any]:
        await self.ensure_tool("get_sandbox_status")
        try:
            res = await self._tools["get_sandbox_status"].ainvoke({
                "session_id": session_id
            })
            self._touch(session_id)
            return self._parse_response(res)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def delete_sandbox(self, session_id: str) -> Dict[str, Any]:
        await self.ensure_tool("delete_sandbox")
        try:
            res = await self._tools["delete_sandbox"].ainvoke({
                "session_id": session_id
            })
            self._session_activity.pop(session_id, None)
            logger.info("[sandbox_mcp] Deleted sandbox '%s'", session_id)
            return self._parse_response(res)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def list_sandboxes(self) -> Dict[str, Any]:
        await self.ensure_tool("list_sandbox")
        try:
            res = await self._tools["list_sandbox"].ainvoke({})
            return self._parse_response(res)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def execute_in_sandbox(
        self, session_id: str, entrypoint: str
    ) -> Dict[str, Any]:
        await self.ensure_tool("execute_in_sandbox")
        try:
            res = await self._tools["execute_in_sandbox"].ainvoke({
                "session_id": session_id,
                "entrypoint": entrypoint,
            })
            self._touch(session_id)
            return self._parse_response(res)
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def _touch(self, session_id: str):
        self._session_activity[session_id] = time.time()

    def _parse_response(self, res) -> Dict[str, Any]:
        print(f"[SANDBOX_MCP] _parse_response input type={type(res).__name__}")
        if isinstance(res, list):
            parts = []
            for i, item in enumerate(res):
                print(f"[SANDBOX_MCP]   parsing item[{i}] type={type(item).__name__}")
                if item is None:
                    print(f"[SANDBOX_MCP]   item[{i}] is None, skipping")
                    continue
                if hasattr(item, "text") and item.text:
                    parts.append(item.text)
                elif isinstance(item, dict) and "text" in item:
                    parts.append(item["text"])
                elif hasattr(item, "content") and item.content:
                    parts.append(str(item.content))
                elif isinstance(item, dict) and "content" in item:
                    parts.append(str(item["content"]))
                else:
                    parts.append(str(item))
            text = "\n".join(parts)
            print(f"[SANDBOX_MCP]   joined text ({len(text)} chars): {text[:200]}")
        else:
            text = str(res)
        try:
            parsed = json.loads(text)
            print(f"[SANDBOX_MCP]   json.loads OK | keys={list(parsed.keys()) if isinstance(parsed, dict) else 'not dict'}")
            return parsed
        except (json.JSONDecodeError, TypeError) as e:
            print(f"[SANDBOX_MCP]   json.loads FAILED: {e} | text={text[:200]}")
            return {"raw": text}

    async def cleanup_expired(self):
        now = time.time()
        expired = [
            sid
            for sid, last_activity in list(self._session_activity.items())
            if now - last_activity > self.TTL_MINUTES * 60
        ]
        for sid in expired:
            try:
                await self.delete_sandbox(sid)
                logger.info("Cleaned up expired sandbox: %s", sid)
            except Exception as e:
                logger.error("Failed to clean up sandbox %s: %s", sid, e)

    async def background_cleanup_loop(self):
        while True:
            await asyncio.sleep(60)
            await self.cleanup_expired()

    def start_background_cleanup(self):
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self.background_cleanup_loop())

    def record_activity(self, session_id: str):
        if session_id:
            self._touch(session_id)


_sandbox_mcp_instance: Optional[SandboxMCPService] = None


def get_sandbox_mcp_service() -> SandboxMCPService:
    global _sandbox_mcp_instance
    if _sandbox_mcp_instance is None:
        _sandbox_mcp_instance = SandboxMCPService()
    return _sandbox_mcp_instance
