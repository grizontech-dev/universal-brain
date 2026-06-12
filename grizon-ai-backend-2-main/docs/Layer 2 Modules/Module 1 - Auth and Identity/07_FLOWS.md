# 07 — Flows

End-to-end sequence diagrams for every auth scenario. Actors:

- **C** — Client (browser / mobile / API consumer)
- **A** — API server (Module 1 middleware + services)
- **DB** — Postgres
- **R** — Redis
- **M** — Mailer (transactional email)

---

## 1. Registration + Email Verification

```
C ──POST /auth/register──▶ A
                          A: validate body (Zod)
                          A: enforce email uniqueness (DB)
                          A: argon2id hash password
A ──INSERT users──────────▶ DB
A ──INSERT email_verification_tokens──▶ DB
A ──auth.events.register──▶ (analytics)
A ──send verify email────▶ M
A ──issue access + refresh──
A ──INSERT refresh_tokens──▶ DB
C ◀──{user, tokens}──── A

(later, user clicks email link)
C ──POST /auth/email/verify/confirm {token}──▶ A
                          A: hash token, lookup row
                          A: check expires_at > now, used_at IS NULL
A ──UPDATE users.email_verified_at──▶ DB
A ──UPDATE token.used_at─▶ DB
C ◀──{ email_verified_at }── A
```

---

## 2. Login (happy path)

```
C ──POST /auth/login──▶ A
                       A: load user by email_normalised
                       A: assert status='active', locked_until IS NULL OR < now
                       A: argon2id.verify(password, hash)
                       A: reset failed_login_attempts → 0
A ──UPDATE users.last_login_*──▶ DB
                       A: family_id = uuid
A ──INSERT refresh_tokens(family_id)──▶ DB
                       A: sign access JWT (jti, exp 15m)
A ──auth.events.login──▶ (analytics)
A ──INSERT auth_audit──▶ DB
C ◀──{user, access, refresh}── A
```

## 2b. Login (failed)

```
C ──POST /auth/login (wrong password)──▶ A
A ──UPDATE users SET failed_login_attempts = failed_login_attempts + 1──▶ DB
                       A: if failed_login_attempts >= 5 within 15 min:
                          locked_until = now + 15min
                          INSERT auth_audit('account_locked')
A ──INSERT auth_audit('login_failed')──▶ DB
C ◀── 401 INVALID_CREDENTIALS  (or 423 ACCOUNT_LOCKED)
```

---

## 3. Refresh Rotation with Reuse Detection

```
C ──POST /auth/refresh {refresh_token=T_old}──▶ A
                       A: hash T_old → token_hash
A ──SELECT refresh_tokens WHERE token_hash──▶ DB
                       Two cases:

Case A — token is active (revoked_at IS NULL):
                       A: generate T_new (same family_id)
A ──INSERT refresh_tokens(T_new)──▶ DB
A ──UPDATE T_old SET revoked_at=now, replaced_by=T_new.id, revoke_reason='rotated'──▶ DB
                       A: sign new access JWT
C ◀──{access, refresh=T_new}── A

Case B — token is already revoked (REUSE!):
                       A: revoke EVERY refresh in this family_id
A ──UPDATE refresh_tokens SET revoked_at=now, revoke_reason='reuse_detected' WHERE family_id──▶ DB
                       A: blacklist all currently active access JTIs
                          for that user (query Redis index)
A ──INSERT auth_audit('refresh_reuse_detected')──▶ DB
C ◀── 401 TOKEN_REUSED  (user must re-login)
```

The reuse-detection rule means a stolen refresh token is at most usable until the legitimate client next refreshes — at which point both tokens are killed.

---

## 4. Logout (single device)

```
C ──POST /auth/logout {refresh_token}──▶ A   (Bearer JWT also present)
A ──UPDATE refresh_tokens.revoked_at──▶ DB
A ──SADD auth:blacklist:{jti} TTL=remaining_exp──▶ R
A ──INSERT token_blacklist (Postgres mirror)──▶ DB
A ──INSERT auth_audit('logout')──▶ DB
C ◀── 204
```

## 4b. Logout-all

```
C ──POST /auth/logout-all──▶ A   (Bearer)
A ──UPDATE refresh_tokens SET revoked_at=now WHERE user_id AND revoked_at IS NULL──▶ DB
A ──for every active jti in auth:user_jtis:{user_id}: SADD auth:blacklist──▶ R
A ──INSERT auth_audit('logout_all')──▶ DB
C ◀── 204
```

---

## 5. Forgot / Reset Password

