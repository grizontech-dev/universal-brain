import os
import jwt
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from collections import namedtuple

# A simple struct to represent the authenticated user
User = namedtuple("User", ["id", "email", "role"])

security = HTTPBearer(auto_error=False)

async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> User:
    """
    Dependency to get the current authenticated user.
    Parses the JWT from credentials.credentials or request.cookies
    and extracts the user ID.
    """
    token = None
    
    # Try to get from Authorization header first (for API calls)
    if credentials:
        token = credentials.credentials
        
    # Try cookies for browser-based redirects (OAuth flow)
    if not token and request.cookies:
        token = request.cookies.get("next-auth.session-token")
        if not token:
            token = request.cookies.get("token")
            
    # Try query parameter for OAuth redirects where frontend can't use cookies
    if not token and request.query_params:
        token = request.query_params.get("token")
        
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
        
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token header: {str(e)}")

    decoded = None
    if alg == "RS256":
        pub_key_path = os.getenv("JWT_PUBLIC_KEY_PATH", "./secrets/jwt-public.pem")
        if not os.path.isabs(pub_key_path):
            current_dir = os.path.dirname(os.path.abspath(__file__))
            # auth.py is in Brain/modules/shared/
            # The backend root is 3 levels up: shared -> modules -> Brain -> root
            root_dir = os.path.dirname(os.path.dirname(os.path.dirname(current_dir)))
            pub_key_path = os.path.join(root_dir, pub_key_path)

        if not os.path.exists(pub_key_path):
            raise HTTPException(status_code=500, detail=f"JWT public key file not found at {pub_key_path}")

        try:
            with open(pub_key_path, "r") as f:
                pub_key = f.read()
            decoded = jwt.decode(token, pub_key, algorithms=["RS256"], options={"verify_aud": False})
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Invalid RS256 token: {str(e)}")
    else:
        secret = os.getenv("JWT_SECRET")
        if not secret:
            raise HTTPException(status_code=500, detail="JWT_SECRET is not configured")
        try:
            decoded = jwt.decode(token, secret, algorithms=["HS256"])
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Invalid HS256 token: {str(e)}")

    if not decoded:
        raise HTTPException(status_code=401, detail="Token decoding failed")

    return User(
        id=decoded.get("sub") or decoded.get("id"),
        email=decoded.get("email"),
        role=decoded.get("role", "USER")
    )
