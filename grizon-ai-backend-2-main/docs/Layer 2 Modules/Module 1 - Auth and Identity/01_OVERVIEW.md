# 01 — Overview

## Mission

Module 1 is the **front door** of the API. It establishes *who* is making a request, *from where*, and *with what authority*, then attaches that identity to the request object so every downstream module (plans, wallet, rate limit, agents) can trust it without re-deriving it. Nothing reaches a route handler without first passing through this module.

## Responsibilities

- **Credential exchange** — register, login, password change/reset, email verification
- **Google sign-in / sign-up** — accept a Google ID token (Web GIS or native Google Sign-In), verify it, then either log in an existing account or create a new one. Existing accounts can also link/unlink Google as a second sign-in method.
- **Email pre-check** — single endpoint the frontend calls with an email address before showing the password screen, so it can route the user to "Sign in", "Sign up", or "Continue with Google" without a second round-trip
- **Token lifecycle** — issue access JWTs (RS256, 15 min) and refresh tokens (30 d), rotate refresh tokens on every use
- **Token verification** — verify signature, expiry, issuer, audience, and blacklist on every request
- **Multi-device session tracking** — a single user can be signed in concurrently on many devices and platforms; one `refresh_tokens` row represents one device. The user can list every active device, see metadata (platform, device type, IP, last-used), and revoke any one or all of them.
- **Cross-platform identity** — the same account works across web, future mobile apps, etc. The `x-platform` header tells the backend which surface a request came from; sessions are scoped per-device, not per-platform.
- **User profile** — name, bio/description, avatar; editable by the owner
- **Role enforcement** — `requireAuth`, `requireAdmin`, `requireSuperadmin` middleware
- **Device fingerprinting** — hash of UA + IP-prefix + accept-language for audit and "new device" detection
- **Audit logging** — every login, logout, password change, ban, impersonation
- **Brute-force defence** — per-user lockout after N failed logins
- **Identity admin actions** — admin-side ban/unban/reset/impersonate

> **Out of scope by product decision:** programmatic API access. There are no API keys, no `X-API-Key` header, no scopes. All requests are first-party user sessions originating from our own apps.

## Non-Responsibilities

These belong to other Layer 2 modules and **must not** leak into Module 1:

| Concern | Owner |
|---|---|
| Plan loading & capability matrix | Module 2 (Plan & Subscription) |
| Feature flag check | Module 3 (Feature Flag Engine) |
| Credit balance / wallet | Module 4 (Credit Wallet) |
| Rate limiting (RPM, daily, etc.) | Module 5 (Rate Limit) |
| Usage / cost tracking | Module 6 (Usage Tracking) |
| Input sanitisation beyond auth payloads | Module 9 (Sanitiser) |

Module 1 only validates its **own** request bodies (login, register, etc.).

## Inputs

| Source | What it carries |
|---|---|
| `Authorization: Bearer <jwt>` header | Access token (every authed route) |
| `x-platform` header | `web` \| `admin` \| `mobile-ios` \| `mobile-android` (enforced per route group) |
| `x-device-name` header *(optional)* | Human-readable device label shown in the sessions list (e.g. "Maulik's MacBook"). Falls back to a derived value from user-agent. |
| Refresh-token body on `/auth/refresh` | Long-lived rotation token |
| Cookies | **Not used** — Bearer-only |

## Outputs (attached to `req`)

```ts
req.user      // { id, email, name, bio, avatar_url, role, status, plan_id, email_verified_at, ... }
req.session   // { id, device_name, platform, fingerprint, issued_at, expires_at }   ← refresh-token row
req.platform  // 'web' | 'admin' | 'mobile-ios' | 'mobile-android'
req.token     // { jti, exp }                                  ← decoded access JWT
```

Once these are set, downstream middleware reads them as the canonical identity. They are populated **before** any other middleware runs.

## Module Touchpoints (text diagram)

```
                    ┌────────────────────────┐
                    │   Module 1: Auth       │
                    │   (this module)        │
                    └──────────┬─────────────┘
                               │ attaches req.user, req.session, req.platform
                               ▼
        ┌──────────┬──────────┬──────────┬──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼          ▼
   Module 2    Module 3   Module 4   Module 5   Module 6   Module 9
   Plan        Feature    Wallet     Rate       Usage      Sanitiser
   resolver    flags      balance    limit      tracker    (per-route)
```

## Public Surface (1-line summary)

- 18 user endpoints under `/api/v1/auth/*` (incl. `/auth/check-email` and 3 Google routes)
- 11 admin endpoints under `/api/v1/admin/auth/*`
- 2 middleware: `auth`, `admin`
- 6 services: `auth`, `token`, `password`, `oauth`, `audit`, `session`

Detailed in [02_FILE_STRUCTURE.md](02_FILE_STRUCTURE.md), [05_USER_API_CONTRACTS.md](05_USER_API_CONTRACTS.md), [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md).
