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
        
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="JWT_SECRET is not configured")
        
    try:
        # The node backend uses HS256 algorithm for signing the JWT
        decoded = jwt.decode(token, secret, algorithms=["HS256"])
        return User(
            id=decoded.get("id"),
            email=decoded.get("email"),
            role=decoded.get("role", "USER")
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
