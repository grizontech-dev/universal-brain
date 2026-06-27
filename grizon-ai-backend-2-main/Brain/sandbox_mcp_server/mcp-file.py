import os
import sys
import io
import time
import base64
import tarfile
import logging
import asyncio
import sys
import shutil

# Ensure Brain module can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import MemorySaver
from dotenv import load_dotenv

load_dotenv()

def _parse_mcp_response(res) -> str:
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
        return "\n".join(parts)
    return str(res)

def _extract_text_from_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts = []
        for item in content:
            if isinstance(item, str):
                text_parts.append(item)
            elif isinstance(item, dict):
                if "text" in item:
                    text_parts.append(item["text"])
                elif item.get("type") == "text" and "content" in item:
                    text_parts.append(item["content"])
        result = "\n".join(text_parts)
        return result if result.strip() else "[Agent produced no text output]"
    return str(content)

# Configure logging
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
logger = logging.getLogger("remote_client_simulation")

# Connect to the Sandbox MCP server via the network interface IP
SANDBOX_MCP_URL = "https://offered-england-lying-bidder.trycloudflare.com/mcp"
SANDBOX_MCP_TOKEN = "2c247188e230a91afb9d5700c0d768a6734e948e4eadad41b9a8b733ef3a75af"

mcp_client = MultiServerMCPClient({
    "sandbox": {
        "transport": "streamable_http",
        "url": SANDBOX_MCP_URL,
        "headers": {"Authorization": f"Bearer {SANDBOX_MCP_TOKEN}"},
        "sse_read_timeout": 360,
    }
})

remote_tools = {}

async def load_remote_tools():
    tools = await mcp_client.get_tools()
    for t in tools:
        remote_tools[t.name] = t
    logger.info(f"✅ Loaded {len(remote_tools)} tools from remote Sandbox MCP server at {SANDBOX_MCP_URL}")

# Client-side local file writer tool
@tool
async def client_save_code(filename: str, code: str, config: RunnableConfig) -> str:
    """Saves a single file to the local workspace on the client machine."""
    session_id = config.get("configurable", {}).get("thread_id", "default")
    workspace_dir = os.path.abspath(os.path.join(os.getcwd(), "client_workspace", session_id))
    target_path = os.path.abspath(os.path.join(workspace_dir, filename))
    
    if not target_path.startswith(workspace_dir):
        return "ERROR: Security violation. Path goes outside workspace."
        
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    with open(target_path, "w") as f:
        f.write(code)
    logger.info(f"[local_save] Saved '{filename}' to client workspace.")
    return f"Success: Saved {filename} to local workspace."

# Client-side executor tool that packages files and uploads them in a single Base64 archive call
@tool
async def client_execute_in_sandbox(filename: str, config: RunnableConfig) -> str:
    """Packages the local project folder, uploads the Base64 archive to the remote sandbox server, and executes the entrypoint script."""
    session_id = config.get("configurable", {}).get("thread_id", "default")
    workspace_dir = os.path.abspath(os.path.join(os.getcwd(), "client_workspace", session_id))
    
    if not os.path.exists(workspace_dir):
        return f"ERROR: Local workspace directory {workspace_dir} does not exist."

    # 1. Package local workspace to in-memory tar.gz
    logger.info(f"[client_execute] Packaging local workspace '{workspace_dir}'...")
    memory_tar = io.BytesIO()
    with tarfile.open(fileobj=memory_tar, mode="w:gz") as tar:
        tar.add(workspace_dir, arcname=".")
    archive_b64 = base64.b64encode(memory_tar.getvalue()).decode('utf-8')

    # 2. Invoke the remote tool
    mcp_tool = remote_tools.get("execute_workspace_archive")
    if not mcp_tool:
        return "ERROR: execute_workspace_archive MCP tool is not loaded from remote server."

    try:
        logger.info(f"[client_execute] Uploading base64 archive and starting sandbox for session '{session_id}'...")
        res = await mcp_tool.ainvoke({
            "session_id": session_id,
            "entrypoint": filename,
            "archive_b64": archive_b64
        })
        
        res_str = _parse_mcp_response(res)
        
        # Parse output JSON to pretty print
        import json
        try:
            data = json.loads(res_str)
            status = data.get("status")
            execution_output = data.get("execution_output", "")
            tunnel_url = data.get("tunnel_url")
            
            result_str = f"Execution Status: {status}\nOutput:\n{execution_output}"
            if tunnel_url:
                result_str += f"\n\n🌐 Remote Tunnel URL: {tunnel_url}"
            return result_str
        except Exception:
            return res_str
    except Exception as e:
        logger.error(f"[client_execute] Call failed: {e}")
        return f"ERROR: Remote execution call failed: {e}"

# Build LangGraph Agent configs
from Brain.services.provider_router import ProviderRouter
llm = ProviderRouter.get_model(os.getenv("DEFAULT_CHEAP_MODEL", "gpt-4o-mini"), temperature=0.3)
memory = MemorySaver()

from langgraph.prebuilt import create_react_agent

