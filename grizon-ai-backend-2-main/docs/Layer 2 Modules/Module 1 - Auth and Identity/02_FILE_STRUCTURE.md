# 02 — File Structure

Every file owned by Module 1, where it lives, and what it does. Paths are relative to the repo root (`src/...`).

## Tree

```
src/
├── config/
│   └── auth.ts                            ← JWT keys, TTLs, argon2 params, lockout policy
│
├── gateway/                               ← Express middleware (run in pipeline order)
│   ├── auth.middleware.ts                 ← Bearer JWT verify + req.user load
│   └── admin.middleware.ts                ← requireAdmin, requireSuperadmin
│
├── services/                              ← Business logic, called from routes
│   ├── auth.service.ts                    ← register / login / refresh / logout / change-pw
│   ├── token.service.ts                   ← sign / verify / rotate / blacklist
│   ├── password.service.ts                ← argon2id hash + verify
│   ├── oauth.service.ts                   ← Google ID-token verify + link/unlink
│   ├── profile.service.ts                 ← read / update name, bio, avatar
│   ├── audit.service.ts                   ← write to auth_audit
│   └── session.service.ts                 ← refresh-token CRUD, list/revoke devices (multi-device)
│
├── routes/
│   ├── user/
│   │   └── auth.routes.ts                 ← /api/v1/auth/* (14 endpoints)
│   └── admin/
│       └── auth.routes.ts                 ← /api/v1/admin/auth/* (11 endpoints)
│
├── db/
│   └── migrations/
│       ├── 001_users.sql
│       ├── 002_refresh_tokens.sql
│       ├── 003_token_blacklist.sql
│       ├── 004_auth_audit.sql
│       ├── 005_password_reset_tokens.sql
│       ├── 006_email_verification_tokens.sql
│       └── 007_oauth_accounts.sql
│
├── utils/
│   ├── fingerprint.ts                     ← SHA-256(UA + ip-prefix + accept-language)
│   ├── jwt.ts                             ← thin wrapper around `jose` for RS256
│   └── secureRandom.ts                    ← crypto.randomBytes wrappers
│
└── events/
    └── auth.events.ts                     ← typed emitter: auth.login, auth.banned, ...
```

## File-by-File

### Config

| File | Purpose | Exports |
|---|---|---|
| `src/config/auth.ts` | Single source of truth for auth knobs. Loaded once at boot, validated with Zod. | `accessTtl`, `refreshTtl`, `argon2Params`, `lockoutPolicy`, `jwtIssuer`, `jwtAudience`, `privateKey`, `publicKey`, `kid` |

### Middleware

| File | Mounts on | Behaviour |
|---|---|---|
| `auth.middleware.ts` | All `/api/v1/*` except public auth routes | Reads `Authorization: Bearer …`, calls `tokenService.verify`, checks blacklist, loads user, attaches `req.user` + `req.session` + `req.token`. Returns `401` on any failure. |
| `admin.middleware.ts` | All `/api/v1/admin/*` | Runs after `auth.middleware`. Asserts `req.user.role` is `admin` or `superadmin`. `requireSuperadmin` is a stricter sibling. Returns `403` on mismatch. |

### Services

| File | Responsibility | Key methods |
|---|---|---|
| `auth.service.ts` | Orchestrates user-facing auth flows | `register()`, `login()`, `refresh()`, `logout()`, `logoutAll()`, `changePassword()`, `forgotPassword()`, `resetPassword()`, `requestEmailVerify()`, `confirmEmailVerify()` |
| `token.service.ts` | Stateless JWT sign + stateful blacklist | `signAccess()`, `signRefresh()`, `verify()`, `rotateRefresh()`, `blacklist()`, `isBlacklisted()` |
| `password.service.ts` | Password hashing primitives | `hash()`, `verify()`, `needsRehash()` |
| `oauth.service.ts` | Verifies Google ID tokens (`google-auth-library`), maps `sub`+`email` to a user, creates new accounts on first sign-in, links/unlinks Google to an existing user | `verifyGoogleIdToken()`, `signInOrSignUp()`, `link()`, `unlink()` |
| `profile.service.ts` | Read + update profile fields (name, bio, avatar) | `get(userId)`, `update(userId, patch)` |
| `audit.service.ts` | Append-only auth_audit writer | `record(event, ctx)` |
| `session.service.ts` | Refresh-token CRUD = the device list. Multi-device aware: a user can have N concurrent rows (one per signed-in device) across web / admin / mobile platforms. | `create()`, `find()`, `revoke()`, `revokeAll()`, `listForUser()`, `markCurrent()` |

### Routes

| File | Prefix | Count |
|---|---|---|
| `routes/user/auth.routes.ts` | `/api/v1/auth` | 18 endpoints — see [05_USER_API_CONTRACTS.md](05_USER_API_CONTRACTS.md) |
| `routes/admin/auth.routes.ts` | `/api/v1/admin/auth` | 11 endpoints — see [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md) |

### Migrations

One file per table. Migrations are forward-only; schema changes are additive. See [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md) for full DDL.

### Utils

| File | Purpose |
|---|---|
| `fingerprint.ts` | `fingerprint(req): string` — deterministic device hash for audit + reuse detection |
| `jwt.ts` | Thin wrapper around `jose` so the rest of the codebase never imports `jose` directly |
| `secureRandom.ts` | `randomToken(bytes)` — opaque tokens for refresh, reset, verification |

### Events

`auth.events.ts` defines a typed emitter consumed by the analytics + notification modules. Events emitted: `auth.login`, `auth.logout`, `auth.password_changed`, `auth.banned`, `auth.unbanned`, `auth.impersonated`, `auth.api_key_issued`, `auth.api_key_revoked`. See [09_DEPENDENCIES.md](09_DEPENDENCIES.md).

## Test Files (parallel tree under `test/`)

```
test/
├── unit/
│   ├── token.service.test.ts
│   ├── password.service.test.ts
│   ├── profile.service.test.ts
│   └── fingerprint.test.ts
└── integration/
    ├── auth.user.routes.test.ts
    ├── auth.admin.routes.test.ts
    ├── multi-device-login.test.ts        ← N concurrent sessions across platforms
    ├── refresh-rotation.test.ts          ← reuse-detection scenarios
    └── lockout.test.ts
```
