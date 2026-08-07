import os
import json
import time
import base64
import tarfile
import io
import httpx
from typing import List, Dict, Any
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from Brain.services.workspace_manager import workspace_manager
from Brain.services.websocket_manager import ws_manager
from Brain.services.sandbox_mcp_service import get_sandbox_mcp_service
from Brain.services.mcp_service import MCPServiceError, get_mcp_service

LOG = "[MCP_TOOLS]"

def _make_activity(act_type: str, label: str, path: str = "", task_title: str = "") -> Dict[str, Any]:
    return {
        "id": f"act-{int(time.time() * 1000)}-{act_type}",
        "type": act_type,
        "label": label,
        "path": path or None,
        "taskTitle": task_title or None,
        "status": "done",
        "timestamp": int(time.time() * 1000),
    }

@tool
async def read_skill_file(file_path: str) -> str:
    """Reads a skill/guidance file from Brain/skills/ or Brain/skillss/ directory. Use this to get help when building components."""
    here = os.path.dirname(os.path.abspath(__file__))
    base_dir = os.path.join(here, "..", "..")
    base_dir = os.path.abspath(base_dir)
    
    # Normalize path — handle both relative and absolute
    normalized = file_path.replace("\\", "/").strip("/")
    if normalized.startswith("Brain/"):
        full_path = os.path.join(os.path.dirname(base_dir), normalized)
    else:
        full_path = os.path.join(base_dir, normalized)
    
    if not os.path.isfile(full_path):
        return f"ERROR: Skill file not found: {file_path}"
    
    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Truncate if too long
    max_chars = 3000
    if len(content) > max_chars:
        content = content[:max_chars] + f"\n\n... (truncated, {len(content)} chars total)"
    
    print(f"{LOG} read_skill_file | {file_path} | {len(content)} chars", flush=True)
    return content

@tool
async def client_save_code(code_content: str, config: RunnableConfig, file_path: str = "", code_path: str = "") -> str:
    """Saves a single file directly into the sandbox session's workspace directory on the server."""
    actual_path = file_path or code_path
    session_id = config.get("configurable", {}).get("thread_id")
    task_title = config.get("configurable", {}).get("task_title", "Writing Code")
    user_id = config.get("configurable", {}).get("user_id")
    
    print(f"{LOG} client_save_code | file={actual_path} | size={len(code_content)} chars | session={session_id}", flush=True)

    if not actual_path:
        return "ERROR: file_path is required."

    if not code_content or len(code_content.strip()) == 0:
        print(f"{LOG} ⚠ REJECTED empty content for {actual_path} — LLM must provide code_content", flush=True)
        return f"ERROR: code_content is empty for '{actual_path}'. You MUST provide the actual file content, not an empty string."

    if not session_id:
        print(f"{LOG} ✖ ERROR: No session_id provided", flush=True)
        return "ERROR: session_id (thread_id) not provided in config."

    ws_root = workspace_manager.resolve_workspace_path(str(session_id), user_id=user_id)
    if not ws_root:
        print(f"{LOG} ✖ ERROR: workspace not found for session={session_id}", flush=True)
        return f"ERROR: Could not resolve workspace path for session '{session_id}'."

    # Normalize file_path to be relative to the workspace root
    normalized_path = actual_path
    if normalized_path.startswith('/workspace/'):
        normalized_path = normalized_path[len('/workspace/'):]
    elif normalized_path.startswith('workspace/'):
        normalized_path = normalized_path[len('workspace/'):]
    elif normalized_path.startswith('/'):
        normalized_path = normalized_path[1:]

    # Reject paths that don't belong to the app
    VALID_PREFIXES = ('frontend/', 'backend/', 'database/', 'src/', 'public/', 'server.')
    if not any(normalized_path.startswith(p) for p in VALID_PREFIXES):
        print(f"{LOG} ⚠ REJECTED invalid path: {actual_path} → {normalized_path} (must start with frontend/, backend/, database/)", flush=True)
        return f"ERROR: Invalid file path '{actual_path}'. Files must be saved under frontend/, backend/, or database/ directories."

    abs_path = os.path.abspath(os.path.join(ws_root, normalized_path))
    if not abs_path.startswith(os.path.abspath(ws_root)):
        print(f"{LOG} ✖ ERROR: Invalid file path (path traversal attempt): {actual_path}", flush=True)
        return "ERROR: Invalid file path."

    # Read old content for diff info
    old_content = ""
    is_new_file = not os.path.exists(abs_path)
    if not is_new_file:
        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                old_content = f.read()
        except Exception:
            old_content = ""

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(code_content)

    print(f"{LOG} ✓ Saved: {actual_path} → {abs_path} ({len(code_content)} chars)", flush=True)

    # Compute diff stats
    old_lines = old_content.splitlines() if old_content else []
    new_lines = code_content.splitlines() if code_content else []
    old_set = set(old_lines)
    new_set = set(new_lines)
    lines_added = max(0, len(new_lines) - len([l for l in old_lines if l in new_set]))
    lines_removed = max(0, len(old_lines) - len([l for l in new_lines if l in old_set]))
    action = "Created" if is_new_file else "Edited"

    # Emit WebSocket event
    act = _make_activity("edit_file", f"{action} {actual_path}", path=actual_path, task_title=task_title)
    act["linesAdded"] = lines_added
    act["linesRemoved"] = lines_removed
    act["isNew"] = is_new_file
    progress_msg = json.dumps({
        "type": "file_updated",
        "file": actual_path,
        "timestamp": str(int(time.time() * 1000))
    })
    
    write_op = workspace_manager.build_op_write_file(actual_path, code_content)
    await ws_manager.broadcast_to_sandbox(session_id, {
        "type": "workspace_ops",
        "ops": [write_op],
        "activities": [act],
        "progress_msg": progress_msg
    })

    return f"Successfully saved {actual_path} to local workspace."