```
C ──POST /auth/password/forgot {email}──▶ A
                       A: lookup user (silent if not found — no enumeration)
                       A: generate opaque token T (32 bytes), hash
A ──INSERT password_reset_tokens(token_hash, expires_at=now+30m)──▶ DB
A ──send email with link?token=T──▶ M
C ◀── 200 { ok: true }   (always)

(user opens link)
C ──POST /auth/password/reset {token, new_password}──▶ A
                       A: hash token, find row, assert not used + not expired
                       A: argon2id new password
A ──UPDATE users SET password_hash, password_changed_at──▶ DB
A ──UPDATE password_reset_tokens SET used_at──▶ DB
A ──UPDATE refresh_tokens SET revoked_at=now WHERE user_id──▶ DB  (revoke ALL sessions)
A ──blacklist all active JTIs for user──▶ R
A ──issue fresh tokens for THIS request's device──▶ DB
A ──INSERT auth_audit('password_reset_completed')──▶ DB
C ◀── { access, refresh }
```

---

## 6. Multi-Device Login & Session Management

A single account can be signed in concurrently on many devices and platforms (web, admin, iOS, Android). Each signed-in device is exactly one row in `refresh_tokens`.

```
Device #1 (laptop, web)
  C₁ ──POST /auth/login (x-platform: web, x-device-name: "MacBook · Chrome")──▶ A
  A ──INSERT refresh_tokens(family_id=F1, platform='web', device_name=..., os, browser)──▶ DB
  C₁ ◀── { access₁, refresh₁ }

Device #2 (iPhone)
  C₂ ──POST /auth/login (x-platform: mobile-ios, x-device-name: "iPhone 15")──▶ A
  A ──INSERT refresh_tokens(family_id=F2, platform='mobile-ios', device_name=..., os='iOS 17', app_version='1.4.0')──▶ DB
  A ──auth.events.login_new_device──▶ (notification: optional security email)
  C₂ ◀── { access₂, refresh₂ }

Device #3 (Android tablet)
  …same shape, family_id=F3, platform='mobile-android'…

users.id = U  →  refresh_tokens (active):
                   ┌──────────────────────────────────────────────┐
                   │ row₁: F1 · web      · "MacBook · Chrome"     │
                   │ row₂: F2 · ios      · "iPhone 15"            │
                   │ row₃: F3 · android  · "Pixel Tablet"         │
                   └──────────────────────────────────────────────┘

Listing:
  C ──GET /auth/sessions──▶ A
  A ──SELECT * FROM refresh_tokens WHERE user_id=U AND revoked_at IS NULL──▶ DB
  C ◀── { sessions: [row₁, row₂, row₃] }   (is_current=true on the calling device's row)

Revoke one device (e.g. lost phone):
  C₁ ──DELETE /auth/sessions/<row₂.id>──▶ A
  A ──UPDATE refresh_tokens SET revoked_at=now WHERE id=row₂.id AND user_id=U──▶ DB
  A ──blacklist row₂'s active access JTI──▶ R
  A ──INSERT auth_audit('admin_session_revoked' OR 'logout' depending on actor)──▶ DB
  C₁ ◀── 204

  Device #2 next request → 401 TOKEN_REVOKED → app shows login screen.

Logout-all (panic button):
  C ──POST /auth/logout-all──▶ A
  A ──UPDATE refresh_tokens SET revoked_at=now WHERE user_id=U AND revoked_at IS NULL──▶ DB
  A ──blacklist every active JTI for U──▶ R
  C ◀── 204

  Every other device gets kicked on its next request.
```

Refresh rotation (§3) and reuse detection operate **per row / per family**, so a stolen token on one device cannot affect the others.

---

## 7. Admin Impersonation

```
SA ──POST /admin/auth/users/:id/impersonate {reason}──▶ A
                        A: requireSuperadmin
                        A: assert target.role NOT IN ('superadmin')
                        A: sign short-lived JWT:
                           sub = target.id
                           act = { sub: SA.id }
                           exp = now + 5min
                           no refresh issued
A ──INSERT auth_audit('admin_impersonate_start', actor=SA, user=target)──▶ DB
SA ◀── { access_token, expires_in: 300, impersonates }

SA ──any /api/v1/* with impersonation token──▶ A
                        A: auth.middleware sees `act` claim
                        A: req.user = target, req.actor = SA
                        A: requireAdmin REJECTS this token
                        A: every action logs auth_audit('admin_impersonate_action', actor=SA, user=target)

(token expires after 5 min — no rotation possible)
A ──INSERT auth_audit('admin_impersonate_end')──▶ DB  (on first 401)
```

---

## 8. Ban Cascade

