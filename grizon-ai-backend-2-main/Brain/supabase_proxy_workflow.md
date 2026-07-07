# Supabase Proxy Workflow

## Purpose
Use one fixed company-owned Supabase project behind a Python FastAPI proxy. End users never talk to Supabase directly.

## Request Flow
1. The client sends a request to the Brain backend.
2. The proxy resolves `tenant_id` from the bearer JWT or the trusted tenant header for local development.
3. The `/push` endpoint enforces a per-tenant write limit before writing anything.
4. The proxy writes to the shared `public.tenant_connector_vault` table.
5. The `/query` endpoint reads the same shared table with tenant isolation and pagination.

## Runtime Components
- `Brain/main.py`
  - Mounts the proxy router.
  - Starts and stops the proxy HTTP client and maintenance worker.
- `Brain/modules/supabase_proxy/service.py`
  - Owns the persistent `httpx.AsyncClient`.
  - Verifies JWTs.
  - Talks to the company Supabase REST API.
  - Enforces write rate limits.
  - Tracks tenant activity.
  - Runs retention and idle cleanup.
- `Brain/modules/supabase_proxy/controller.py`
  - Exposes `/api/connector/push`, `/api/connector/query`, and `/api/connector/health`.
  - Uses Pydantic validation for request models.

## Shared Table Pattern
The data layer uses a single shared table:

- Table: `public.tenant_connector_vault`
- Columns:
  - `id`
  - `tenant_id`
  - `schema_name`
  - `record_data` JSONB
  - `created_at`
  - `updated_at`

This supports unlimited dynamic fields per tenant without creating a table per user.

## Pagination
Query pagination is supported through `limit` and `offset`.

Example:
- Page size: `100`
- Offset: `100`
- Returned range: records `100` through `199`

The proxy sends a PostgREST `Range` header so large tenants can page through more than 10,000 rows safely.

## Security
- JWTs are validated in the proxy.
- Only `HS256` is accepted for the proxy token check.
- The tenant identity is taken from the validated token, not from the frontend.
- Supabase service-role access stays server-side only.

## Rate Limiting
The `/push` route applies a per-tenant write ceiling using Redis-backed counters.

Default limit:
- `60` writes per minute per tenant

Purpose:
- Prevent a single tenant from exhausting the shared 500 MB Supabase free-tier storage.
- Protect all other tenants from noisy writes.

## Retention and Idle Cleanup
Two cleanup paths run in the background:

1. Global retention cleanup
   - Deletes rows older than `30` days by default.
2. Idle tenant cleanup
   - Tracks last activity per tenant in Redis.
   - If a tenant is idle for `30` minutes by default, its rows are purged from the shared vault.

Important:
- This removes tenant rows, not the table definition.
- The table remains in place so the shared architecture stays stable.

## Example Lifecycle
1. User signs in and receives a platform JWT.
2. Frontend calls `POST /api/connector/push` with `schema_name` and a JSON payload.
3. The proxy validates the user, checks the tenant rate limit, and writes the row.
4. Frontend later calls `GET /api/connector/query?schema_name=...&limit=100&offset=0`.
5. The proxy returns only rows for that tenant.
6. Background cleanup removes stale rows automatically.

## Environment Variables
- `COMPANY_SUPABASE_URL`
- `COMPANY_SUPABASE_SERVICE_ROLE_KEY`
- `CONNECTOR_PROXY_JWT_SECRET`
- `CONNECTOR_PROXY_ALLOW_TENANT_HEADER`
- `CONNECTOR_PROXY_WRITE_LIMIT_PER_MINUTE`
- `CONNECTOR_PROXY_IDLE_TTL_MINUTES`
- `CONNECTOR_PROXY_RETENTION_DAYS`
- `CONNECTOR_PROXY_MAINTENANCE_INTERVAL_SECONDS`
- `REDIS_URL`

## Operational Notes
- The proxy client is persistent for connection pooling.
- Network hiccups are retried automatically.
- Pagination is bounded to prevent oversized reads.
- Cleanup runs in the FastAPI lifecycle worker.
- If you scale to multiple worker processes, Redis remains the source of truth for rate-limit and activity tracking.
