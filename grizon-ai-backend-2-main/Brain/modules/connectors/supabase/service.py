import os
import base64
import hashlib
import secrets
import httpx
from typing import Tuple, Dict, Any
from cryptography.fernet import Fernet
from sqlalchemy import Column, String, Boolean, DateTime, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid
from Brain.config.database import Base, SessionLocal

# Database Model
class Connector(Base):
    __tablename__ = "connectors"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    userId = Column(UUID(as_uuid=False), ForeignKey("users.id"), name="userId")
    type = Column(String)
    config = Column(JSON)
    isActive = Column(Boolean, default=True, name="isActive")
    createdAt = Column(DateTime, default=datetime.utcnow, name="createdAt")
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt")

# Encryption Helpers
def get_encryption_key():
    secret = os.getenv("JWT_SECRET", "default-secret-key-1234")
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)

fernet = Fernet(get_encryption_key())

def encrypt_token(token: str) -> str:
    if not token:
        return token
    return fernet.encrypt(token.encode()).decode()

def decrypt_token(token: str) -> str:
    if not token:
        return token
    return fernet.decrypt(token.encode()).decode()

class SupabaseOAuthService:
    def __init__(self):
        self.client_id = os.getenv("SUPABASE_CLIENT_ID")
        self.client_secret = os.getenv("SUPABASE_CLIENT_SECRET")
        self.redirect_uri = os.getenv("SUPABASE_REDIRECT_URI")
        self.token_url = "https://api.supabase.com/v1/oauth/token"

    def generate_pkce_challenge(self) -> Tuple[str, str]:
        """
        Generates a PKCE code verifier and code challenge.
        Returns: (code_verifier, code_challenge)
        """
        code_verifier = secrets.token_urlsafe(64)
        
        # Calculate SHA256 hash
        hashed = hashlib.sha256(code_verifier.encode('ascii')).digest()
        
        # Base64-url-encode without padding
        code_challenge = base64.urlsafe_b64encode(hashed).decode('ascii').rstrip('=')
        
        return code_verifier, code_challenge

    async def exchange_code_for_token(self, auth_code: str, code_verifier: str) -> Dict[str, Any]:
        """
        Exchanges the authorization code for an access token.
        """
        if not self.client_id or not self.client_secret or not self.redirect_uri:
            raise ValueError("Supabase OAuth credentials are not properly configured in environment variables.")

        # Important: The request requires basic auth using client_id and client_secret
        auth = httpx.BasicAuth(self.client_id, self.client_secret)
        
        data = {
            "grant_type": "authorization_code",
            "code": auth_code,
            "code_verifier": code_verifier,
            "redirect_uri": self.redirect_uri
        }
        
        # Supabase expects form-urlencoded data for OAuth token exchange
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_url,
                auth=auth,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            
            if response.status_code != 200:
                print(f"Failed to exchange token. Status: {response.status_code}, Body: {response.text}")
                response.raise_for_status()
                
            return response.json()
            
    def save_supabase_connection(self, user_id: str, tokens: Dict[str, Any]):
        """
        Encrypts and saves the Supabase tokens to the database.
        """
        encrypted_access = encrypt_token(tokens.get("access_token"))
        encrypted_refresh = encrypt_token(tokens.get("refresh_token"))
        
        config = {
            "access_token": encrypted_access,
            "refresh_token": encrypted_refresh,
            "expires_in": tokens.get("expires_in"),
            "token_type": tokens.get("token_type")
        }
        
        db = SessionLocal()
        try:
            connector = db.query(Connector).filter(Connector.userId == user_id, Connector.type == "supabase").first()
            if connector:
                connector.config = config
                connector.updatedAt = datetime.utcnow()
            else:
                connector = Connector(
                    userId=user_id,
                    type="supabase",
                    config=config
                )
                db.add(connector)
            db.commit()
        finally:
            db.close()