def _resolve_entrypoint(ws_root: str, entry_file: str) -> str:
    """Resolve entrypoint to full relative path. If LLM sends 'main.jsx', find 'frontend/src/main.jsx'."""
    if entry_file.startswith('/workspace/'):
        entry_file = entry_file[len('/workspace/'):]
    elif entry_file.startswith('workspace/'):
        entry_file = entry_file[len('workspace/'):]
    elif entry_file.startswith('/'):
        entry_file = entry_file[1:]

    if "/" in entry_file or "\\" in entry_file:
        return entry_file
    for root, dirs, files in os.walk(ws_root):
        for f in files:
            if f == entry_file:
                rel = os.path.relpath(os.path.join(root, f), ws_root)
                print(f"{LOG} Resolved entrypoint '{entry_file}' → '{rel}'", flush=True)
                return rel
    print(f"{LOG} WARNING: entrypoint '{entry_file}' not found, using as-is", flush=True)
    return entry_file


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v) for v in value]
    if hasattr(value, "model_dump"):
        return _to_jsonable(value.model_dump())
    if hasattr(value, "__dict__"):
        return _to_jsonable(vars(value))
    return str(value)


@tool
async def mcp_list_tools(service: str, config: RunnableConfig) -> str:
    """
    List tools from an authenticated MCP provider.
    Supported services: github, supabase.
    """
    configurable = config.get("configurable", {})
    user_id = configurable.get("user_id")
    if not user_id:
        return "ERROR: user_id is required in config.configurable.user_id"

    service_name = (service or "").strip().lower()
    mcp_service = get_mcp_service()
    try:
        async with mcp_service.get_session(service=service_name, user_id=user_id) as session:
            tools_response = await session.list_tools()
            payload = [_to_jsonable(tool) for tool in tools_response.tools]
            return json.dumps({"service": service_name, "tools": payload})
    except MCPServiceError as exc:
        return json.dumps({"service": service_name, "error": exc.message, "status_code": exc.status_code})
    except Exception as exc:
        return json.dumps({"service": service_name, "error": str(exc)})


@tool
async def mcp_call_tool(service: str, tool_name: str, arguments_json: str, config: RunnableConfig) -> str:
    """
    Call a tool on an authenticated MCP provider.
    Use arguments_json as a JSON object string.
    """
    configurable = config.get("configurable", {})
    user_id = configurable.get("user_id")
    if not user_id:
        return "ERROR: user_id is required in config.configurable.user_id"

    service_name = (service or "").strip().lower()
    if not tool_name or not tool_name.strip():
        return "ERROR: tool_name is required"

    try:
        arguments = json.loads(arguments_json) if arguments_json else {}
        if not isinstance(arguments, dict):
            return "ERROR: arguments_json must decode to a JSON object"
    except json.JSONDecodeError as exc:
        return f"ERROR: arguments_json must be valid JSON ({exc})"

    mcp_service = get_mcp_service()
    try:
        async with mcp_service.get_session(service=service_name, user_id=user_id) as session:
            result = await session.call_tool(tool_name, arguments)
            return json.dumps(_to_jsonable(result))
    except MCPServiceError as exc:
        return json.dumps({"service": service_name, "tool_name": tool_name, "error": exc.message, "status_code": exc.status_code})
    except Exception as exc:
        return json.dumps({"service": service_name, "tool_name": tool_name, "error": str(exc)})


