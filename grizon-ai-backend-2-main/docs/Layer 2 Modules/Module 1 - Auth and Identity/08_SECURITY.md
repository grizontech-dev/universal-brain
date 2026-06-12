# 08 — Security

Concrete security primitives, parameters, and threat-mitigation notes for Module 1.

## Password Hashing — argon2id

| Parameter | Value | Why |
|---|---|---|
| Algorithm | `argon2id` | Hybrid memory-hard; OWASP recommended |
| `memoryCost` | 19 MiB (`19456`) | OWASP 2024 baseline; bump every 2 years |
| `timeCost` | 2 | Two passes |
| `parallelism` | 1 | Single-threaded; predictable on shared VPS |
| `hashLength` | 32 |  |
| Salt | 16 bytes random per password | Stored in the encoded string |
| Pepper | **None initially** — added later via env if HSM is available |

`password.service.needsRehash(hash)` re-hashes on next successful login if the global params change.

## JWT — Access Tokens

| Property | Value |
|---|---|
| Algorithm | `RS256` (RSA-2048) |
| Library | `jose` |
| TTL | 15 minutes |
| Issuer (`iss`) | `https://api.<domain>` |
| Audience (`aud`) | matches `x-platform` of the device — `web` / `admin` / `mobile-ios` / `mobile-android` |
| Required claims | `sub`, `iss`, `aud`, `exp`, `iat`, `jti`, `role`, `plan_id` |
| Optional claim | `act: { sub: <admin_id> }` for impersonation tokens |
| `kid` header | Always set; used for key rotation |
| JWKS endpoint | Not exposed publicly in Phase 1 (single-server). Can be added later. |

### Key Rotation

- Two key pairs live concurrently: `current` and `previous`.
- Signing always uses `current`. Verification accepts both.
- Rotation procedure: superadmin generates new key, sets it as `current`, demotes old to `previous`. After 24 h (longer than max access TTL), old key is removed.

## Refresh Tokens

- Opaque strings, 32 random bytes, base64url-encoded → 43 chars
- Stored as **SHA-256 of the token** (`refresh_tokens.token_hash`); plaintext never persisted
- TTL 30 days; rotated on every use (sliding 30-day window)
- One row per active device — no shared tokens
- `family_id` groups all rotations of the original login; reuse anywhere in the family revokes the whole family

### Reuse Detection

```
verify(refresh):
  row = SELECT WHERE token_hash = sha256(refresh)
  if row not found              → 401 INVALID_TOKEN
  if row.revoked_at IS NOT NULL → REUSE
                                  → revoke ALL rows where family_id = row.family_id
                                  → blacklist active access JTIs for user
                                  → audit('refresh_reuse_detected')
                                  → return 401 TOKEN_REUSED
  else proceed
```

Justification: a stolen refresh token used by an attacker before the legitimate user rotates it will appear as a normal rotation. But on the next legitimate rotation (or vice versa), the previously-rotated row will be presented again — reuse — and the family is killed.

## Access Token Blacklist

| Storage | Detail |
|---|---|
| Primary | Redis set/keys `auth:blacklist:{jti}` with TTL = remaining JWT lifetime |
| Mirror | Postgres `token_blacklist` (cold-restart recovery, audit) |
| Per-user index | Redis set `auth:user_jtis:{user_id}` of active JTIs — used to mass-blacklist on ban / logout-all / password change |
| GC | Redis auto-expires; Postgres mirror cleaned nightly via `DELETE WHERE expires_at < now()` |

The blacklist is checked on every request. A negative cache (`auth:notblacklisted:{jti}` 60 s) is kept on the API side to avoid hot-path Redis hits — the cache is keyed by JTI, so a fresh `SADD` to the blacklist invalidates it on the next read.

## Device Fingerprint

```
fingerprint = sha256(
  user_agent +
  ip_first_three_octets +     // /24 prefix; survives DHCP changes
  accept_language
).slice(0, 32)
```

- Stored on `refresh_tokens.fingerprint` and `auth_audit.fingerprint`
- Not used as an authentication factor — only for audit clustering and "this looks like a new device" UX hints
- Deliberate IP truncation balances stability and attribution

## Brute-Force Defence

| Trigger | Action |
|---|---|
| 5 failed logins for a user within 15 min | `users.locked_until = now + 15 min`; further logins → `423 ACCOUNT_LOCKED` |
| 10 failed logins from a single IP within 15 min (across users) | Module 5 rate-limit kicks in: 15-min IP cooldown |
| 3 password-reset requests for an email within 1 h | Silent drop with `200 ok:true` (no enumeration) |
| 100 failed `/auth/refresh` from one IP / hour | Module 5 IP cooldown |

