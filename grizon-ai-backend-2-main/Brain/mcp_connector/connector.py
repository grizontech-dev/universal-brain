from fastapi import APIRouter, Depends, HTTPException

from Brain.modules.shared.auth import get_current_user
from Brain.services.mcp_service import MCPService, MCPServiceError, get_mcp_service

router = APIRouter(prefix="/mcp", tags=["MCP Bridge"])


@router.post("/{service}/tools")
async def list_tools(
    service: str,
    current_user=Depends(get_current_user),
    mcp_service: MCPService = Depends(get_mcp_service),
):
    try:
        async with mcp_service.get_session(service=service, user_id=current_user.id) as session:
            tools_response = await session.list_tools()
            return {
                "provider": service.lower(),
                "tools": [tool.model_dump() if hasattr(tool, "model_dump") else tool.__dict__ for tool in tools_response.tools],
            }
    except MCPServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
