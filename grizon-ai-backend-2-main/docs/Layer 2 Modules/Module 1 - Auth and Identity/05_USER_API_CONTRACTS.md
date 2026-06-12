# 05 — User API Contracts

Base path: **`/api/v1/auth`** · Mounted by `src/routes/user/auth.routes.ts`.

All requests must send `Content-Type: application/json` and `x-platform: web | admin | mobile-ios | mobile-android`. Authenticated routes require `Authorization: Bearer <access_jwt>`. There is **no** API-key authentication — all access is first-party user sessions.

## Quick Index

| # | Method | Path | Auth |
|---|---|---|---|
| 1 | POST | `/auth/check-email` | public |
| 2 | POST | `/auth/register` | public |
| 3 | POST | `/auth/login` | public |
| 4 | POST | `/auth/google` | public |
| 5 | POST | `/auth/refresh` | refresh-token body |
| 6 | POST | `/auth/logout` | JWT |
| 7 | POST | `/auth/logout-all` | JWT |
| 8 | GET  | `/auth/me` | JWT |
| 9 | PATCH | `/auth/me` | JWT |
| 10 | POST | `/auth/google/link` | JWT |
| 11 | DELETE | `/auth/google/link` | JWT |
| 12 | POST | `/auth/password/change` | JWT |
| 13 | POST | `/auth/password/forgot` | public |
| 14 | POST | `/auth/password/reset` | reset-token body |
| 15 | POST | `/auth/email/verify/request` | JWT |
| 16 | POST | `/auth/email/verify/confirm` | verify-token body |
| 17 | GET  | `/auth/sessions` | JWT |
| 18 | DELETE | `/auth/sessions/:id` | JWT |

> **Detailed sections below are listed in their canonical order (1–18). Existing headings keep their narrative groupings; new sections are added inline.**

---

## 1. POST `/auth/check-email`

The frontend's first call after the user types an email. Tells the UI which screen to show next: password login, sign-up form, or "Continue with Google".

**Body**
```ts
{ email: string }
```

**200 OK**
```ts
{
  exists:           boolean,                       // does an active user exist?
  has_password:     boolean,                       // can sign in with email + password?
  has_google:       boolean,                       // has Google linked?
  suggested_action: 'login' | 'login_with_google' | 'register'
}
```

`suggested_action` rules:
- `exists && has_password` → `'login'`
- `exists && !has_password && has_google` → `'login_with_google'` (Google-only account; password is unset)
- `!exists` → `'register'`

**Notes & abuse mitigation**
- This endpoint is intentionally enumerable (the product flow requires it). It is rate-limited per IP (`30 / minute`, `300 / hour`) and per email (`10 / hour`). Beyond the IP threshold, a captcha challenge token is required (`{ captcha_token }` in body) — see [08_SECURITY.md](08_SECURITY.md).
- Banned users return `exists: false` to avoid leaking ban state.
- Always returns `200`; never `404`.
- Writes `auth_audit('email_check')` with the email hashed (not stored plaintext on this audit row).

**Errors:** `400 INVALID_EMAIL`, `429 TOO_MANY_REQUESTS`, `403 CAPTCHA_REQUIRED`.

---

## 2. POST `/auth/register`

Create an account. Returns tokens + user.

**Body**
```ts
{
  email:     string,   // valid email
  password:  string,   // min 10 chars, contains letter + number
  name:      string,   // 1–60 chars · profile display name
  bio?:      string,   // 0–500 chars · optional self-description
  locale?:   string,   // optional, e.g. 'en-IN'
  timezone?: string    // optional, IANA tz e.g. 'Asia/Kolkata'
}
```

**200 OK**
```ts
{
  user: User,
  access_token:  string,   // JWT, 15 min
  refresh_token: string,   // opaque, 30 d
  expires_in:    900
}
```

**Errors:** `400 VALIDATION_FAILED`, `409 EMAIL_TAKEN`, `429 TOO_MANY_REGISTRATIONS_FROM_IP`.

---

## 3. POST `/auth/login`

**Body**
```ts
{ email: string, password: string }
```

**200 OK** — same shape as register response.