Lockout times double on repeat (15m → 30m → 60m → 60m capped) within a 24-hour window.

## Email Enumeration Resistance

- `/auth/register` returns `409 EMAIL_TAKEN` (necessary trade-off; common pattern)
- `/auth/password/forgot` always returns `200 ok:true`
- `/auth/login` returns `401 INVALID_CREDENTIALS` regardless of which field is wrong; timing equalised by always running argon2 verify against a dummy hash if the user lookup fails

## Transport

- HTTPS only (Nginx terminates; HSTS on)
- Bearer tokens — no cookies → no CSRF surface in Phase 1
- CORS: explicit allowlist of front-end origins; admin app on separate origin

## Sensitive Data Handling

| Data | At rest | In logs |
|---|---|---|
| Password | argon2id hash only | Never |
| Refresh / reset / verify tokens | SHA-256 hash only | Never (plaintext exists only in the response or email body) |
| JWTs | Not stored server-side (stateless) | JTI only, never full token |
| Email | Stored | Hashed in third-party telemetry; full in own DB |
| IP address | Stored on auth_audit + sessions | Truncated to /24 in shipped logs |

## Google Sign-In / Sign-Up

| Concern | How it's handled |
|---|---|
| Library | `google-auth-library` for ID-token verification (handles JWKS fetch + caching) |
| Required claims | `iss`, `aud`, `exp`, `sub`, `email`, `email_verified` |
| `aud` check | Must equal our Google OAuth client ID (per platform — web, iOS, Android may use different client IDs; all are accepted from a configured allowlist) |
| `iss` check | Must be `accounts.google.com` or `https://accounts.google.com` |
| `email_verified` | Must be `true` — otherwise `400 GOOGLE_EMAIL_NOT_VERIFIED`. We never trust an unverified email to identify or create a user |
| Account linking | Linking by matching email is allowed only because Google asserts the email is verified. If a future provider does not verify emails, link-by-email will be disabled for it |
| Replay | Google ID tokens are short-lived (≤ 1 h). We do not store them; nothing to replay server-side |
| State / nonce | We accept ID tokens from the frontend SDK; the SDK enforces nonce. We do not run an OAuth code flow ourselves, so server-side state cookies are not needed |
| Linking the same Google to two users | Prevented by `UNIQUE(provider, provider_user_id)` on `oauth_accounts` |
| Refresh from Google | Not stored — we issue our own refresh tokens. Re-authentication via Google goes through `/auth/google` again |
| Trust on `email` change | If a user changes their Google email later, `provider_user_id` (= `sub`) stays stable, so identity is preserved. We update `oauth_accounts.provider_email` on each login |

## Email Pre-Check Anti-Abuse

Email-check is intentionally enumerable — the product flow needs it. Mitigations:
- IP rate limit: `30 / min`, `300 / hour`. Failure → `429`.
- Per-email rate limit: `10 / hour`. Failure → `429`.
- After 3rd `429` from one IP within 10 min → require a captcha (Cloudflare Turnstile or hCaptcha) `captcha_token` in the body. Failure → `403 CAPTCHA_REQUIRED`.
- Banned users return `exists: false` to avoid leaking ban status.
- Audit row stores SHA-256(email) only, not plaintext.

## MFA (Placeholder)

Schema reserves `users.mfa_secret` and `users.mfa_enabled`. Phase 1 does not implement enrolment or challenge. When implemented:
- TOTP (RFC 6238) via `otplib`
- Recovery codes table (separate)
- Login flow gains a second step issuing a short-lived MFA challenge token
- Admin endpoints become MFA-required

## Threat Model Summary

| Threat | Mitigation |
|---|---|
| Stolen access token | 15-min TTL; blacklist on logout/ban |
| Stolen refresh token | Rotation + reuse detection + family revoke |
| Credential stuffing | Lockout + IP rate limit + (later) breached-password check |
| Phishing reset link | Single-use token, 30 min TTL, hashed in DB |
| Replay of impersonation token | 5-min TTL, no refresh, audited per request, `act` claim |
| Token leak via logs | Never log full tokens; only JTIs / prefixes |
| Privilege escalation via PATCH /admin/users | Role change requires superadmin + force-logout |
| Email enumeration | Forgot-password silent response; constant-time login fail |
| Database compromise | Hashes only; rotation invalidates old refresh tokens |
| Forged Google ID token | Verified against Google's JWKS + audience check + email_verified gate |
| Account takeover via Google linking | Linking-by-email only if Google reports the email as verified |
| Email enumeration through `/auth/check-email` | Rate-limited per IP and per email; captcha at high volume; banned users hidden |
