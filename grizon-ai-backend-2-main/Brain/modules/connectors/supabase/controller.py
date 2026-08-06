import os
import json
import secrets
import httpx
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
from Brain.config.redis import redis_client
from Brain.modules.connectors.supabase.service import SupabaseOAuthService
from Brain.modules.connectors.supabase.schema import get_schema_sql
import urllib.parse
from dotenv import load_dotenv

load_dotenv(override=True)

router = APIRouter(prefix="/connect-supabase", tags=["Supabase Integration"])
supabase_service = SupabaseOAuthService()

from Brain.modules.shared.auth import get_current_user
from Brain.config.database import SessionLocal
from Brain.modules.connectors.supabase.service import Connector, decrypt_token
from Brain.services.workspace_manager import workspace_manager

# 10 minutes expiration for the state/PKCE challenge
STATE_EXPIRATION = 600

@router.get("/status")
async def get_supabase_status(current_user = Depends(get_current_user)):
    db = SessionLocal()
    try:
        connector = db.query(Connector).filter(
            Connector.userId == current_user.id,
            Connector.type == "supabase",
            Connector.isActive == True
        ).first()
        has_credentials = False
        config = connector.config if connector else {}
        if config and (config.get("url") or config.get("access_token")):
            has_credentials = True
        return {"connected": connector is not None, "has_credentials": has_credentials, "config": {"url": config.get("url", ""), "anon_key": config.get("anon_key", "")} if has_credentials else None}
    finally:
        db.close()


@router.post("/disconnect")
async def disconnect_supabase(current_user = Depends(get_current_user)):
    db = SessionLocal()
    try:
        connector = db.query(Connector).filter(
            Connector.userId == current_user.id,
            Connector.type == "supabase"
        ).first()
        if connector:
            db.delete(connector)
            db.commit()
        return {"success": True}
    finally:
        db.close()


@router.post("/save-credentials")
async def save_credentials(req: dict, current_user=Depends(get_current_user)):
    url = (req.get("url") or "").strip().rstrip("/")
    anon_key = (req.get("anon_key") or "").strip()
    service_role_key = (req.get("service_role_key") or "").strip()
    if not url or not anon_key:
        raise HTTPException(status_code=422, detail="url and anon_key are required")

    db = SessionLocal()
    try:
        connector = db.query(Connector).filter(
            Connector.userId == current_user.id,
            Connector.type == "supabase"
        ).first()
        config = {"url": url, "anon_key": anon_key}
        if service_role_key:
            config["service_role_key"] = service_role_key
        if connector:
            connector.config = {**connector.config, **config} if connector.config else config
            connector.isActive = True
        else:
            connector = Connector(userId=current_user.id, type="supabase", config=config, isActive=True)
            db.add(connector)
        db.commit()
        return {"success": True, "url": url}
    finally:
        db.close()


@router.post("/apply-to-workspace")
async def apply_to_workspace(req: dict, current_user=Depends(get_current_user)):
    workspace_id = req.get("workspace_id", "")
    url = (req.get("url") or "").strip().rstrip("/")
    anon_key = (req.get("anon_key") or "").strip()
    service_role_key = (req.get("service_role_key") or "").strip()
    if not workspace_id or not url or not anon_key:
        raise HTTPException(status_code=422, detail="workspace_id, url, and anon_key are required")

    ws_path = workspace_manager.resolve_workspace_path(workspace_id)
    if not ws_path:
        raise HTTPException(status_code=404, detail="Workspace not found")

    env_content = f"SUPABASE_URL={url}\nSUPABASE_ANON_KEY={anon_key}\n"
    if service_role_key:
        env_content += f"SUPABASE_SERVICE_ROLE_KEY={service_role_key}\n"
    env_path = os.path.join(ws_path, "backend", ".env")
    try:
        os.makedirs(os.path.dirname(env_path), exist_ok=True)
        with open(env_path, "w", encoding="utf-8") as f:
            f.write(env_content)
        return {"success": True, "path": "backend/.env"}
    except Exception as e:
        return {"error": str(e)}


