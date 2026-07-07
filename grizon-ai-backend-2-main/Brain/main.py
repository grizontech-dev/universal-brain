import os
import sys
from dotenv import load_dotenv
from contextlib import asynccontextmanager

# Load environment variables from .env file
load_dotenv()

# Add the current directory to sys.path so we can import 'Brain'
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

import uvicorn
from fastapi import FastAPI
from contextlib import asynccontextmanager


from fastapi.middleware.cors import CORSMiddleware
from Brain.modules.chat.controller import router as brain_chat_router
from Brain.modules.conversations.controller import brain_conversations_router
from Brain.memory.debug import router as brain_memory_router
from Brain.modules.connectors.supabase.controller import router as supabase_connector_router
from Brain.modules.connectors.github.controller import router as github_connector_router
from Brain.modules.projects.controller import router as brain_projects_router
from Brain.modules.projects.decisions import router as brain_decisions_router
from Brain.modules.projects.execution import router as brain_execution_router
from Brain.modules.projects.artifacts import router as brain_artifacts_router
from Brain.modules.supabase_proxy.controller import router as supabase_proxy_router
from Brain.modules.supabase_proxy.service import proxy_client
try:
    from Brain.modules.sandbox.controller import router as brain_sandbox_router
except ModuleNotFoundError:
    print("WARNING: sandbox module not found, sandbox routes disabled")
    brain_sandbox_router = None

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: start sandbox cleanup loop
    from Brain.services.sandbox_mcp_service import get_sandbox_mcp_service
    try:
        sandbox_mcp = get_sandbox_mcp_service()
        await sandbox_mcp.initialize()
        sandbox_mcp.start_background_cleanup()
        print("[STARTUP] Sandbox cleanup loop started (TTL=30min)")
    except Exception as e:
        print(f"[STARTUP] Sandbox cleanup not started: {e}")

    # Startup: Supabase proxy
    await proxy_client.init_client()
    await proxy_client.start_housekeeping()
    try:
        yield
    finally:
        await proxy_client.close_client()

app = FastAPI(title="Grizon AI: Project Brain Backend", version="2.5.2", lifespan=lifespan)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    print(f"Validation error for {request.url}")
    print(f"Error details: {exc.errors()}")
    print(f"Request body: {exc.body}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body},
    )

print("Grizon Brain Backend v2.5.2 starting up...")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(brain_chat_router)
app.include_router(brain_conversations_router)
app.include_router(brain_projects_router)
app.include_router(brain_decisions_router)
app.include_router(brain_execution_router)
app.include_router(brain_artifacts_router)
app.include_router(brain_memory_router)
app.include_router(supabase_connector_router)
app.include_router(github_connector_router)
app.include_router(supabase_proxy_router)
if brain_sandbox_router:
    app.include_router(brain_sandbox_router)

from fastapi import Request as FastAPIRequest
from Brain.services.workspace_manager import workspace_manager

@app.post("/brain/sandbox/write-file")
async def brain_write_file(request: FastAPIRequest, workspace_id: str = ""):
    body = await request.json()
    path = body.get("path", "")
    content = body.get("content", "")
    if not path:
        return {"error": "path required"}
    ws_path = workspace_manager.resolve_workspace_path(workspace_id)
    if not ws_path:
        return {"error": "Workspace not found"}
    import os
    host_path = os.path.join(ws_path, path.lstrip("/"))
    os.makedirs(os.path.dirname(host_path), exist_ok=True)
    with open(host_path, "w", encoding="utf-8") as f:
        f.write(content)
    return {"success": True, "path": path}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "project-brain"}

if __name__ == "__main__":
    uvicorn.run("Brain.main:app", host="127.0.0.1", port=8002, reload=True)
