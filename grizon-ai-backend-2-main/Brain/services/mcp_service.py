import os
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from mcp import ClientSession
from mcp.client.sse import sse_client
from Brain.config.database import SessionLocal
from Brain.modules.connectors.supabase.service import (
    Connector as SupabaseConnector,
    SupabaseOAuthService,
    decrypt_token as decrypt_supabase_token,
)
from Brain.modules.connectors.github.service import GitHubConnectorService

logger = logging.getLogger(__name__)

class MCPServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code

class MCPService:
    def __init__(self):
        self.gcp_mcp_base_url = os.getenv("GCP_MCP_BASE_URL")
        self.github_service = GitHubConnectorService()
        self.supabase_oauth_service = SupabaseOAuthService()

    @asynccontextmanager
    async def get_session(self, service: str, user_id: str) -> AsyncGenerator[ClientSession, None]:
        service_name = service.lower().strip()
        headers = {}

        if service_name == "github":
            github_connector = self.github_service.get_connection(user_id)
            if not github_connector or not github_connector.config:
                raise MCPServiceError("GitHub connector not connected for this user.", status_code=400)

            config = github_connector.config or {}
            github_token = config.get("access_token") or config.get("github_token")
            installation_id = config.get("installation_id")

            if github_token:
                token_value = github_token
            elif installation_id:
                token_value = await self.github_service.get_installation_token(installation_id)
            else:
                raise MCPServiceError("GitHub credentials not found in connector config.", status_code=400)

            headers = {"GitHub-Token": token_value}
            url = f"{self.gcp_mcp_base_url}/sse/github"

        elif service_name == "supabase":
            db = SessionLocal()
            try:
                connector = db.query(SupabaseConnector).filter(
                    SupabaseConnector.userId == user_id,
                    SupabaseConnector.type == "supabase"
                ).first()
            finally:
                db.close()

            if connector and connector.config:
                config = connector.config
                url_val = config.get("url")
                try:
                    supabase_token = await self.supabase_oauth_service.get_valid_access_token(user_id)
                except Exception:
                    supabase_token = None

                if not supabase_token:
                    encrypted_token = config.get("access_token")
                    if encrypted_token:
                        try:
                            supabase_token = decrypt_supabase_token(encrypted_token)
                        except Exception:
                            supabase_token = encrypted_token
                    else:
                        supabase_token = config.get("service_role_key") or config.get("anon_key")

                if not url_val and supabase_token:
                    import httpx
                    async def fetch_proj():
                        async with httpx.AsyncClient(timeout=10) as client:
                            resp = await client.get('https://api.supabase.com/v1/projects', headers={'Authorization': f'Bearer {supabase_token}'})
                            if resp.status_code == 200:
                                projs = resp.json()
                                if projs:
                                    return f"https://{projs[0]['ref']}.supabase.co"
                        return None
                    try:
                        pref = await fetch_proj()
                        if pref:
                            url_val = pref
                    except Exception:
                        pass

                if not url_val:
                    raise MCPServiceError("Supabase URL not configured for this user connector.", status_code=400)

                project_ref = url_val.split("https://")[-1].split(".supabase.co")[0] if ".supabase.co" in url_val else url_val
                headers = {"Supabase-Token": supabase_token, "Supabase-Project": project_ref}
            else:
                company_url = (os.getenv("COMPANY_SUPABASE_URL") or os.getenv("SUPABASE_URL") or "").rstrip("/")
                company_key = (
                    os.getenv("COMPANY_SUPABASE_SERVICE_ROLE_KEY")
                    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
                    or os.getenv("SUPABASE_ANON_KEY")
                    or ""
                )
                if not company_url or not company_key:
                    raise MCPServiceError("Supabase connector not connected for this user and no company Supabase credentials are configured.", status_code=400)

                project_ref = company_url.split("https://")[-1].split(".supabase.co")[0] if ".supabase.co" in company_url else company_url
                headers = {"Supabase-Token": company_key, "Supabase-Project": project_ref}

            url = f"{self.gcp_mcp_base_url}/sse/supabase"

        else:
            raise MCPServiceError(f"Unsupported MCP service: {service_name}", status_code=400)

        logger.info(f"Connecting to MCP server at {url}...")
        try:
            async with sse_client(url, headers=headers) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    yield session
        except Exception as e:
            logger.error(f"Failed to connect to MCP server for {service_name}: {e}")
            raise MCPServiceError(f"Failed to communicate with {service_name} MCP server: {str(e)}", status_code=502)

_mcp_service = None

def get_mcp_service() -> MCPService:
    global _mcp_service
    if _mcp_service is None:
        _mcp_service = MCPService()
    return _mcp_service
