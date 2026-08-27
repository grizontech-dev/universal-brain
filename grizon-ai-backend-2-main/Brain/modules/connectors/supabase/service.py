import os
import base64
import hashlib
import secrets
import httpx
import logging
from datetime import datetime, timedelta, timezone
from typing import Tuple, Dict, Any, Optional
from cryptography.fernet import Fernet
from sqlalchemy import Column, String, Boolean, DateTime, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

import uuid
from Brain.config.database import Base, SessionLocal

# Database Model
class Connector(Base):
    __tablename__ = "connectors"
    id = Column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
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
        self.logger = logging.getLogger(__name__)

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

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        if not self.client_id or not self.client_secret:
            raise ValueError("Supabase OAuth credentials are not properly configured in environment variables.")

        auth = httpx.BasicAuth(self.client_id, self.client_secret)
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                self.token_url,
                auth=auth,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            return response.json()

    def get_connection(self, user_id: str) -> Optional[Connector]:
        db = SessionLocal()
        try:
            return db.query(Connector).filter(Connector.userId == user_id, Connector.type == "supabase").first()
        finally:
            db.close()

    def _decrypt_token(self, token: Any, field_name: str) -> Optional[str]:
        if not isinstance(token, str) or not token:
            return None
        try:
            return decrypt_token(token)
        except Exception:
            self.logger.warning("Connector field '%s' appears unencrypted; using plain token fallback.", field_name)
            return token

    def _get_expiry_utc(self, connector: Connector) -> Optional[datetime]:
        config = connector.config or {}
        expires_at_value = config.get("expires_at")
        if isinstance(expires_at_value, str) and expires_at_value:
            try:
                normalized = expires_at_value.replace("Z", "+00:00")
                expires_at = datetime.fromisoformat(normalized)
                return expires_at.astimezone(timezone.utc) if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            except ValueError:
                self.logger.warning("Invalid Supabase connector expires_at value: %s", expires_at_value)

        expires_in_value = config.get("expires_in")
        if expires_in_value is None:
            return None

        try:
            seconds = int(expires_in_value)
        except (TypeError, ValueError):
            self.logger.warning("Invalid Supabase connector expires_in value: %s", expires_in_value)
            return None
        updated_at = connector.updatedAt or connector.createdAt or datetime.utcnow()
        updated_at_utc = updated_at.astimezone(timezone.utc) if updated_at.tzinfo else updated_at.replace(tzinfo=timezone.utc)
        return updated_at_utc + timedelta(seconds=seconds)

    def _is_access_token_expired(self, connector: Connector, skew_seconds: int = 90) -> bool:
        expiry_utc = self._get_expiry_utc(connector)
        if not expiry_utc:
            return False
        now_utc = datetime.now(timezone.utc)
        return now_utc >= (expiry_utc - timedelta(seconds=skew_seconds))

    async def get_valid_access_token(self, user_id: str) -> str:
        connector = self.get_connection(user_id)
        if not connector or not connector.config:
            raise ValueError("Supabase connector not connected")

        config = connector.config or {}
        access_token = self._decrypt_token(config.get("access_token"), "access_token")
        refresh_token = self._decrypt_token(config.get("refresh_token"), "refresh_token")

        if access_token and not self._is_access_token_expired(connector):
            return access_token

        if not refresh_token:
            raise ValueError("Supabase connector is missing refresh token")

        refreshed_tokens = await self.refresh_access_token(refresh_token)
        self.save_supabase_connection(user_id, refreshed_tokens, existing_config=config)

        refreshed_connector = self.get_connection(user_id)
        if not refreshed_connector or not refreshed_connector.config:
            raise ValueError("Supabase connector refresh did not persist updated credentials")
        refreshed_access_token = self._decrypt_token((refreshed_connector.config or {}).get("access_token"), "access_token")
        if not refreshed_access_token:
            raise ValueError("Supabase token refresh returned an invalid access token")
        return refreshed_access_token

    def save_supabase_connection(self, user_id: str, tokens: Dict[str, Any], existing_config: Optional[Dict[str, Any]] = None):
        """
        Encrypts and saves the Supabase tokens to the database.
        """
        encrypted_access = encrypt_token(tokens.get("access_token"))
        encrypted_refresh = encrypt_token(tokens.get("refresh_token"))

        config = dict(existing_config or {})
        if encrypted_access:
            config["access_token"] = encrypted_access
        if encrypted_refresh:
            config["refresh_token"] = encrypted_refresh
        if tokens.get("expires_in") is not None:
            expires_in = int(tokens["expires_in"])
            config["expires_in"] = expires_in
            config["expires_at"] = (datetime.utcnow() + timedelta(seconds=expires_in)).replace(tzinfo=timezone.utc).isoformat()
        if tokens.get("token_type"):
            config["token_type"] = tokens.get("token_type")
         
        db = SessionLocal()
        try:
            connector = db.query(Connector).filter(Connector.userId == user_id, Connector.type == "supabase").first()
            if connector:
                merged_config = dict(connector.config or {})
                merged_config.update(config)
                connector.config = merged_config
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
