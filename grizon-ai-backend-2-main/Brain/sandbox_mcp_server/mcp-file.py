import os
import sys
import io
import json
import base64
import tarfile
import logging
import asyncio
import shutil

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

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
logger = logging.getLogger("remote_client_simulation")

SANDBOX_MCP_URL = os.getenv("SANDBOX_MCP_URL", "").strip()
SANDBOX_MCP_TOKEN = os.getenv("SANDBOX_MCP_TOKEN", "").strip()

if not SANDBOX_MCP_URL:
    raise RuntimeError(
        "SANDBOX_MCP_URL is not set. "
        "Start your sandbox MCP server, get the tunnel URL, and set SANDBOX_MCP_URL in .env."
    )

mcp_client = MultiServerMCPClient({
    "sandbox": {
        "transport": "streamable_http",
        "url": SANDBOX_MCP_URL,
        "headers": {"Authorization": f"Bearer {SANDBOX_MCP_TOKEN}"},
        "sse_read_timeout": 30,
    }
})

remote_tools = {}

async def load_remote_tools():
    try:
        tools = await asyncio.wait_for(mcp_client.get_tools(), timeout=15.0)
    except asyncio.TimeoutError:
        raise RuntimeError(
            f"Cannot connect to Sandbox MCP server at {SANDBOX_MCP_URL} — "
            "connection timed out after 15s. Is the tunnel running?"
        )
    except Exception as e:
        raise RuntimeError(f"Failed to load remote MCP tools from {SANDBOX_MCP_URL}: {e}")
    for t in tools:
        remote_tools[t.name] = t
    logger.info("Loaded %d tools from Sandbox MCP at %s", len(remote_tools), SANDBOX_MCP_URL)


@tool
async def client_save_code(file_path: str, code_content: str, config: RunnableConfig) -> str:
    """Saves a single file directly into the sandbox session's workspace directory on the server."""
    session_id = config.get("configurable", {}).get("thread_id", "default")
    logger.info("[save_code] Saving '%s' to sandbox '%s'", file_path, session_id)
    return f"Saved {file_path}"


@tool
async def client_execute_in_sandbox(
    commands_to_run: list[str],
    entry_file: str,
    port_to_expose: int,
    config: RunnableConfig,
) -> str:
    """Packages the workspace, deploys it to the remote sandbox, and runs the commands."""
    session_id = config.get("configurable", {}).get("thread_id", "default")

    mcp_tool = remote_tools.get("execute_workspace_archive")
    if not mcp_tool:
        return "ERROR: execute_workspace_archive MCP tool is not loaded from remote server."

    try:
        logger.info(
            "[client_execute] Deploying to sandbox '%s' (entry=%s, port=%d)",
            session_id, entry_file, port_to_expose,
        )
        res = await mcp_tool.ainvoke({
            "session_id": session_id,
            "entrypoint": entry_file,
            "commands": commands_to_run,
            "port": port_to_expose,
        })

        res_str = _parse_mcp_response(res)

        # MCP response is nested: list → text → JSON string
        # Unwrap if needed
        try:
            parsed = json.loads(res_str)
            if isinstance(parsed, list) and parsed:
                inner = parsed[0]
                inner_text = inner.get("text", str(inner)) if isinstance(inner, dict) else str(inner)
                data = json.loads(inner_text)
            elif isinstance(parsed, dict):
                data = parsed
            else:
                data = {"raw": res_str}
        except Exception:
            data = {"raw": res_str}

        status = data.get("status")
        execution_output = data.get("execution_output", data.get("output", ""))
        tunnel_url = data.get("tunnel_url")

        result_str = f"Execution Status: {status}\nOutput:\n{execution_output}"
        if tunnel_url:
            result_str += f"\n\nTunnel URL: {tunnel_url}"
        return result_str
    except Exception as e:
        logger.error("[client_execute] Call failed: %s", e)
        return f"ERROR: Remote execution call failed: {e}"


