# 09 — Dependencies

How Module 1 connects to the rest of Layer 2 and the infrastructure layer.

## Infrastructure It Consumes

| Resource | Purpose | Failure mode |
|---|---|---|
| **PostgreSQL 16** | All seven module tables ([03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md)) | DB down → 503 from all auth routes; cached blacklist still enforced |
| **Redis 7** | JTI blacklist, refresh-token negative cache, lockout counters, API-key cache | Redis down → fall back to Postgres for blacklist (slower); login still works |
| **Mailer (transactional)** | Email verify, password reset, ban notice | Mailer down → reset/verify endpoints return 202 with retry queued |
| **Google OAuth (Identity)** | ID-token verification via Google JWKS (`google-auth-library`) | Google JWKS unreachable → `/auth/google*` returns 503; cached JWKS keeps it up for ~6 h |
| **Captcha provider** | Cloudflare Turnstile (or hCaptcha) for `/auth/check-email` abuse threshold | Provider down → endpoint falls back to stricter IP rate limit |
| **Config / env** | JWT keys, argon2 params, TTLs, `GOOGLE_CLIENT_IDS` (web / ios / android), captcha secret | Missing key at boot → process refuses to start (fail-fast) |

The mailer is abstracted behind a `MailerService` interface so the concrete provider (Postmark, SES, Resend, …) can be swapped.

## Modules That Depend on Module 1

Every other Layer 2 module assumes `req.user`, `req.session`, and `req.platform` are already populated.

| Downstream module | Reads |
|---|---|
| Module 2 — Plan & Subscription | `req.user.id` to load active subscription |
| Module 3 — Feature Flags | `req.user.plan_id` (resolved via Module 2); also runs the per-feature usage-quota check (`requireFeatureWithLimit`) for webSearch / codeExecution before requests reach Module 5 |
| Module 4 — Credit Wallet | `req.user.id` for wallet lookup |
| Module 5 — Rate Limit | `req.user.id` (or `req.apiKey.id`) as the bucket key |
| Module 6 — Usage Tracking | `req.user.id`, `req.platform`, fingerprint for usage records |
| Module 7 — Message Queue | `req.user.id` written into BullMQ job |
| Module 8 — Conversation | `req.user.id` for ownership checks |
| Module 9 — Sanitiser | Reads `req.user.plan` for plan-scoped size limits (e.g. message length) |
| Module 10 — Smart Router | `req.user.plan.modelAccess`, `agentAccess` |

If `req.user` is missing on a route that requires it, the request is `401`'d before any downstream module runs.

## Modules Module 1 Depends On

**None at runtime.** Auth is the first link of the chain.

At setup it depends on:
- Migration runner (shared with all modules)
- Logger (`utils/logger.ts`)
- Error utility (`utils/errors.ts`)

It deliberately does **not** call into Plan, Wallet, or any business module. This avoids circular dependencies and keeps the auth path fast.

## Events Emitted

Module 1 publishes typed events on the in-process emitter (`events/auth.events.ts`). Other modules subscribe asynchronously — auth never `await`s a subscriber.

| Event | Payload | Subscribers (planned) |
|---|---|---|
| `auth.registered` | `{ userId, email, platform, ip, via: 'password' \| 'google' }` | Notification (welcome email), Wallet (grant free credits), Analytics |
| `auth.login` | `{ userId, sessionId, platform, deviceName, ip, fingerprint, isNewDevice, via: 'password' \| 'google' }` | Analytics, Notification (new-device email) |
| `auth.google_linked` | `{ userId, providerEmail }` | Notification (security email), Analytics |
| `auth.google_unlinked` | `{ userId }` | Notification, Analytics |
| `auth.email_check` | `{ emailHash, ip, suggestedAction }` | Analytics (signup-funnel) |
| `auth.login_new_device` | `{ userId, sessionId, platform, deviceName, ip }` | Notification (security email) |
| `auth.logout` | `{ userId, sessionId }` | Analytics |
| `auth.logout_all` | `{ userId, count }` | Analytics |
| `auth.profile_updated` | `{ userId, fields }` | Analytics |
| `auth.password_changed` | `{ userId, byActor }` | Notification (security email) |
| `auth.banned` | `{ userId, actorId, reason }` | Notification, Wallet (freeze), Analytics |
| `auth.unbanned` | `{ userId, actorId }` | Notification, Wallet (unfreeze) |
| `auth.impersonated` | `{ targetUserId, actorId, reason, jti }` | Analytics, Audit dashboard |

In-process events keep the single-server architecture simple. When the system splits across processes, the same emitter is replaced with a Redis pub/sub or BullMQ event topic — no module changes required because the contract is the typed payload, not the transport.

## Public Contract Recap

What downstream code can rely on:

```ts
// After requireAuth middleware:
req.user: {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin' | 'superadmin';
  status: 'active' | 'suspended';     // banned never reaches here
  email_verified_at: string | null;
  plan_id: string | null;             // populated by Module 2; null = not yet loaded
};

req.session: {                         // always present on authed routes
  id: string;
  platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
  device_name: string;
  fingerprint: string;
  issued_at: string;
};

req.platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
req.token: { jti: string; exp: number };
req.actor?: { id: string };            // present only on impersonation tokens
```

There is no `req.apiKey` and no API-key auth path. All requests are first-party Bearer JWT.

These shapes are exported from `src/types/auth.d.ts` so all downstream modules type-check against the same contract.

## Boot Order

```
1. Load env config (fail-fast on missing)
2. Initialise DB + Redis pools
3. Load JWT key pair from secret store
4. Run migrations (idempotent)
5. Mount middleware in fixed order: auth → admin → ...
6. Mount /auth and /admin/auth route files
7. Open HTTP listener
```

If any step fails, the process exits with a non-zero code. EasyPanel restarts it.
