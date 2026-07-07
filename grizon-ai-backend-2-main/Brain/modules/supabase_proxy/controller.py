from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, Depends, HTTPException
from pydantic import BaseModel, Field

from Brain.modules.supabase_proxy.service import proxy_client


router = APIRouter(prefix="/api/connector", tags=["supabase-proxy"])


class ConnectorPushRequest(BaseModel):
    schema_name: str = Field(..., min_length=1)
    custom_payload: Dict[str, Any] = Field(default_factory=dict)


class ConnectorQueryRequest(BaseModel):
    schema_name: str = Field(..., min_length=1)
    filter_key: Optional[str] = None
    filter_value: Optional[str] = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


@router.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "success": True,
        "service": "company-supabase-proxy",
        "configured": bool(proxy_client.supabase_url and proxy_client.service_role_key),
    }


async def enforce_push_guard(
    authorization: Optional[str] = Header(default=None),
    x_tenant_id: Optional[str] = Header(default=None, alias="X-Tenant-Id"),
) -> str:
    tenant_id = proxy_client.resolve_tenant_id(authorization, x_tenant_id)
    await proxy_client.enforce_write_rate_limit(tenant_id)
    await proxy_client.mark_tenant_activity(tenant_id)
    return tenant_id


@router.post("/push")
async def push_connector_data(
    request: ConnectorPushRequest,
    tenant_id: str = Depends(enforce_push_guard),
):
    inserted = await proxy_client.insert_vault_record(tenant_id, request.schema_name, request.custom_payload)
    return {"success": True, "tenant_id": tenant_id, "data": inserted}


@router.get("/query")
async def query_connector_data(
    request: ConnectorQueryRequest = Depends(),
    authorization: Optional[str] = Header(default=None),
    x_tenant_id: Optional[str] = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = proxy_client.resolve_tenant_id(authorization, x_tenant_id)
    await proxy_client.mark_tenant_activity(tenant_id)
    data = await proxy_client.query_vault_records(
        tenant_id,
        request.schema_name,
        filter_key=request.filter_key,
        filter_value=request.filter_value,
        limit=request.limit,
        offset=request.offset,
    )
    return {"success": True, "tenant_id": tenant_id, "data": data}