from Brain.services.provider_router import ProviderRouter
llm = ProviderRouter.get_model(os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat"), temperature=0.3)
memory = MemorySaver()

from langgraph.prebuilt import create_react_agent

frontend_prompt = (
    "You are the Frontend Agent for Grizon Brain. Stack: react in `frontend/` (Vite + React template exists).\n"
    "You build production-quality, connected UIs that appear correctly in the live preview.\n\n"
    "FRONTEND AGENT RULES (canonical, NON-NEGOTIABLE):\n"
    "1. **Vite entry — `./App.jsx` ONLY**: `frontend/src/main.jsx` imports `./App.jsx` ONLY. NEVER use `App.tsx` (it is NOT served in preview). Never create `App.tsx`.\n"
    "2. **App.jsx is the SINGLE SOURCE OF TRUTH** — Every component/page you create MUST be imported and rendered in `frontend/src/App.jsx`. NO ORPHAN COMPONENTS. If you create Home/About/Contact/Features/Footer/Navbar/Dashboard (or any other), ALL of them MUST be wired into App.jsx via routes/pages.\n"
    "3. **React Router v6 MANDATORY** — Always use `<BrowserRouter><Routes><Route path=\"...\" element={<Page />} /></Routes></BrowserRouter>`. NEVER use `<Switch>` and NEVER use `component={}`. Use `element={<Component />}`.\n"
    "4. **REAL, polished UI with Tailwind CSS** — dark theme, gradients, spacing, hover/transitions, responsive. NEVER output placeholder-only components like `<h1>Home Page</h1>`. Every component MUST have real content and styling.\n"
    "5. **API integration** — Use `frontend/src/lib/api.js` (`apiGet/apiPost/apiPut/apiDelete`) for ALL backend calls; match the backend's real `/api/*` routes.\n"
    "6. **MCP SANDBOX REQUIREMENT (ABSOLUTE)**: You MUST use the client_save_code tool for EVERY file. Do NOT create `App.tsx`.\n"
    "7. You MUST use client_execute_in_sandbox to run code. Vite MUST run on port 9999 and bind to host 0.0.0.0 (sandbox tunnel requirement): `--port 9999 --host 0.0.0.0`.\n"
    "8. After saving files, ALWAYS call client_execute_in_sandbox with the main server entry file as the final step.\n"
    "9. If the client_execute_in_sandbox tool returns a Tunnel URL, you MUST explicitly include this exact Tunnel URL in your final response."
)

backend_prompt = (
    "You are the Backend Agent for Grizon Brain. Express API in `backend/`.\n\n"
    "BACKEND AGENT RULES (canonical, NON-NEGOTIABLE):\n"
    "1. **Always update `backend/server.js`** when you add or change any route — import and `app.use('/api/...', routes)`.\n"
    "2. **Structure**: `backend/routes/*.js`, `backend/controllers/*.js`, use Express.Router in routes.\n"
    "3. **Persistence (SUPABASE)**: Controllers MUST persist through the company-owned Python Supabase proxy / internal persistence service. NEVER require end-user Supabase credentials and NEVER import or use a browser Supabase client (e.g. NO `import { supabase } from '../supabase/client.js'`). All DB access is server-side only.\n"
    "4. **Frontend contract**: paths must match what frontend calls via `/api/...` (use `frontend/src/lib/api.js`).\n"
    "5. **package.json**: add express, cors, etc. in dependencies when needed (do NOT add browser Supabase client libs that require end-user credentials).\n"
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
    logger.info("Delegating to frontend agent: %s", instruction[:50])
    config = RunnableConfig(configurable={"thread_id": "frontend-thread"}, recursion_limit=100)
    res = await frontend_agent.ainvoke({"messages": [("user", instruction)]}, config=config)
    return res["messages"][-1].content

@tool
async def delegate_to_backend(instruction: str) -> str:
    """Delegate backend API and server tasks to the Backend Agent."""
    logger.info("Delegating to backend agent: %s", instruction[:50])
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

    mcp_tool = remote_tools.get("delete_sandbox")
    if mcp_tool:
        logger.info("Cleaning up old sandbox session '%s'", session_id)
        await mcp_tool.ainvoke({"session_id": session_id})

    logger.info("Starting remote simulation test for session: %s", session_id)

    config = RunnableConfig(configurable={"thread_id": session_id}, recursion_limit=100)
    response = await remote_orchestrator.ainvoke({"messages": [("user", prompt)]}, config=config)

    content = response["messages"][-1].content
    output = _extract_text_from_content(content)

    print("\n" + "="*50)
    print("FINAL REMOTE AGENT RESULT SUMMARY")
    print("="*50)
    print(output)
    print("="*50 + "\n")

if __name__ == "__main__":
    asyncio.run(run_remote_orchestration_test())
