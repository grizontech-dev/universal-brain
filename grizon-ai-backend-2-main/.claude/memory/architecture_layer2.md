---
name: Layer 2 Architecture — Backend Gateway
description: The 12 modules, their responsibilities, and all key design decisions for the API/backend layer
type: project
originSessionId: 0c9d0c8e-5e36-4f0a-89fe-e618574d9cee
---
The backend is a single Express/TypeScript server with 12 clearly defined modules. Full spec is in `/docs/LAYER2_API_GATEWAY.md`.

**Request lifecycle (strict order):**
Auth → Plan Resolver → Feature Flag Check → Rate Limit (4 windows) → Credit Budget Check → Sanitiser → Queue (BullMQ) → Smart Router → Agent + LLM → Usage Recording

**12 Modules:**
1. Auth & Identity — JWT RS256, 15min access / 30day refresh, Redis blacklist, roles: user/admin/superadmin
2. Plan & Subscription — Immutable plans (archive, never edit live), monthly/annual billing, credit rollover, plan snapshots frozen at subscribe time
3. Feature Flag Engine — 16 flags per plan (webSearch, smartSynthesizer, documentCreation, codeExecution, modelPicker, voiceMode, apiAccess, etc.)
4. Credit Wallet — Formula: `ceil((input+output tokens) × model_rate × agent_multiplier × plan_discount)`. All rates stored in DB, admin-editable without code changes
5. Rate Limiting — 4 sliding windows: Hourly/Daily/Weekly/Monthly. Redis sorted sets. 3 hits/10min → 15min cooldown → flagged for review
6. Usage Tracking — 20+ fields per message: token breakdown (fresh/cached), credits, agent, model, platform, feature flags, latency metrics, success/fail
7. Message Queue (BullMQ) — Jobs survive tab close. SSE reconnectable via GET /chat/stream/{jobId}. Heartbeat every 15s
8. Conversation & Messages — Rich structure: files linked per message, artifacts linked to generating message, feature tags, token/credit per message, rolling summarisation at 60%/85% context
9. Sanitiser — Zod validation, prompt injection strip, per-plan message length limits, file type whitelist
10. Smart Router — Classify intent → complexity → plan-gated agent selection → query rewriting for search
11. User API — base: /api/v1/
12. Admin API — base: /api/v1/admin/ (agent prompt editing is superadmin-only)

**API split:** User API (`/api/v1/`) vs Admin API (`/api/v1/admin/`) — hard separation, different middleware stacks.

**How to apply:** When building any module, reference this order. Never skip the rate limit or credit check. Queue dispatch comes BEFORE the smart router — the router runs inside the worker, not in the HTTP handler.