@tool
async def client_execute_in_sandbox(commands_to_run: List[str], entry_file: str, port_to_expose: int, config: RunnableConfig) -> str:
    """Packages the workspace, deploys it to the remote sandbox, and runs the commands."""
    session_id = config.get("configurable", {}).get("thread_id")
    task_title = config.get("configurable", {}).get("task_title", "Deploying")
    user_id = config.get("configurable", {}).get("user_id")

    print(f"{LOG} client_execute_in_sandbox | session={session_id} | entry={entry_file}", flush=True)

    if not session_id:
        print(f"{LOG} ✖ ERROR: No session_id provided", flush=True)
        return "ERROR: session_id not provided."
        
    ws_root = workspace_manager.resolve_workspace_path(str(session_id), user_id=user_id)
    if not ws_root or not os.path.exists(ws_root):
        print(f"{LOG} ✖ ERROR: workspace not found for session={session_id}", flush=True)
        return "ERROR: Workspace directory not found."

    entry_file = _resolve_entrypoint(ws_root, entry_file)
    print(f"{LOG} Packaging workspace from: {ws_root} | entrypoint={entry_file}", flush=True)

    has_frontend = os.path.isdir(os.path.join(ws_root, "frontend"))
    has_backend = os.path.isdir(os.path.join(ws_root, "backend"))
    if has_frontend and not has_backend:
        backend_dir = os.path.join(ws_root, "backend")
        os.makedirs(backend_dir, exist_ok=True)
        with open(os.path.join(backend_dir, "server.js"), "w") as bf:
            bf.write('const express = require("express");\nconst app = express();\napp.get("/api/health", (req, res) => res.json({ status: "ok" }));\napp.listen(3001, "0.0.0.0", () => console.log("Backend running on 3001"));\n')
        with open(os.path.join(backend_dir, "package.json"), "w") as bf:
            json.dump({"name": "backend", "version": "1.0.0", "scripts": {"start": "node server.js"}, "dependencies": {"express": "^4.18.0", "cors": "^2.8.5"}}, bf, indent=2)
        print(f"{LOG} Created minimal backend/ folder for dual-service mode", flush=True)

    # Package workspace to base64
    memory_file = io.BytesIO()
    with tarfile.open(fileobj=memory_file, mode="w:gz") as tar:
        for root, dirs, files in os.walk(ws_root):
            if "node_modules" in dirs:
                dirs.remove("node_modules")
            if ".git" in dirs:
                dirs.remove(".git")
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, ws_root)
                tar.add(full_path, arcname=rel_path)
    
    memory_file.seek(0)
    encoded_archive = base64.b64encode(memory_file.read()).decode("utf-8")
    print(f"{LOG} Archive ready | size={len(encoded_archive)} chars", flush=True)

    act = _make_activity("terminal", f"Running '{' && '.join(commands_to_run)}'", task_title=task_title)
    await ws_manager.broadcast_to_sandbox(session_id, {
        "type": "workspace_ops",
        "ops": [],
        "activities": [act],
        "progress_msg": f"Deploying to sandbox: {commands_to_run}"
    })

    sandbox_mcp = get_sandbox_mcp_service()
    if not sandbox_mcp._initialized:
        await sandbox_mcp.initialize()

    try:
        print(f"{LOG} Calling MCP execute_workspace_archive (timeout=300s)...", flush=True)
        result = await sandbox_mcp._call_tool("execute_workspace_archive", sandbox_mcp._with_client_id({
            "session_id": session_id,
            "entrypoint": entry_file,
            "archive_b64": encoded_archive,
        }, user_id), timeout=300)
        print(f"{LOG} MCP result type: {type(result).__name__}", flush=True)
        output_data = sandbox_mcp._parse_response(result)
                
        if isinstance(output_data, dict):
            output_text = output_data.get("output", output_data.get("execution_output", str(output_data)))
            tunnel_url = output_data.get("tunnel_url", "")
            if tunnel_url:
                print(f"{LOG} TUNNEL URL: {tunnel_url}", flush=True)
                output_text += f"\nTunnel URL: {tunnel_url}"
                sandbox_mcp.store_tunnel_url(session_id, tunnel_url)
                sandbox_mcp.store_deploy_snapshot(session_id, user_id=user_id)
                # Broadcast dedicated sandbox_ready event so the frontend canvas loads the preview
                await ws_manager.broadcast_to_sandbox(session_id, {
                    "type": "sandbox_ready",
                    "tunnel_url": tunnel_url,
                    "url": tunnel_url,
                    "stream_url": tunnel_url,
                })
                # Also embed in a workspace_ops progress_msg so the regex scanner picks it up
                ready_act = _make_activity("terminal_output", f"Live at: {tunnel_url}", task_title=task_title)
                await ws_manager.broadcast_to_sandbox(session_id, {
                    "type": "workspace_ops",
                    "ops": [],
                    "activities": [ready_act],
                    "progress_msg": f"Sandbox ready: {tunnel_url}"
                })
                
            term_act = _make_activity("terminal_output", f"Sandbox Output", task_title=task_title)
            await ws_manager.broadcast_to_sandbox(session_id, {
                "type": "workspace_ops",
                "ops": [],
                "activities": [term_act],
                "progress_msg": f"Sandbox execution complete."
            })
            return f"Execution Output:\n{output_text}"
            
        return f"Execution Output:\n{output_data}"
        
    except Exception as e:
        print(f"{LOG} ✖ ERROR in execute_in_sandbox: {type(e).__name__}: {e}", flush=True)
        return f"ERROR: Remote execution call failed: {e}"


