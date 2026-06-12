# 04 — Access Control

How Module 1 enforces *who can do what*. Combines role, account status, platform header, and (for API keys) scopes.

## Roles

```ts
enum UserRole {
  USER       = 'user',        // standard end user (web app)
  ADMIN      = 'admin',       // full admin panel access
  SUPERADMIN = 'superadmin'   // can manage other admins + dangerous ops
}
```

Role lives on `users.role`. A role change immediately invalidates all existing access tokens for that user (admin force-logout is triggered as part of the role-change transaction).

## Account Status

```ts
type UserStatus = 'active' | 'banned' | 'suspended';
```

| Status | Effect on auth |
|---|---|
| `active` | Normal |
| `banned` | All login attempts return `403`. Existing sessions are revoked. JTIs added to blacklist. |
| `suspended` | Read-only login allowed; mutating routes return `403`. Used for billing past-due cases. |

## Middleware Chain

Module 1 contributes the first three middleware in the global pipeline. Order is fixed:

```
Request
  ↓
1. auth.middleware                 ← always first; sets req.user, req.session, req.token
  ↓
2. platform guard (inline)         ← x-platform header must match route group
  ↓
3. admin.middleware (admin routes) ← requireAdmin / requireSuperadmin
  ↓
[Module 2+ middleware, in order: plan → feature flag → feature limit → rate limit → credit budget → sanitiser]
  ↓
Route handler
```

All requests authenticate via Bearer JWT. There is no API-key path — programmatic / third-party API access is not part of the product.

Public auth routes (`/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/email/verify/confirm`) bypass step 1. They have their own per-route validation and brute-force gating.

## Middleware Reference

### `requireAuth` (default for all `/api/v1/*`)

```ts
export function requireAuth(req, res, next) {
  // 1. Extract Bearer token
  // 2. tokenService.verify(jwt) → throws on bad signature/exp/iss/aud
  // 3. Check Redis blacklist auth:blacklist:{jti}
  // 4. Load user; ensure status === 'active' (or 'suspended' for read-only routes)
  // 5. Attach req.user, req.token, req.session
}
```

Failure → `401 Unauthorized` with `{ error: 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'TOKEN_REVOKED' | 'USER_BANNED' }`.

### `requireAdmin` (mounted on `/api/v1/admin/*`)

```ts
export function requireAdmin(req, res, next) {
  if (!['admin', 'superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'ADMIN_REQUIRED' });
  next();
}
```

### `requireSuperadmin` (per-route)

Stricter sibling. Used on dangerous endpoints marked `[SA]` in [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md).

## Platform Header

Every request must declare its origin:

```
x-platform: web | admin | mobile-ios | mobile-android
```

| Route group | Allowed values |
|---|---|
| `/api/v1/auth/*` | `web`, `admin`, `mobile-ios`, `mobile-android` |
| `/api/v1/admin/*` | `admin` only |

Mismatch → `400 PLATFORM_MISMATCH`. The value is persisted on the `refresh_tokens` row created at login (so the sessions list shows which platform each device signed in from) and recorded in `auth_audit.metadata.platform`.

A user can be signed in concurrently from any combination of platforms; each is its own `refresh_tokens` row.

## RBAC Matrix

A "✓" means the role can perform the action; "—" means denied (`403`).

| Action | user | admin | superadmin |
|---|---|---|---|
| Email pre-check (`/auth/check-email`) | public | public | public |
| Register, login, refresh, logout (own) | ✓ | ✓ | ✓ |
| Sign in / sign up via Google | ✓ | ✓ | ✓ |
| Link / unlink Google to own account | ✓ | ✓ | ✓ |
| View / edit own profile (name, bio, avatar) | ✓ | ✓ | ✓ |
| Change own password | ✓ | ✓ | ✓ |
| List own active devices (multi-device sessions) | ✓ | ✓ | ✓ |
| Revoke a specific own device | ✓ | ✓ | ✓ |
| Revoke all own devices (logout-all) | ✓ | ✓ | ✓ |
| List all users | — | ✓ | ✓ |
| Ban / unban a user | — | ✓ | ✓ |
| Force-logout a user | — | ✓ | ✓ |
| Admin-initiated password reset | — | ✓ | ✓ |
| Read system-wide audit log | — | ✓ | ✓ |
| Revoke any user's session | — | ✓ | ✓ |
| Promote a user to `admin` | — | — | ✓ |
| Demote / remove an `admin` | — | — | ✓ |
| Impersonate any user | — | — | ✓ |
| Rotate JWT signing key | — | — | ✓ |
| Flush blacklist / audit (operational) | — | — | ✓ |

## Error Code Reference (auth-related)

| Code | HTTP | Meaning |
|---|---|---|
| `NOT_AUTHENTICATED` | 401 | No credentials provided |
| `INVALID_TOKEN` | 401 | JWT signature/issuer/audience invalid |
| `TOKEN_EXPIRED` | 401 | Access token past `exp` |
| `TOKEN_REVOKED` | 401 | JTI in blacklist |
| `USER_BANNED` | 403 | `users.status = 'banned'` |
| `ACCOUNT_LOCKED` | 423 | `locked_until > now()` |
| `EMAIL_NOT_VERIFIED` | 403 | Route requires verified email |
| `ADMIN_REQUIRED` | 403 | Non-admin hitting `/admin/*` |
| `SUPERADMIN_REQUIRED` | 403 | Non-superadmin hitting `[SA]` endpoint |
| `PLATFORM_MISMATCH` | 400 | `x-platform` not allowed for route |
| `INVALID_GOOGLE_TOKEN` | 400 | Google ID token failed signature/issuer/audience check |
| `GOOGLE_EMAIL_NOT_VERIFIED` | 400 | Google profile lacks `email_verified=true` |
| `GOOGLE_ALREADY_LINKED` | 409 | This Google account is linked to a different user |
| `ALREADY_LINKED` | 409 | The current user already has Google linked |
| `LAST_SIGN_IN_METHOD` | 400 | Refused to unlink Google because it's the only sign-in method |
| `CAPTCHA_REQUIRED` | 403 | Email-check rate-limit threshold exceeded; captcha token required |
