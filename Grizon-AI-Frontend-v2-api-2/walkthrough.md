# Walkthrough - Connector Integration, Sandbox MCP Fixes, and Cloudflare Tunneling

We have completed the frontend integration of the Supabase and GitHub connectors, resolved the FastAPI backend startup/crash issues when MCP is unconfigured, and provided a local Cloudflare Tunnel script to expose the application to the web for OAuth callbacks.

## Changes Made

### 1. Backend Sandbox MCP Crash Resilience
- **Problem**: When `SANDBOX_MCP_URL` or `SANDBOX_MCP_TOKEN` was missing from `.env`, the FastAPI backend threw a `RuntimeError` on startup or during the chat workflow stream (`node_init_sandbox`), causing the server/stream to fail, leading to `ECONNREFUSED` issues on the frontend.
- **Fix**:
  - [sandbox_mcp_service.py](file:///c:/Users/hp/Documents/brain/universal-brain/grizon-ai-backend-2-main/Brain/services/sandbox_mcp_service.py): Modified `initialize` to log a warning and mark the service as uninitialized instead of throwing a hard error. If any remote tools are called when the service is uninitialized, it now throws a clean `RuntimeError` rather than failing during bootstrap/stream initiation. This allows local files/WebContainer builds to run perfectly without crashing the backend.

### 2. Frontend Connections Tab Integration & TypeScript Fixes
- **Fix**:
  - [SettingsView.tsx](file:///c:/Users/hp/Documents/brain/universal-brain/Grizon-AI-Frontend-v2-api-2/components/chat/SettingsView.tsx): Imported and integrated the `SettingsConnectionsPanel` component into the settings sections rendering block. Removed the duplicate/redundant `'connections'` check at the tail of the switch chain, which was triggering a type-narrowing compiler error.
  - [types.ts](file:///c:/Users/hp/Documents/brain/universal-brain/Grizon-AI-Frontend-v2-api-2/lib/types.ts) & [AuthContext.tsx](file:///c:/Users/hp/Documents/brain/universal-brain/Grizon-AI-Frontend-v2-api-2/context/AuthContext.tsx): Declared and exposed `getAccessToken` in `AuthContextType` so that canvas and connector components can securely read the current auth token in memory without triggering compile-time errors.
  - [SettingsConnectionsPanel.tsx](file:///c:/Users/hp/Documents/brain/universal-brain/Grizon-AI-Frontend-v2-api-2/components/settings/SettingsConnectionsPanel.tsx): Added query parameters checking inside the component so that returning from an OAuth flow callback displays a clean success or error notification banner.

### 3. OAuth Callback Redirect landing
- **Fix**:
  - [page.tsx](file:///c:/Users/hp/Documents/brain/universal-brain/Grizon-AI-Frontend-v2-api-2/app/(main)/integrations/page.tsx): Created a clean landing page for the `/integrations` route which receives the OAuth redirects from the Python backend and seamlessly forwards the user to `/settings/connections` with the appropriate status details in the URL.

### 4. Cloudflare Tunnel Provisioning
- **Fix**:
  - [cloudflare-tunnel.ps1](file:///c:/Users/hp/Documents/brain/universal-brain/cloudflare-tunnel.ps1): Added a local PowerShell script that downloads standalone `cloudflared.exe` (if missing) and starts two background tunnels:
    - Frontend tunnel pointing to `http://localhost:3000`
    - Backend tunnel pointing to `http://127.0.0.1:8001`
  - It prints the generated tunnel URLs so you can configure backend and provider credentials for testing OAuth callbacks locally.

---

## Verification Results

- Verified zero typescript errors by running `npx tsc --noEmit`.
- Verified that backend responds correctly to `/health` and `/brain/projects` requests via the Next.js proxy rewrite mapping without any `ECONNREFUSED` crashes.