@router.post("/inject-company-credentials")
async def inject_company_credentials(req: dict, current_user=Depends(get_current_user)):
    """
    Inject company Supabase credentials to workspace's backend/.env.
    This allows projects to use company Supabase automatically without user setup.
    """
    workspace_id = req.get("workspace_id", "")
    user_id = req.get("user_id")
    if not workspace_id:
        raise HTTPException(status_code=422, detail="workspace_id is required")

    from Brain.services.template_service import inject_company_supabase_to_workspace
    success = inject_company_supabase_to_workspace(workspace_id, user_id=user_id)

    if success:
        return {"success": True, "message": "Company Supabase credentials injected"}
    else:
        # Check if credentials already exist
        ws_path = workspace_manager.resolve_workspace_path(workspace_id, user_id=user_id)
        if ws_path:
            env_path = os.path.join(ws_path, "backend", ".env")
            if os.path.exists(env_path):
                with open(env_path, "r", encoding="utf-8") as f:
                    content = f.read()
                if "SUPABASE_URL" in content:
                    return {"success": True, "message": "Supabase credentials already configured"}
        return {"success": False, "message": "Failed to inject credentials"}


@router.post("/auto-schema")
async def auto_schema(req: dict, current_user=Depends(get_current_user)):
    """
    Automatically create all required tables in the user's Supabase project.
    Requires either:
      - OAuth access_token (from Supabase OAuth flow) — uses Management API
      - service_role key + database password — connects directly via psycopg2
    Also writes SUPABASE_URL + SUPABASE_ANON_KEY to workspace .env.
    """
    workspace_id = req.get("workspace_id", "")
    url = (req.get("url") or "").strip().rstrip("/")
    anon_key = (req.get("anon_key") or "").strip()
    service_role_key = (req.get("service_role_key") or "").strip()

    if not url or not anon_key:
        raise HTTPException(status_code=422, detail="url and anon_key are required")

    # Extract project ref from URL (https://xyz.supabase.co -> xyz)
    project_ref = None
    if ".supabase.co" in url:
        project_ref = url.split("https://")[-1].split(".supabase.co")[0]

    db = SessionLocal()
    try:
        connector = db.query(Connector).filter(
            Connector.userId == current_user.id,
            Connector.type == "supabase",
            Connector.isActive == True
        ).first()

        # Try Management API first (OAuth flow)
        access_token = None
        if connector and connector.config:
            encrypted_token = connector.config.get("access_token", "")
            if encrypted_token:
                access_token = decrypt_token(encrypted_token)

        schema_sql = get_schema_sql()
        tables_created = []
        errors = []

        if access_token and project_ref:
            # Use Supabase Management API
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Content-Type": "application/json",
                        },
                        json={"query": schema_sql},
                    )
                    if resp.status_code == 200:
                        result = resp.json()
                        tables_created = [
                            "profiles", "projects", "posts", "media",
                            "activity_log", "settings"
                        ]
                    else:
                        errors.append(f"Management API error {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                errors.append(f"Management API call failed: {str(e)[:200]}")

        elif service_role_key and project_ref:
            # Direct PostgreSQL connection using service_role_key as password
            try:
                import psycopg2
                conn = psycopg2.connect(
                    host=f"db.{project_ref}.supabase.co",
                    port=5432,
                    dbname="postgres",
                    user="postgres",
                    password=service_role_key,
                    sslmode="require",
                )
                conn.autocommit = True
                cur = conn.cursor()
                # Execute each statement separately
                for statement in schema_sql.split(";"):
                    stmt = statement.strip()
                    if stmt:
                        cur.execute(stmt)
                cur.close()
                conn.close()
                tables_created = [
                    "profiles", "projects", "posts", "media",
                    "activity_log", "settings"
                ]
            except ImportError:
                errors.append("psycopg2 not installed — cannot connect directly")
            except Exception as e:
                errors.append(f"Direct connection failed: {str(e)[:200]}")
        else:
            errors.append("No access token (OAuth) or service_role_key available for schema creation")

        # Write to workspace .env regardless of schema creation
        env_written = False
        if workspace_id:
            ws_path = workspace_manager.resolve_workspace_path(workspace_id)
            if ws_path:
                env_content = f"SUPABASE_URL={url}\nSUPABASE_ANON_KEY={anon_key}\n"
                if service_role_key:
                    env_content += f"SUPABASE_SERVICE_ROLE_KEY={service_role_key}\n"
                env_path = os.path.join(ws_path, "backend", ".env")
                try:
                    os.makedirs(os.path.dirname(env_path), exist_ok=True)
                    with open(env_path, "w", encoding="utf-8") as f:
                        f.write(env_content)
                    env_written = True
                except Exception as e:
                    errors.append(f"Failed to write .env: {str(e)[:100]}")

        # Save credentials to connector table
        config = {"url": url, "anon_key": anon_key}
        if service_role_key:
            config["service_role_key"] = service_role_key
        if connector:
            connector.config = {**connector.config, **config} if connector.config else config
            connector.isActive = True
        else:
            connector = Connector(userId=current_user.id, type="supabase", config=config, isActive=True)
            db.add(connector)
        db.commit()

        return {
            "success": len(errors) == 0 or len(tables_created) > 0,
            "tables_created": tables_created,
            "env_written": env_written,
            "errors": errors if errors else None,
        }
    finally:
        db.close()


@router.get("/login")
async def login(
    current_user = Depends(get_current_user),
    workspace_id: str = Query(None, description="Workspace ID to redirect back to after OAuth"),
    return_url: str = Query(None, description="Custom return URL after OAuth")
):

    """
    Initiates the Supabase OAuth PKCE flow.
    Uses the authenticated current_user to securely store the user_id in the state payload.
    """
    client_id = os.getenv("SUPABASE_CLIENT_ID")
    redirect_uri = os.getenv("SUPABASE_REDIRECT_URI")
    if not client_id:
        raise HTTPException(status_code=500, detail="SUPABASE_CLIENT_ID not configured")

    # Generate PKCE parameters
    code_verifier, code_challenge = supabase_service.generate_pkce_challenge()

    # Generate a unique state to prevent CSRF and track the user's flow
    state = secrets.token_urlsafe(32)

    # Store code_verifier, user_id, and return context in Redis
    state_data = {
        "code_verifier": code_verifier,
        "user_id": current_user.id,
        "workspace_id": workspace_id,
        "return_url": return_url
    }
    await redis_client.setex(f"supabase_oauth_state:{state}", STATE_EXPIRATION, json.dumps(state_data))
    
    # Construct the authorization URL
    auth_url = "https://api.supabase.com/v1/oauth/authorize"
    params = {
        "client_id": client_id,
        "response_type": "code",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "redirect_uri": os.getenv("SUPABASE_REDIRECT_URI"),
        "state": state
    }
    
    redirect_url = f"{auth_url}?{urllib.parse.urlencode(params)}"
    print(repr(os.getenv("SUPABASE_REDIRECT_URI")))
    print(redirect_url)
    return RedirectResponse(url=redirect_url)
    



@router.get("/oauth2/callback")
async def oauth2_callback(
    code: str = Query(..., description="The authorization code from Supabase"),
    state: str = Query(..., description="The state parameter for CSRF validation"),
    error: str = Query(None, description="Error from Supabase if any"),
    error_description: str = Query(None, description="Error description from Supabase")
):
    """
    Handles the callback from Supabase.
    """
    if error:
        raise HTTPException(status_code=400, detail=f"OAuth error: {error} - {error_description}")

    # Validate state and retrieve code_verifier + user_id
    redis_key = f"supabase_oauth_state:{state}"
    state_payload = await redis_client.get(redis_key)
    
    if not state_payload:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")
        
    # Delete the state from Redis to prevent reuse
    await redis_client.delete(redis_key)
    
    try:
        state_data = json.loads(state_payload)
        code_verifier = state_data["code_verifier"]
        user_id = state_data["user_id"]
        workspace_id = state_data.get("workspace_id")
        return_url = state_data.get("return_url")
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(status_code=400, detail="Corrupted state parameter payload")

    try:
        # Exchange the authorization code for tokens
        token_response = await supabase_service.exchange_code_for_token(code, code_verifier)

        # Securely save the tokens to the database
        supabase_service.save_supabase_connection(user_id, token_response)

        # Redirect back to the brain conversation or integrations page
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        if workspace_id:
            redirect_to = f"{frontend_url}/brain/{workspace_id}?supabase=connected"
        elif return_url:
            redirect_to = return_url
        else:
            redirect_to = f"{frontend_url}/integrations?provider=supabase&status=success"
        return RedirectResponse(url=redirect_to)

    except Exception as e:
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        error_msg = urllib.parse.quote(str(e))
        if workspace_id:
            redirect_to = f"{frontend_url}/brain/{workspace_id}?supabase=error&message={error_msg}"
        else:
            redirect_to = f"{frontend_url}/integrations?provider=supabase&status=error&error={error_msg}"
        return RedirectResponse(url=redirect_to)