**Errors:** `400 VALIDATION_FAILED`, `401 INVALID_CREDENTIALS`, `403 USER_BANNED`, `423 ACCOUNT_LOCKED` (with `locked_until`).

Failed attempts increment `users.failed_login_attempts`. 5 fails / 15 min → lock for 15 min ([08_SECURITY.md](08_SECURITY.md)).

---

## 4. POST `/auth/google`

Sign in **or** sign up via Google. The frontend obtains a Google ID token (web: Google Identity Services / GIS one-tap or button; native: Google Sign-In SDK) and posts it here. The server verifies the token, then either logs in the matching user, links Google to a user with the same verified email, or creates a fresh account.

**Body**
```ts
{
  id_token:      string,                // Google JWT — the only credential needed
  name?:         string,                // optional override (used only on first-time sign-up if Google didn't return one)
  timezone?:     string,
  locale?:       string
}
```

**200 OK** — same response shape as `/auth/login` plus an indicator of which path was taken.
```ts
{
  user:          User,
  access_token:  string,
  refresh_token: string,
  expires_in:    900,
  outcome:       'logged_in' | 'linked_existing' | 'registered'
}
```

**Server logic (mirrors [07_FLOWS.md](07_FLOWS.md) §10):**
1. Verify the ID token against Google's JWKS. Reject if `aud` ≠ our client ID, `iss` is not `accounts.google.com` / `https://accounts.google.com`, or `email_verified !== true`.
2. Look up `oauth_accounts WHERE provider='google' AND provider_user_id=sub`.
   - **Hit** → log that user in (`outcome: 'logged_in'`).