```
admin ──POST /admin/auth/users/:id/ban {reason}──▶ A
                       A: requireAdmin
                       A: assert target.role != 'superadmin' OR actor.role = 'superadmin'
A ──BEGIN──▶ DB
A ──UPDATE users SET status='banned', banned_at, banned_by, ban_reason──▶ DB
A ──UPDATE refresh_tokens SET revoked_at=now, revoke_reason='ban' WHERE user_id──▶ DB
A ──for each active jti for user: SADD auth:blacklist + INSERT token_blacklist──▶ R/DB
A ──INSERT auth_audit('admin_ban', actor=admin, user=target)──▶ DB
A ──COMMIT──▶ DB
A ──auth.events.banned────▶ (notification module → email user)
admin ◀── 200 { user }
```

After this, any in-flight request for the banned user fails the blacklist check on its next call.

---

## 9. Email Pre-Check (Frontend Routing Decision)

```
C ──POST /auth/check-email {email}──▶ A
                       A: rate-limit per IP (30/min) and per email (10/h)
                       A: if IP threshold exceeded, require captcha_token
                       A: lookup user by email_normalised
                       A: load oauth_accounts for that user
A ──INSERT auth_audit('email_check', metadata={email_hash})──▶ DB
                       Decision tree:
                         user banned         → return as if not found
                         no user             → register
                         user.password set   → login
                         only google linked  → login_with_google
C ◀── { exists, has_password, has_google, suggested_action }
```

The frontend uses `suggested_action` to render either the password screen, the sign-up form, or a "Continue with Google" button.

---

## 10. Google Sign-In / Sign-Up

A single endpoint handles three outcomes: log in an existing Google-linked user, link Google to an existing email/password user, or create a fresh account.

```
(Frontend obtains Google ID token via GIS One Tap / button or native SDK)
C ──POST /auth/google {id_token}──▶ A
                       A: verify(id_token) using google-auth-library
                          - signature against Google JWKS
                          - aud == GOOGLE_CLIENT_ID
                          - iss in {accounts.google.com, https://accounts.google.com}
                          - exp in future
                          - email_verified === true       (else 400 GOOGLE_EMAIL_NOT_VERIFIED)
                       A: extract { sub, email, name, picture, locale }
                       
                       Branch ① — sub already linked
                         row = SELECT oauth_accounts WHERE provider='google' AND provider_user_id=sub
                         user = users[row.user_id]
                         outcome = 'logged_in'
                       
                       Branch ② — email matches an existing user (no Google link yet)
                         user = users[where email_normalised = sub.email AND status='active']
                         INSERT oauth_accounts(user_id=user.id, provider='google', provider_user_id=sub, ...)
                         outcome = 'linked_existing'
                         emit auth.google_linked
                       
                       Branch ③ — fresh sign-up
                         INSERT users(email, name=name, password_hash=NULL,
                                      email_verified_at=now(),  -- Google has verified it
                                      avatar_url=picture, locale, registration_platform=req.platform)
                         INSERT oauth_accounts(user_id, provider='google', provider_user_id=sub, ...)
                         outcome = 'registered'
                         emit auth.registered_google
                       
                       (any branch) issue access + refresh tokens, INSERT refresh_tokens row
                       INSERT auth_audit('login_google' or 'register_google')
C ◀── { user, access_token, refresh_token, expires_in, outcome }
```

If the user is banned → `403 USER_BANNED`. If `id_token` fails any verification step → `400 INVALID_GOOGLE_TOKEN`.

### 10b. Linking Google to an Existing Account (User-Initiated)

```
C (authed) ──POST /auth/google/link {id_token}──▶ A
                       A: verify ID token
                       A: if oauth_accounts row exists for this sub → 409 GOOGLE_ALREADY_LINKED
                       A: if user already has google linked         → 409 ALREADY_LINKED
A ──INSERT oauth_accounts──▶ DB
A ──auth.events.google_linked──▶
C ◀── { provider, provider_email, linked_at }
```

### 10c. Unlinking Google

```
C (authed) ──DELETE /auth/google/link──▶ A
                       A: if user.password_hash IS NULL AND no other oauth providers → 400 LAST_SIGN_IN_METHOD
A ──DELETE oauth_accounts──▶ DB
A ──auth.events.google_unlinked──▶
C ◀── 204
```

---

## 11. Account Lockout & Auto-Unlock

```
On 5th failed login (within 15 min):
  locked_until = now + 15min
  auth_audit('account_locked')

While locked:
  POST /auth/login → 423 ACCOUNT_LOCKED { locked_until }

On first successful login after locked_until:
  failed_login_attempts = 0
  locked_until = NULL
  auth_audit('account_unlocked')
```

There is no admin endpoint to manually unlock — admins use force-logout + reset-password instead, which clears the lock as a side effect of the password change.
