# LLM Prompt: Implement a New Module in `grizon-ai-backend-2`

Use this prompt when asking Claude/Cursor/any LLM to add or extend backend modules in this repo.

## Prompt

You are implementing a new backend module in `grizon-ai-backend-2`.

Follow these rules strictly:

1. Source of truth priority:
   - `docs/Layer 2 Modules/*` (module contracts)
   - `docs/Project Foundation/*` (cross-cutting standards)
   - `docs/PROJECT_ARCHITECTURE.md` and `docs/LAYER2_API_GATEWAY.md` (system constraints)
2. Do not invent or alter API paths, request/response shapes, status codes, auth rules, or error codes beyond docs.
3. Keep all responses in the universal envelope from `docs/Project Foundation/03_REQUEST_RESPONSE.md`.
4. Use `AppError`/`Errors.*` patterns from `docs/Project Foundation/04_ERROR_HANDLING.md` and existing `src/utils/errors.ts`.
5. Update supporting artifacts when API surface changes:
   - relevant module status report in `docs/Layer 2 Modules/...`
   - `grizon-ai-backend-2.postman_collection.json`

### Current API Mounts and Route Split

- Root router: `src/routes/index.ts`
  - `GET /`
  - `GET /health`
  - `rootRouter.use("/api/v1", userRoutes)`
  - `rootRouter.use("/api/v1/admin", adminRoutes)`
- User routes: `src/routes/user/*` (`/api/v1/...`)
- Admin routes: `src/routes/admin/*` (`/api/v1/admin/...`)
- Module 3 note: Feature gating is middleware-only (`requireFeature`, `requireFeatureWithLimit`) and does not add route mounts.
- Postman groups currently include:
  - `Foundation Routes`
  - `Module 1 - User Auth Contracts`
  - `Module 1 - Admin Auth Contracts`
  - `Module 2 - User Plan Contracts`
  - `Module 2 - Admin Plan Contracts`
  - `Module 4 - User Wallet Contracts`
  - `Module 4 - Admin Wallet Contracts`
  - `Module 5 - Admin RateLimit Contracts`
  - `Module 6 - User Usage Contracts`
  - `Module 6 - Admin Analytics Contracts`
- `Module 7 - User Chat Contracts`
- `Module 7 - Admin Queues Contracts`

### Middleware Stack and How to Use It

Global middleware order is defined in `src/app.ts` (this is the **canonical, locked** order — do not reorder without updating this doc, every Module 1–6 plan, and the corresponding test scaffolding):

1. `requestId`
2. `authMiddleware`
3. `adminMiddleware`
4. `requestLogger`
5. `helmet()`
6. `corsMiddleware`
7. `express.json()`
8. `planMiddleware`
9. `featureFlagMiddleware`
10. `rateLimitMiddleware`         ← **before** credit budget so denied requests don't burn pending wallet holds
11. `creditBudgetMiddleware`      ← runs only after rate-limit clears, so a pending hold maps 1:1 to an attempted LLM call
12. `sanitiserMiddleware`
13. `rootRouter`
14. `errorHandler`

Module 9 note:
- `sanitiserMiddleware` may mutate `req.body.content` and configured HTML fields before route handlers parse with Zod.

Module 10 note:
- Module 10 (Smart Router) runs inside `chat.worker.ts` after the global pipeline; it does not add or reorder middleware.

Why slot 10 is rate-limit and slot 11 is credit budget (locked decision):
- A user who is already over their RPM/daily quota must not have a `wallets.pending` hold opened — that would understate `spendable` until the janitor releases it 30 min later.
- A burst of denials should surface as `RATE_LIMIT_EXCEEDED`, not as `INSUFFICIENT_CREDITS` triggered by stacked-up holds.
- Hard caps (correctness of money) live downstream; soft caps (admission control) run first.

Usage expectations:
- `authMiddleware` (`src/gateway/auth.middleware.ts`)
  - Requires `x-platform` (`web | admin | mobile-ios | mobile-android`) except health shortcuts.
  - Rejects `x-platform: admin` on **`/api/v1/auth/*`** (consumer auth namespace); admin auth lives under **`/api/v1/admin/auth/*`**.
  - Allows defined public paths without Bearer token.
  - For protected routes: validates Bearer token, session, and user status; sets `req.user`, `req.session`, `req.token`.
- `adminMiddleware` (`src/gateway/admin.middleware.ts`)
  - Applies to `/api/v1/admin/*`.
  - Requires `req.platform === "admin"` and user role `admin` or `superadmin`.
- Route-level admin hardening:
  - `requireAdmin` for admin-only operations.
  - `requireSuperadmin` for superadmin-only operations (example: impersonation endpoint).
- `errorHandler` must remain final middleware and shape all failures into standard envelope.

### Implementation Steps for Any New Module

1. Read and align contracts in docs before coding.
2. Add route file(s) under:
   - `src/routes/user/` for user-facing APIs
   - `src/routes/admin/` for admin APIs
3. Register new route mounts in:
   - `src/routes/user/index.ts` or
   - `src/routes/admin/index.ts`
4. Keep handlers thin; move business logic to `src/services/*`.
5. Validate inputs (Zod), then map validation failures to `VALIDATION_FAILED`.
6. Return via shared response helpers (`ok`, `created`, `fail`) from `src/utils/response.ts`.
7. Apply proper auth/role middleware based on route type (public/user/admin/superadmin).
8. Add/adjust tests in `test/unit` and `test/integration`.
9. Update module status report + Postman collection entries for every added/changed endpoint.

### Route Classification Rules

- Public: only explicitly allowlisted paths (for example health and specific auth endpoints).
- User-protected: under `/api/v1/*`, requires Bearer token unless public allowlist.
- Admin: under `/api/v1/admin/*`, requires `x-platform: admin` + admin role.
- Superadmin-sensitive: explicit `requireSuperadmin` on selected admin routes.

### Expected Output Format from You (LLM)

When you respond, provide:
1. Files to create/modify
2. Route list (method + path)
3. Middleware/authorization applied per route
4. Request/response schema summary (must match envelope)
5. Tests added
6. Postman and docs updates
7. Any detected docs-vs-code conflict (stop and flag it explicitly)