3. Otherwise, look up `users WHERE email_normalised = sub.email`.
   - **Hit** → create a new `oauth_accounts` row linking Google to that user (`outcome: 'linked_existing'`). The user keeps their password.
   - **Miss** → create a new `users` row (with `password_hash = NULL`, `email_verified_at = now()`, `name` from Google's `name` claim or the body override) plus the `oauth_accounts` row (`outcome: 'registered'`).
4. Issue tokens exactly like `/auth/login`.

**Errors:** `400 INVALID_GOOGLE_TOKEN`, `400 GOOGLE_EMAIL_NOT_VERIFIED`, `403 USER_BANNED`, `409 EMAIL_TAKEN_BY_DIFFERENT_PROVIDER` (rare: another OAuth provider has already linked this email — reserved for the future).

---

## 5. POST `/auth/refresh`

Rotates the refresh token (old one is revoked).

**Body**
```ts
{ refresh_token: string }
```

**200 OK**
```ts
{
  access_token:  string,
  refresh_token: string,   // NEW token; old one is now invalid
  expires_in:    900
}
```

**Errors:** `401 INVALID_TOKEN`, `401 TOKEN_REUSED` (entire family revoked — user must re-login).

---

## 6. POST `/auth/logout`

Revokes the **current** session: blacklists the access JTI and revokes the refresh token row.

**Body**
```ts
{ refresh_token: string }
```

**204 No Content**

---

## 7. POST `/auth/logout-all`

Revokes every session for the authenticated user.

**204 No Content**

---

## 8. GET `/auth/me`

**200 OK**
```ts
{
  id:                  string,
  email:               string,
  name:                string,
  bio:                 string | null,
  avatar_url:          string | null,
  locale:              string | null,
  timezone:            string | null,
  role:                'user' | 'admin' | 'superadmin',
  status:              'active' | 'suspended',
  email_verified_at:   string | null,
  mfa_enabled:         boolean,
  has_password:        boolean,                       // true if password_hash is set
  linked_providers:    Array<{ provider: 'google', provider_email: string, linked_at: string }>,
  created_at:          string,
  last_login_at:       string | null
}
```

---

## 9. PATCH `/auth/me`

Update profile fields. Email and password are **not** changeable here.

**Body** (all optional)
```ts
{
  name?:       string,    // 1–60 chars
  bio?:        string,    // 0–500 chars; pass empty string to clear
  avatar_url?: string,    // must be a URL on our CDN; null to clear
  locale?:     string,
  timezone?:   string
}
```

Writes `auth_audit('profile_updated', metadata={ fields: [...] })`.

**200 OK** → updated `User`.

---

## 10. POST `/auth/google/link`

Link a Google account to the **already authenticated** user. Useful when the user originally signed up with email/password and now wants the option to sign in via Google.

**Body** `{ id_token: string }`

**Server logic:**
- Verify the ID token (same checks as `/auth/google`).
- Reject if Google's `sub` is already linked to a different user → `409 GOOGLE_ALREADY_LINKED`.
- Reject if the current user already has a linked Google account → `409 ALREADY_LINKED`.
- Insert `oauth_accounts` row.

**200 OK**
```ts
{ provider: 'google', provider_email: string, linked_at: string }
```

**Errors:** `400 INVALID_GOOGLE_TOKEN`, `400 GOOGLE_EMAIL_NOT_VERIFIED`, `409 GOOGLE_ALREADY_LINKED`, `409 ALREADY_LINKED`.

---

## 11. DELETE `/auth/google/link`

Unlink Google from the authenticated user's account.

**Server logic:**
- If the user has `password_hash IS NULL` and no other OAuth providers, refuse → `400 LAST_SIGN_IN_METHOD`. The user must set a password first via `/auth/password/forgot` (or a future "Set password" flow).
- Otherwise delete the `oauth_accounts` row.

**204 No Content** · **Errors:** `400 LAST_SIGN_IN_METHOD`, `404 NOT_LINKED`.

---

## 12. POST `/auth/password/change`

**Body**
```ts
{ current_password: string, new_password: string }
```

On success: `users.password_changed_at` updated, **all** sessions for the user revoked, fresh tokens issued for the calling device only.

**200 OK**
```ts
{ access_token: string, refresh_token: string, expires_in: 900 }
```

**Errors:** `401 INVALID_CURRENT_PASSWORD`, `400 PASSWORD_TOO_WEAK`.

---

## 13. POST `/auth/password/forgot`

**Body** `{ email: string }`

**200 OK** — always returns `{ ok: true }` regardless of whether the email exists (prevents enumeration). If the email exists, a single-use reset link is emailed.

Rate-limited to 3 / hour per email + 10 / hour per IP.

---

## 14. POST `/auth/password/reset`

**Body**
```ts
{ token: string, new_password: string }
```

**200 OK** → fresh tokens for the device that performed the reset. All other sessions revoked.

**Errors:** `400 INVALID_OR_EXPIRED_TOKEN`, `400 PASSWORD_TOO_WEAK`.

---

## 15. POST `/auth/email/verify/request`

Sends a verification email to the authenticated user's address. Rate-limited 3 / hour per user.

**204 No Content**

---

## 16. POST `/auth/email/verify/confirm`

**Body** `{ token: string }`

**200 OK** `{ email_verified_at: string }`

**Errors:** `400 INVALID_OR_EXPIRED_TOKEN`.

---

## 17. GET `/auth/sessions`

List **every active device** signed in to this account. A user can have unlimited concurrent sessions across web, admin, iOS, and Android — each device appears as one row.

**200 OK**
```ts
{
  sessions: [
    {
      id:            string,
      platform:      'web' | 'admin' | 'mobile-ios' | 'mobile-android',
      device_name:   string,    // "Maulik's MacBook · Chrome"
      device_type:   'desktop' | 'mobile' | 'tablet' | 'unknown',
      os:            string,    // "macOS 14"
      browser:       string | null,
      app_version:   string | null,
      ip:            string,    // /24 truncated when shown to non-admin? full to owner
      city:          string | null,   // best-effort GeoIP
      country:       string | null,
      issued_at:     string,
      last_used_at:  string,
      expires_at:    string,
      is_current:    boolean    // true on exactly one row — the device making this call
    }
  ]
}
```

The list is sorted with `is_current` first, then most-recently-used.

---

## 18. DELETE `/auth/sessions/:id`

Revoke a specific device. The user typically calls this from a "Devices" screen to sign another phone or browser out without affecting the device they are currently using.

If `:id` is the current session, the call behaves like `/auth/logout`.

**204 No Content** · **404** if not owned by the user.

---

## Common Response Headers

Every authenticated response includes:

```
X-User-Id:    {req.user.id}
X-Session-Id: {req.session.id}
```

Useful for client-side log correlation. Never include sensitive identifiers in logs forwarded to third parties.
