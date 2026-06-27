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
        if not url or not token:
            raise RuntimeError(
                "SANDBOX_MCP_URL and SANDBOX_MCP_TOKEN must be set in environment"
            )
        self._client = MultiServerMCPClient({
            "sandbox": {
                "transport": "streamable_http",
                "url": url,
                "headers": {"Authorization": f"Bearer {token}"},
                "sse_read_timeout": 360,
            }
        })
        tools = await self._client.get_tools()
        self._tools = {t.name: t for t in tools}
        self._initialized = True
        logger.info("Loaded %d tools from sandbox MCP server", len(self._tools))

    async def ensure_tool(self, name: str):
        if name not in self._tools:
            raise RuntimeError(f"MCP tool '{name}' not available from sandbox server")

    def get_workspace_dir(self, session_id: str) -> str:
        if not self._workspace_root:
            self._workspace_root = os.path.abspath(
                os.path.join(os.getcwd(), "client_workspace")
            )
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
        if not os.path.isdir(workspace_dir):
            return {"status": "error", "error": f"Workspace {session_id} not found"}
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(workspace_dir, arcname=".")
        archive_b64 = base64.b64encode(buf.getvalue()).decode()
        await self.ensure_tool("execute_workspace_archive")
        tool = self._tools["execute_workspace_archive"]
        try:
            logger.info(
                "[sandbox_mcp] Deploying workspace '%s' (entrypoint=%s, %d bytes)",
                session_id, entrypoint, len(archive_b64),
            )
            res = await tool.ainvoke({
                "session_id": session_id,
                "entrypoint": entrypoint,
                "archive_b64": archive_b64,
            })
            self._touch(session_id)
            return self._parse_response(res)
        except Exception as e:
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
        if isinstance(res, list):
            parts = []
            for item in res:
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
        else:
            text = str(res)
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
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
