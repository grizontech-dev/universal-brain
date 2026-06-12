# Grizon AI — Auth Flow (Next.js)

> For full request/response schemas and example payloads, refer to the Postman collection.

---

## 1. Tokens

| Token | Storage | Lifetime | Usage |
|---|---|---|---|
| `access_token` | Memory only (JS variable / React context) | 15 minutes | `Authorization: Bearer` header |
| `refresh_token` | `localStorage` or secure cookie | 30+ days | `POST /auth/refresh` |

> **Never** store `access_token` in localStorage. On page reload, silently exchange the stored `refresh_token` for a new one.

---

## 2. Required Headers

Every authenticated request must include:

```
Authorization: Bearer <access_token>
x-platform:    web
Content-Type:  application/json
```

---

## 3. API Endpoints

Base: `/api/v1/auth`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/check-email` | No | Check if email exists → get `suggested_action` |
| POST | `/auth/register` | No | Create account → returns token bundle |
| POST | `/auth/login` | No | Email + password sign in → returns token bundle |
| GET | `/auth/me` | Yes | Load profile including `email_verified_at` |
| POST | `/auth/email/verify/request` | Yes | Send verification email to logged-in user |
| POST | `/auth/email/verify/confirm` | No | Confirm token from email link |
| POST | `/auth/refresh` | No | Exchange `refresh_token` for new token bundle |
| POST | `/auth/logout` | Yes | Revoke current device session |
| POST | `/auth/logout-all` | Yes | Revoke all sessions for this user |
| POST | `/auth/password/forgot` | No | Send password reset email |
| POST | `/auth/password/reset` | No | Confirm reset token + set new password |
| PATCH | `/auth/me` | Yes | Update name, bio, avatar_url, locale, timezone |

---

## 4. Sign-In & Register Flow

The backend uses an **email-first** pattern. Call `check-email` first to decide which form to show.

```
1. User enters email
   → POST /auth/check-email  { email }
   ← { exists, suggested_action: "login" | "register" }

2. "register"  → show name + password fields
               → POST /auth/register  { email, password, name }

   "login"     → show password field
               → POST /auth/login  { email, password }

3. Both return: { access_token, refresh_token, expires_in }

4. Store refresh_token → call GET /auth/me → check email_verified_at
```

**Password rules:** minimum 10 characters, must contain at least one letter and one number.

---

## 5. Email Verification Gate

After login or register, check `email_verified_at` from `GET /auth/me`:

```ts
if (!user.email_verified_at) {
  // render <VerifyEmailScreen />
  // block all app routes
}
```

**Verification flow:**

1. On mount of `<VerifyEmailScreen>` → `POST /auth/email/verify/request` (sends email)
2. Show "Check your inbox" UI with a **Resend** button (60s client-side cooldown)
3. User clicks link in email → lands on `/verify?token=xxx` in your Next.js app
4. That page calls `POST /auth/email/verify/confirm  { token }`
5. On success → re-fetch `GET /auth/me` → `email_verified_at` is now set → redirect to app

> The verify link URL is set in the backend mailer template. It must point to your Next.js app:
> `https://yourdomain.com/verify?token=xxx`

---

## 6. Token Refresh Interceptor

Add to your API client (axios interceptor or fetch wrapper). Runs transparently on every 401:

```
1. Request returns 401
2. Is the failing request /auth/refresh itself?
      YES → clear tokens, redirect to /login
      NO  → POST /auth/refresh  { refresh_token }
3. Store new access_token (memory) + refresh_token (localStorage)
4. Retry original request
5. If retry still 401 → clear tokens, redirect to /login
```

> Use a single in-flight promise for the refresh call so concurrent 401s don't fire multiple refresh requests.

---

## 7. Next.js Route Guard

Three possible states after boot:

| State | Condition | Action |
|---|---|---|
| Unauthenticated | No `refresh_token` in storage | Redirect to `/login` |
| Authenticated, unverified | `user.email_verified_at === null` | Render `<VerifyEmailScreen />` |
| Authenticated + verified | `email_verified_at` is set | Render app routes |

**middleware.ts** (cookie-based storage):

```ts
export function middleware(req: NextRequest) {
  const hasToken = req.cookies.has('refresh_token')
  const isAuthPage = req.nextUrl.pathname.startsWith('/login')

  if (!hasToken && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
}
```

Email verification check runs client-side in your root layout — fetch `/auth/me`, render `<VerifyEmailScreen />` if unverified.

---

## 8. App Boot Sequence

On every page load or refresh:

1. Read `refresh_token` from localStorage
2. If absent → render login screen
3. If present → `POST /auth/refresh` → get fresh `access_token`
4. Store `access_token` in memory / auth context
5. `GET /auth/me` → populate user context
6. Check `email_verified_at` → gate accordingly
7. Render app

---

## 9. Logout

```
POST /auth/logout      { refresh_token }   // current device only
POST /auth/logout-all                      // all devices
```

After either call: clear `access_token` from memory, remove `refresh_token` from localStorage, redirect to `/login`.

---

## 10. Password Reset

1. `POST /auth/password/forgot  { email }` → backend sends email
2. User clicks link → your app at `/reset-password?token=xxx`
3. `POST /auth/password/reset  { token, new_password }` → returns token bundle (auto-login)
