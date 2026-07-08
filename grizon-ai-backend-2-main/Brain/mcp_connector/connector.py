import os
from fastapi import APIRouter, Header, HTTPException
from mcp import ClientSession
from mcp.client.sse import sse_client

router = APIRouter(prefix="/mcp", tags=["MCP Bridge"])

GCP_MCP_BASE_URL = os.getenv("GCP_MCP_BASE_URL", "http://34.131.119.144")


@router.post("/github/tools")
async def list_github_tools(github_token: str = Header(None, alias="GitHub-Token")):
    if not github_token:
        raise HTTPException(status_code=400, detail="Missing 'GitHub-Token' header.")

    url = f"{GCP_MCP_BASE_URL}/sse/github"
    headers = {"GitHub-Token": github_token}

    try:
        async with sse_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools_response = await session.list_tools()
                return {
                    "provider": "github",
                    "tools": [tool.model_dump() if hasattr(tool, "model_dump") else tool.__dict__ for tool in tools_response.tools]
                }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to communicate with GitHub MCP Server: {str(e)}")


@router.post("/supabase/tools")
async def list_supabase_tools(
    supabase_token: str = Header(None, alias="Supabase-Token"),
    supabase_project: str = Header(None, alias="Supabase-Project")
):
    if not supabase_token or not supabase_project:
        raise HTTPException(
            status_code=400,
            detail="Missing required headers. Both 'Supabase-Token' and 'Supabase-Project' must be supplied."
        )

    url = f"{GCP_MCP_BASE_URL}/sse/supabase"
    headers = {
        "Supabase-Token": supabase_token,
        "Supabase-Project": supabase_project
    }

    try:
        async with sse_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools_response = await session.list_tools()
                return {
                    "provider": "supabase",
                    "tools": [tool.model_dump() if hasattr(tool, "model_dump") else tool.__dict__ for tool in tools_response.tools]
                }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to communicate with Supabase MCP Server: {str(e)}")
