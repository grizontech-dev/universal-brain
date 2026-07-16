import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Optional
from urllib.parse import urlparse
from uuid import UUID

from mcp import ClientSession
from mcp.client.sse import sse_client

from Brain.modules.connectors.github.service import GitHubConnectorService
from Brain.modules.connectors.supabase.service import SupabaseOAuthService

logger = logging.getLogger(__name__)


class MCPServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class MCPService:
    def __init__(
        self,
        github_connector_service: Optional[GitHubConnectorService] = None,
        supabase_connector_service: Optional[SupabaseOAuthService] = None,
        mcp_base_url: Optional[str] = None,
    ):
        self._github_connector_service = github_connector_service
        self._supabase_connector_service = supabase_connector_service
        self._mcp_base_url = (mcp_base_url or os.getenv("GCP_MCP_BASE_URL", "http://34.131.119.144")).rstrip("/")
        self._header_resolvers: Dict[str, Callable[[str], Awaitable[Dict[str, str]]]] = {
            "github": self._resolve_github_headers,
            "supabase": self._resolve_supabase_headers,
        }

    @asynccontextmanager
    async def get_session(self, service: str, user_id: UUID | str) -> AsyncIterator[ClientSession]:
        normalized_service = (service or "").strip().lower()
        if normalized_service not in self._header_resolvers:
            raise MCPServiceError(
                f"Unsupported MCP service '{service}'. Supported services: {', '.join(sorted(self._header_resolvers))}.",
                status_code=422,
            )

        headers = await self._header_resolvers[normalized_service](str(user_id))
        url = f"{self._mcp_base_url}/sse/{normalized_service}"
        logger.info("Opening MCP session for service=%s user_id=%s", normalized_service, user_id)
        try:
            async with sse_client(url, headers=headers) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    yield session
        except MCPServiceError:
            raise
        except Exception as exc:
            logger.exception("Failed to initialize MCP session for service=%s user_id=%s", normalized_service, user_id)
            raise MCPServiceError(
                f"Failed to initialize MCP session for '{normalized_service}': {exc}",
                status_code=502,
            ) from exc

    async def _resolve_github_headers(self, user_id: str) -> Dict[str, str]:
        if self._github_connector_service is None:
            self._github_connector_service = GitHubConnectorService()
        connector = self._github_connector_service.get_connection(user_id)
        if not connector or not connector.config:
            raise MCPServiceError("GitHub connector is not connected for this user.", status_code=404)

        installation_id = connector.config.get("installation_id")
        if not installation_id:
            raise MCPServiceError("GitHub connector is missing installation_id.", status_code=400)

        try:
            installation_token = await self._github_connector_service.get_installation_token(str(installation_id))
        except Exception as exc:
            logger.exception("Failed to generate GitHub installation token for user_id=%s", user_id)
            raise MCPServiceError(f"Unable to generate GitHub installation token: {exc}", status_code=502) from exc

        return {"GitHub-Token": installation_token}

    async def _resolve_supabase_headers(self, user_id: str) -> Dict[str, str]:
        if self._supabase_connector_service is None:
            self._supabase_connector_service = SupabaseOAuthService()
        connector = self._supabase_connector_service.get_connection(user_id)
        if not connector or not connector.config:
            raise MCPServiceError("Supabase connector is not connected for this user.", status_code=404)

        config = connector.config or {}
        project_ref = self._extract_supabase_project_ref(config)
        if not project_ref:
            raise MCPServiceError(
                "Supabase connector is missing project reference. Connect Supabase with OAuth and a project.",
                status_code=400,
            )

        try:
            access_token = await self._supabase_connector_service.get_valid_access_token(user_id)
        except ValueError as exc:
            raise MCPServiceError(str(exc), status_code=400) from exc
        except Exception as exc:
            logger.exception("Failed to resolve valid Supabase access token for user_id=%s", user_id)
            raise MCPServiceError(f"Unable to resolve Supabase access token: {exc}", status_code=502) from exc

        return {
            "Supabase-Token": access_token,
            "Supabase-Project": project_ref,
        }

    def _extract_supabase_project_ref(self, config: Dict[str, Any]) -> Optional[str]:
        project_ref = config.get("project_ref") or config.get("project")
        if isinstance(project_ref, str) and project_ref.strip():
            return project_ref.strip()

        url = config.get("url")
        if not isinstance(url, str) or not url.strip():
            return None

        parsed = urlparse(url.strip())
        hostname = parsed.hostname or ""
        marker = ".supabase.co"
        if marker not in hostname:
            return None
        return hostname.split(marker, 1)[0] or None


_mcp_service: Optional[MCPService] = None


def get_mcp_service() -> MCPService:
    global _mcp_service
    if _mcp_service is None:
        _mcp_service = MCPService()
    return _mcp_service
