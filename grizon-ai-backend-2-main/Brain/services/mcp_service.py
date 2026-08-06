import os
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from mcp import ClientSession
from mcp.client.sse import sse_client
from Brain.config.database import SessionLocal
from Brain.modules.connectors.supabase.service import Connector as SupabaseConnector, decrypt_token as decrypt_supabase_token
from Brain.modules.connectors.github.service import GitHubConnectorService

logger = logging.getLogger(__name__)

class MCPServiceError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.status_code = status_code

class MCPService:
    def __init__(self):
        self.gcp_mcp_base_url = os.getenv("GCP_MCP_BASE_URL", "http://34.131.51.97")
        self.github_service = GitHubConnectorService()

    @asynccontextmanager
    async def get_session(self, service: str, user_id: str) -> AsyncGenerator[ClientSession, None]:
        service_name = service.lower().strip()
        headers = {}

        if service_name == "github":
            github_connector = self.github_service.get_connection(user_id)
            if not github_connector or not github_connector.config:
                raise MCPServiceError("GitHub connector not connected for this user.", status_code=400)
            
            encrypted_token = github_connector.config.get("access_token")
            if not encrypted_token:
                raise MCPServiceError("GitHub token not found in connection config.", status_code=400)
            
            try:
                decrypted_token = self.github_service.decrypt_token(encrypted_token)
            except Exception as e:
                logger.error(f"Failed to decrypt GitHub token: {e}")
                raise MCPServiceError("Failed to decrypt GitHub connection credentials.", status_code=500)

            headers = {"GitHub-Token": decrypted_token}
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

            if not connector or not connector.config:
                raise MCPServiceError("Supabase connector not connected for this user.", status_code=400)

            config = connector.config
            url_val = config.get("url")
            if not url_val:
                raise MCPServiceError("Supabase URL not configured.", status_code=400)
            
            project_ref = None
            if ".supabase.co" in url_val:
                project_ref = url_val.split("https://")[-1].split(".supabase.co")[0]
            else:
                project_ref = url_val

            supabase_token = None
            encrypted_token = config.get("access_token")
            if encrypted_token:
                try:
                    supabase_token = decrypt_supabase_token(encrypted_token)
                except Exception:
                    supabase_token = encrypted_token
            else:
                supabase_token = config.get("service_role_key") or config.get("anon_key")

            if not supabase_token:
                raise MCPServiceError("Supabase token / key not found.", status_code=400)

            headers = {
                "Supabase-Token": supabase_token,
                "Supabase-Project": project_ref
            }
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
