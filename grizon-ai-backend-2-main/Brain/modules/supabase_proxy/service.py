from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Dict, Optional, Sequence

import httpx
import jwt
from fastapi import HTTPException

from Brain.config.redis import redis_client


class CompanySupabaseProxy:
    """Proxy requests from the Brain backend to the company-owned Supabase project."""

    def __init__(self) -> None:
        self.supabase_url = (
            os.getenv("COMPANY_SUPABASE_URL")
            or os.getenv("SUPABASE_URL")
            or ""
        ).rstrip("/")
        self.service_role_key = (
            os.getenv("COMPANY_SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or ""
        )
        self.jwt_secret = (
            os.getenv("CONNECTOR_PROXY_JWT_SECRET")
            or os.getenv("MY_PLATFORM_JWT_SECRET")
            or os.getenv("JWT_SECRET_KEY")
            or ""
        )
        self.allow_tenant_header = os.getenv("CONNECTOR_PROXY_ALLOW_TENANT_HEADER", "false").lower() in {
            "1",
            "true",
            "yes",
        }
        self.write_limit_per_minute = int(os.getenv("CONNECTOR_PROXY_WRITE_LIMIT_PER_MINUTE", "60"))
        self.idle_ttl_minutes = int(os.getenv("CONNECTOR_PROXY_IDLE_TTL_MINUTES", "30"))
        self.retention_days = int(os.getenv("CONNECTOR_PROXY_RETENTION_DAYS", "30"))
        self.maintenance_interval_seconds = int(os.getenv("CONNECTOR_PROXY_MAINTENANCE_INTERVAL_SECONDS", "300"))
        self.client: Optional[httpx.AsyncClient] = None
        self.maintenance_task: Optional[asyncio.Task] = None

    def _require_config(self) -> None:
        if not self.supabase_url or not self.service_role_key:
            raise HTTPException(
                status_code=503,
                detail="Company Supabase proxy is not configured. Set COMPANY_SUPABASE_URL and COMPANY_SUPABASE_SERVICE_ROLE_KEY.",
            )

    async def init_client(self) -> None:
        if self.client is None and self.supabase_url and self.service_role_key:
            self.client = httpx.AsyncClient(
                base_url=f"{self.supabase_url}/rest/v1/",
                headers={
                    "apikey": self.service_role_key,
                    "Authorization": f"Bearer {self.service_role_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                timeout=20.0,
            )

    async def start_housekeeping(self) -> None:
        if self.maintenance_task is None or self.maintenance_task.done():
            self.maintenance_task = asyncio.create_task(self._maintenance_loop())

    async def close_client(self) -> None:
        if self.maintenance_task is not None:
            self.maintenance_task.cancel()
            try:
                await self.maintenance_task
            except asyncio.CancelledError:
                pass
            finally:
                self.maintenance_task = None
        if self.client is not None:
            await self.client.aclose()
            self.client = None

    def resolve_tenant_id(self, authorization: Optional[str], tenant_header: Optional[str]) -> str:
        if self.allow_tenant_header and tenant_header:
            return tenant_header.strip()

        if not authorization:
            raise HTTPException(status_code=401, detail="Missing bearer token")

        token = authorization[7:].strip()  # strip "Bearer " prefix — compatible with Python 3.8+
        if not token:
            raise HTTPException(status_code=401, detail="Missing bearer token")

        if not self.jwt_secret:
            raise HTTPException(
                status_code=503,
                detail="JWT verification is not configured. Set CONNECTOR_PROXY_JWT_SECRET or enable CONNECTOR_PROXY_ALLOW_TENANT_HEADER for local development.",
            )

        try:
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"], options={"verify_aud": False})
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail="Could not validate credentials") from exc

        tenant_id = payload.get("sub") or payload.get("tenant_id") or payload.get("user_id")
        if not tenant_id:
            raise HTTPException(status_code=401, detail="Token is missing a tenant identity claim")
        return str(tenant_id)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, str]] = None,
        json_body: Any = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        self._require_config()
        if self.client is None:
            await self.init_client()

        response = None
        for attempt in range(3):
            try:
                response = await self.client.request(method, path.lstrip('/'), params=params, json=json_body, headers=headers)
                break
            except httpx.HTTPError as exc:
                if attempt == 2:
                    raise HTTPException(status_code=503, detail="Supabase proxy request failed after retries") from exc
                await asyncio.sleep(0.25 * (attempt + 1))

        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.text)

        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return response.text

    async def insert_vault_record(self, tenant_id: str, schema_name: str, record_data: Dict[str, Any]) -> Any:
        payload = {
            "tenant_id": tenant_id,
            "schema_name": schema_name,
            "record_data": record_data,
        }
        return await self._request("POST", "tenant_connector_vault", json_body=payload)

    async def enforce_write_rate_limit(self, tenant_id: str) -> None:
        key = f"connector_proxy:rate:{tenant_id}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, 60)
        if count > self.write_limit_per_minute:
            raise HTTPException(status_code=429, detail="Tenant write limit exceeded. Try again later.")

    async def mark_tenant_activity(self, tenant_id: str) -> None:
        await redis_client.set(f"connector_proxy:last_activity:{tenant_id}", str(int(time.time())), ex=max(self.idle_ttl_minutes * 2 * 60, 3600))
        await redis_client.sadd("connector_proxy:known_tenants", tenant_id)

    async def _get_last_activity_seconds(self, tenant_id: str) -> Optional[int]:
        value = await redis_client.get(f"connector_proxy:last_activity:{tenant_id}")
        return int(value) if value and value.isdigit() else None

    async def purge_tenant_records(self, tenant_id: str) -> int:
        result = await self._request(
            "DELETE",
            "tenant_connector_vault",
            params={"tenant_id": f"eq.{tenant_id}"},
        )
        if isinstance(result, list):
            return len(result)
        return 0

    async def purge_expired_records(self) -> None:
        await self._request(
            "DELETE",
            "tenant_connector_vault",
            params={"created_at": f"lt.{self._retention_cutoff()}"},
        )

    def _retention_cutoff(self) -> str:
        from datetime import datetime, timedelta, timezone

        cutoff = datetime.now(timezone.utc) - timedelta(days=self.retention_days)
        return cutoff.isoformat().replace("+00:00", "Z")

    async def _cleanup_idle_tenants(self) -> None:
        tenant_ids: Sequence[str] = await redis_client.smembers("connector_proxy:known_tenants")
        if not tenant_ids:
            return

        now_seconds = int(time.time())
        idle_threshold = self.idle_ttl_minutes * 60
        for tenant_id in tenant_ids:
            last_activity = await self._get_last_activity_seconds(tenant_id)
            if last_activity is None:
                continue
            if now_seconds - last_activity >= idle_threshold:
                await self.purge_tenant_records(tenant_id)
                await redis_client.delete(f"connector_proxy:last_activity:{tenant_id}")
                await redis_client.srem("connector_proxy:known_tenants", tenant_id)

    async def _maintenance_loop(self) -> None:
        try:
            while True:
                try:
                    await self.purge_expired_records()
                    await self._cleanup_idle_tenants()
                except Exception:
                    pass
                await asyncio.sleep(self.maintenance_interval_seconds)
        except asyncio.CancelledError:
            raise

    async def query_vault_records(
        self,
        tenant_id: str,
        schema_name: str,
        *,
        filter_key: Optional[str] = None,
        filter_value: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Any:
        start = max(0, offset)
        end = start + max(1, min(limit, 500)) - 1
        params: Dict[str, str] = {
            "select": "*",
            "tenant_id": f"eq.{tenant_id}",
            "schema_name": f"eq.{schema_name}",
            "order": "created_at.desc",
        }
        if filter_key and filter_value is not None:
            params[f"record_data->>{filter_key}"] = f"eq.{filter_value}"
        headers = {"Range": f"{start}-{end}"}
        return await self._request("GET", "tenant_connector_vault", params=params, headers=headers)


proxy_client = CompanySupabaseProxy()