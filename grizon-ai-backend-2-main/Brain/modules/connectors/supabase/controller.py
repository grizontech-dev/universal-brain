import os
import json
import secrets
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
from Brain.config.redis import redis_client
from Brain.modules.connectors.supabase.service import SupabaseOAuthService
import urllib.parse
from dotenv import load_dotenv

load_dotenv(override=True)

router = APIRouter(prefix="/connect-supabase", tags=["Supabase Integration"])
supabase_service = SupabaseOAuthService()

from Brain.modules.shared.auth import get_current_user

# 10 minutes expiration for the state/PKCE challenge
STATE_EXPIRATION = 600 

@router.get("/login")
async def login(
    current_user = Depends(get_current_user)
):
    
    """
    Initiates the Supabase OAuth PKCE flow.
    Uses the authenticated current_user to securely store the user_id in the state payload.
    """
    client_id = os.getenv("SUPABASE_CLIENT_ID")
    redirect_uri = os.getenv("SUPABASE_REDIRECT_URI")
    print(f"DEBUG REDIRECT URI: {redirect_uri}")
    if not client_id:
        raise HTTPException(status_code=500, detail="SUPABASE_CLIENT_ID not configured")

    # Generate PKCE parameters
    code_verifier, code_challenge = supabase_service.generate_pkce_challenge()
    
    # Generate a unique state to prevent CSRF and track the user's flow
    state = secrets.token_urlsafe(32)
    
    # Store BOTH code_verifier and user_id in Redis
    state_data = {
        "code_verifier": code_verifier,
        "user_id": current_user.id
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
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(status_code=400, detail="Corrupted state parameter payload")
    
    try:
        # Exchange the authorization code for tokens
        token_response = await supabase_service.exchange_code_for_token(code, code_verifier)
        
        # Securely save the tokens to the database
        supabase_service.save_supabase_connection(user_id, token_response)
        
        # Redirect back to frontend
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(url=f"{frontend_url}/integrations?provider=supabase&status=success")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process callback: {str(e)}")