frontend_prompt = (
    "You are the Frontend Agent for Grizon Brain. Stack: react in `frontend/` (Vite + React template exists).\n"
    "You build production-quality, connected UIs that appear correctly in the live preview.\n\n"
    "FRONTEND AGENT RULES:\n"
    "1. **CRITICAL — Vite entry**: `frontend/src/main.jsx` imports `./App.jsx` ONLY. `App.tsx` is NEVER used in preview. All routes and component imports go in `frontend/src/App.jsx`.\n"
    "2. **App.jsx is the product** — You MUST include `frontend/src/App.jsx` in every response that adds or changes components. Import and render every component you create.\n"
    "3. **react-router-dom & Connection** — ALWAYS connect all components, pages, and everything in `App.jsx` using `react-router-dom` if multiple pages.\n"
    "4. **API integration** — Use `frontend/src/lib/api.js` for all backend calls.\n"
    "5. **MCP SANDBOX REQUIREMENT (ABSOLUTE)**: You MUST use the client_save_code tool for EVERY file.\n"
    "6. You MUST use client_execute_in_sandbox to run code. ALL web servers MUST run on port 9999 and bind to 0.0.0.0. For Vite, use --port 9999 --host 0.0.0.0.\n"
    "7. After saving files, ALWAYS call client_execute_in_sandbox with the main server entry file as the final step.\n"
    "8. If the client_execute_in_sandbox tool returns a Tunnel URL, you MUST explicitly include this exact Tunnel URL in your final response."
)

backend_prompt = (
    "You are the Backend Agent for Grizon Brain. Express API in `backend/`.\n\n"
    "BACKEND AGENT RULES:\n"
    "1. **Always update `backend/server.js`** when you add or change any route — import and `app.use('/api/...', routes)`.\n"
    "2. **Structure**: `backend/routes/*.js`, `backend/controllers/*.js`, use Express.Router in routes.\n"
    "3. **Supabase**: controllers import `{ supabase }` from `../supabase/client.js`; handle missing env gracefully.\n"
    "4. **Frontend contract**: paths must match what frontend calls via `/api/...`.\n"
    "5. **package.json**: add express, cors, @supabase/supabase-js, etc. in dependencies when needed.\n"
    "6. **MCP SANDBOX REQUIREMENT (ABSOLUTE)**: You MUST use the client_save_code tool for EVERY file.\n"
    "7. You MUST use client_execute_in_sandbox to run code. ALL web servers MUST run on port 9999 and bind to 0.0.0.0.\n"
    "8. After saving files, ALWAYS call client_execute_in_sandbox with the main server entry file as the final step.\n"
    "9. If the client_execute_in_sandbox tool returns a Tunnel URL, you MUST explicitly include this exact Tunnel URL in your final response."
)

frontend_agent = create_react_agent(llm, tools=[client_save_code, client_execute_in_sandbox], prompt=frontend_prompt, checkpointer=memory)
backend_agent = create_react_agent(llm, tools=[client_save_code, client_execute_in_sandbox], prompt=backend_prompt, checkpointer=memory)

@tool
async def delegate_to_frontend(instruction: str) -> str:
    """Delegate frontend web development tasks to the Frontend Agent."""
    logger.info(f"Delegating to frontend agent: {instruction[:50]}...")
    config = RunnableConfig(configurable={"thread_id": "frontend-thread"}, recursion_limit=100)
    res = await frontend_agent.ainvoke({"messages": [("user", instruction)]}, config=config)
    return res["messages"][-1].content

@tool
async def delegate_to_backend(instruction: str) -> str:
    """Delegate backend API and server tasks to the Backend Agent."""
    logger.info(f"Delegating to backend agent: {instruction[:50]}...")
    config = RunnableConfig(configurable={"thread_id": "backend-thread"}, recursion_limit=100)
    res = await backend_agent.ainvoke({"messages": [("user", instruction)]}, config=config)
    return res["messages"][-1].content

orchestrator_prompt = (
    "You are the Universal Brain Orchestrator for Grizon AI.\n\n"
    "DELEGATION RULES (STRICT):\n"
    "1. You MUST delegate ALL work. Never write code yourself.\n"
    "2. Frontend tasks -> delegate_to_frontend.\n"
    "3. Backend tasks -> delegate_to_backend.\n"
    "4. Always run code in the sandbox (via the subagents) before giving final results.\n"
    "5. After everything is done, give a clear summary to the user.\n"
    "6. If a subagent returns a Tunnel URL in its response, you MUST explicitly include that exact Tunnel URL in your final summary."
)

remote_orchestrator = create_react_agent(
    model=llm,
    tools=[delegate_to_frontend, delegate_to_backend],
    checkpointer=memory,
    prompt=orchestrator_prompt
)

from langchain_core.runnables import RunnableConfig

async def run_remote_orchestration_test():
    await load_remote_tools()
    
    session_id = "remote-simulation-session-02"
    prompt = (
        "Create a modern React JS portfolio web application using Tailwind CSS. "
        "It should contain sections for about, projects, and contact. "
        "Use Vite to set up the React project in the 'frontend' folder. "
        "Then run npm install and npm run dev (ensure it runs on port 9999 and binds to 0.0.0.0) in the sandbox."
    )
    
    # Ensure any previous sandbox is cleaned up
    mcp_tool = remote_tools.get("delete_sandbox")
    if mcp_tool:
        logger.info(f"Cleaning up old sandbox session '{session_id}'...")
        await mcp_tool.ainvoke({"session_id": session_id})
        
    logger.info(f"Starting remote simulation test for session: {session_id}")
    logger.info("Sending prompt to remote orchestrator...")
    
    config = RunnableConfig(configurable={"thread_id": session_id}, recursion_limit=100)
    response = await remote_orchestrator.ainvoke({"messages": [("user", prompt)]}, config=config)
    
    content = response["messages"][-1].content
    output = _extract_text_from_content(content)
    
    print("\n" + "="*50)
    print("FINAL REMOTE AGENT RESULT SUMMARY")
    print("="*50)
    print(output)
    print("="*50 + "\n")
    
    # Clean up local workspace folder
    shutil.rmtree(os.path.abspath(os.path.join(os.getcwd(), "client_workspace", session_id)), ignore_errors=True)

if __name__ == "__main__":
    asyncio.run(run_remote_orchestration_test())