@tool
async def supabase_exec_sql(sql_query: str, config: RunnableConfig) -> str:
    """Execute raw SQL against the company Supabase database. Use this to CREATE TABLE, ALTER TABLE, INSERT, etc.
    Requires COMPANY_SUPABASE_URL and COMPANY_SUPABASE_SERVICE_ROLE_KEY env vars."""
    session_id = config.get("configurable", {}).get("thread_id")
    print(f"{LOG} supabase_exec_sql | session={session_id} | query_len={len(sql_query)}", flush=True)

    # Auto-append schema reload if the query contains DDL (CREATE/ALTER TABLE)
    upper_q = sql_query.upper()
    if any(kw in upper_q for kw in ("CREATE TABLE", "ALTER TABLE", "DROP TABLE", "ADD COLUMN")):
        if "NOTIFY pgrst" not in sql_query:
            sql_query = sql_query.rstrip().rstrip(";") + ";\nNOTIFY pgrst, 'reload schema';"
            print(f"{LOG} Appended NOTIFY pgrst, 'reload schema' for DDL query", flush=True)

    supabase_url = (
        os.getenv("COMPANY_SUPABASE_URL")
        or os.getenv("SUPABASE_URL")
        or ""
    ).rstrip("/")
    service_role_key = (
        os.getenv("COMPANY_SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )

    if not supabase_url or not service_role_key:
        return "ERROR: COMPANY_SUPABASE_URL and COMPANY_SUPABASE_SERVICE_ROLE_KEY must be set."

    # Method 1: Try Supabase Management API (requires personal access token)
    # The service_role_key with sb_secret_ prefix won't work here, but try anyway
    management_token = os.getenv("SUPABASE_ACCESS_TOKEN", "")
    project_ref = supabase_url.replace("https://", "").replace(".supabase.co", "")

    if management_token:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"https://api.supabase.com/v1/projects/{project_ref}/sql",
                    headers={
                        "Authorization": f"Bearer {management_token}",
                        "Content-Type": "application/json",
                    },
                    json={"query": sql_query},
                )
                if resp.status_code == 200:
                    print(f"{LOG} ✓ SQL executed via Management API", flush=True)
                    return f"SQL executed successfully via Management API.\n{resp.text[:1000]}"
                else:
                    print(f"{LOG} Management API returned {resp.status_code}: {resp.text[:200]}", flush=True)
        except Exception as e:
            print(f"{LOG} Management API error: {e}", flush=True)

    # Method 2: Try creating a DB function that executes SQL, then call it via RPC
    # This only works if the function already exists
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # First, try calling exec_sql function if it exists
            resp = await client.post(
                f"{supabase_url}/rest/v1/rpc/exec_sql",
                headers={
                    "apikey": service_role_key,
                    "Authorization": f"Bearer {service_role_key}",
                    "Content-Type": "application/json",
                },
                json={"query": sql_query},
            )
            if resp.status_code == 200:
                print(f"{LOG} ✓ SQL executed via exec_sql RPC", flush=True)
                result_text = resp.text[:1000]

                # Auto-grant permissions for new tables
                import re as _re
                table_matches = _re.findall(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)', sql_query, _re.IGNORECASE)
                for tbl in table_matches:
                    for role in ("service_role", "anon", "authenticated"):
                        grant_sql = f"GRANT ALL ON public.{tbl} TO {role};"
                        try:
                            await client.post(
                                f"{supabase_url}/rest/v1/rpc/exec_sql",
                                headers={"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}", "Content-Type": "application/json"},
                                json={"query": grant_sql},
                                timeout=10,
                            )
                        except Exception:
                            pass
                    print(f"{LOG} ✓ Auto-granted permissions on {tbl}", flush=True)

                return f"SQL executed successfully via RPC.\n{result_text}"
            else:
                print(f"{LOG} RPC exec_sql returned {resp.status_code}: {resp.text[:200]}", flush=True)
    except Exception as e:
        print(f"{LOG} RPC error: {e}", flush=True)

    # Method 3: Use supabase-py client to try direct SQL (if installed)
    try:
        from supabase import create_client
        client = create_client(supabase_url, service_role_key)
        # Try to call exec_sql if it exists
        result = client.rpc("exec_sql", {"query": sql_query}).execute()
        print(f"{LOG} ✓ SQL executed via supabase-py RPC", flush=True)
        return f"SQL executed successfully via supabase-py.\n{str(result)[:1000]}"
    except Exception as e:
        print(f"{LOG} supabase-py error: {e}", flush=True)

    # Method 4: Direct PostgreSQL connection (if DATABASE_URL points to Supabase)
    db_url = os.getenv("SUPABASE_DB_URL", "")
    if db_url:
        try:
            import asyncpg
            conn = await asyncpg.connect(db_url)
            await conn.execute(sql_query)
            await conn.close()
            print(f"{LOG} ✓ SQL executed via direct PostgreSQL", flush=True)
            return "SQL executed successfully via direct PostgreSQL connection."
        except Exception as e:
            print(f"{LOG} Direct PostgreSQL error: {e}", flush=True)

    return (
        "ERROR: Could not execute SQL. None of the following methods worked:\n"
        "1. Management API (set SUPABASE_ACCESS_TOKEN env var with a personal access token)\n"
        "2. exec_sql RPC function (run this SQL first in Supabase dashboard to create it)\n"
        "3. supabase-py RPC\n"
        "4. Direct PostgreSQL (set SUPABASE_DB_URL)\n\n"
        "Quick fix: Go to https://supabase.com/dashboard/project/" + project_ref + "/sql/new and run the SQL manually."
    )


@tool
async def supabase_create_exec_sql_function(config: RunnableConfig) -> str:
    """One-time setup: Creates the exec_sql() function in Supabase so future SQL can be executed via RPC.
    Run this ONCE before using supabase_exec_sql. You need to paste the output SQL into Supabase dashboard."""
    supabase_url = (
        os.getenv("COMPANY_SUPABASE_URL")
        or os.getenv("SUPABASE_URL")
        or ""
    ).rstrip("/")
    project_ref = supabase_url.replace("https://", "").replace(".supabase.co", "")

    setup_sql = """DROP FUNCTION IF EXISTS exec_sql(text);

CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS json AS $$
DECLARE
    result json;
BEGIN
    IF trim(lower(query)) LIKE 'select%' THEN
        EXECUTE query INTO result;
        RETURN result;
    ELSE
        EXECUTE query;
        RETURN json_build_object('success', true, 'message', 'Query executed successfully');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also create the todos table for todo apps
CREATE TABLE IF NOT EXISTS public.todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  completed boolean DEFAULT false,
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'todos') THEN
    CREATE POLICY allow_all ON public.todos FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT ALL ON public.todos TO service_role;
GRANT ALL ON public.todos TO anon;
GRANT ALL ON public.todos TO authenticated;"""

    return (
        f"Please run this SQL in your Supabase dashboard:\n"
        f"https://supabase.com/dashboard/project/{project_ref}/sql/new\n\n"
        f"```sql\n{setup_sql}\n```\n\n"
        f"After running this ONCE, the agent will be able to create any table automatically via supabase_exec_sql."
    )


@tool
async def client_get_sandbox_logs(config: RunnableConfig) -> str:
    """Retrieves application logs (stdout/stderr) from the running sandbox container."""
    from Brain.services.sandbox_mcp_service import sandbox_mcp
    session_id = config.get("configurable", {}).get("thread_id")
    user_id = config.get("configurable", {}).get("user_id")

    if not session_id:
        return "ERROR: No session_id (thread_id) provided."

    result = await sandbox_mcp.get_sandbox_logs(session_id, user_id=user_id)

    if isinstance(result, dict):
        return result.get("logs") or result.get("error") or str(result)
    return str(result)
