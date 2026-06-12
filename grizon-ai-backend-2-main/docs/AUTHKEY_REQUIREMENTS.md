# Authkey integration — requirements & setup

This document lists **environment variables**, **email template IDs (`mid`)**, **dynamic field names** the backend sends (must match `{#placeholder#}` in [console.authkey.io](https://console.authkey.io)), and **SMS (`sid`)** usage. Use it when creating Authkey templates and filling `.env` / deployment secrets.

**Backend behavior**

- Email: `GET https://api.authkey.io/request` with `authkey`, `email`, `mid`, plus one query parameter per dynamic field (see tables below).
- SMS: same URL with `authkey`, `mobile`, `country_code`, `sid`, plus dynamic fields.

Placeholder syntax in Authkey templates: `{#fieldName#}` — the HTTP query uses `fieldName=value` (case-sensitive; align names below).

---

## 1. Global Authkey & mail settings

| Env variable | Required when | Purpose |
|--------------|----------------|---------|
| `MAIL_PROVIDER` | Production Authkey email | Set to `authkey` to send mail via Authkey templates. |
| `AUTHKEY_AUTH_KEY` | `MAIL_PROVIDER=authkey` **or** any SMS send | API auth key from Authkey dashboard (`authkey=` query param). Validated when mail provider is `authkey`. |
| `MAIL_FROM` | Always (app schema) | Stored for compatibility with other mail providers; **Authkey templates control sender/display** in the portal — keep a valid email for schema/tests. |
| `MAIL_API_KEY` | Optional | Not used for Authkey; reserved for postmark / resend / ses. |

**SMS**

- Uses the same `AUTHKEY_AUTH_KEY`.
- Template IDs (`sid`) are chosen **in code** when calling `smsService.sendTemplate({ sid, ... })` — there is **no** `AUTHKEY_*_SID` env family yet. Document suggested names in §7 for future wiring.

---

## 2. Transactional email templates (`mid`)

Create **email** templates in Authkey, note each numeric **template id**, then set the matching env var.

### 2.1 Verify email — `AUTHKEY_EMAIL_VERIFY_MID`

| Item | Detail |
|------|--------|
| **Triggered by** | User registration (password path); user requests “resend verify email”. |
| **Recipients** | User’s registration email. |
| **Your Authkey subject/body** | Explain they must verify; include a single actionable link. |

**Dynamic fields sent by the backend**

| Query param | Authkey template token | Required | Notes |
|-------------|-------------------------|----------|--------|
| `link` | `{#link#}` | Yes | Full HTTPS URL: `{PUBLIC_URL}/verify?token=…` |

**Example template snippet**

```text
Hi,

Confirm your email by opening: {#link#}

If you did not sign up, ignore this message.
```

---

### 2.2 Password reset — `AUTHKEY_PASSWORD_RESET_MID`

| Item | Detail |
|------|--------|
| **Triggered by** | Forgot-password flow; admin “notify user” password reset. |
| **Recipients** | Account email. |

**Dynamic fields sent by the backend**

| Query param | Authkey template token | Required | Notes |
|-------------|-------------------------|----------|--------|
| `link` | `{#link#}` | Yes | Full HTTPS URL: `{PUBLIC_URL}/reset-password?token=…` |

**Example template snippet**

```text
Reset your password using this link (expires in 30 minutes): {#link#}
```

---

## 3. Notification queue email templates (`mid`)

Worker template enum comes from `NotificationJobPayload` (`src/types/notificationJob.d.ts`). For each row, the backend sends **`email`** as recipient plus **all entries in `vars`** as string query parameters (same keys as below). Set the matching env var to your Authkey numeric **mid**.

### 3.1 Welcome — `AUTHKEY_NOTIFY_WELCOME_MID`

| Query param | Authkey token | Required | Notes |
|-------------|---------------|----------|--------|
| `email` | `{#email#}` | Recommended | Recipient is also passed as `email=` to Authkey; include in template if you reference it. |
| `userName` | `{#userName#}` | Optional | Preferred display name. |
| `name` | `{#name#}` | Optional | Fallback if `userName` absent. |

Suggested body: short welcome + CTA to sign in (link can be static in template or added later in `vars`).

---

### 3.2 New device — `AUTHKEY_NOTIFY_NEW_DEVICE_MID`

| Query param | Authkey token | Required | Notes |
|-------------|---------------|----------|--------|
| `email` | `{#email#}` | Recommended | |
| `when` or `timestamp` | `{#when#}` / `{#timestamp#}` | Optional | Human-readable or ISO time. |
| `ip` | `{#ip#}` | Optional | |
| `device` or `deviceSummary` | `{#device#}` / `{#deviceSummary#}` | Optional | |

---

### 3.3 Password changed — `AUTHKEY_NOTIFY_PASSWORD_CHANGED_MID`

| Query param | Authkey token | Required | Notes |
|-------------|---------------|----------|--------|
| `email` | `{#email#}` | Recommended | |
| `userName` | `{#userName#}` | Optional | |
| `name` | `{#name#}` | Optional | |

---

### 3.4 Banned / restricted — `AUTHKEY_NOTIFY_BANNED_MID`

| Query param | Authkey token | Required | Notes |
|-------------|---------------|----------|--------|
| `email` | `{#email#}` | Recommended | |
| `reason` | `{#reason#}` | Optional | May be empty; template should handle blank. |

---

### 3.5 Top-up succeeded — `AUTHKEY_NOTIFY_TOPUP_SUCCEEDED_MID`

| Query param | Authkey token | Required | Notes |
|-------------|---------------|----------|--------|
| `email` | `{#email#}` | Recommended | |
| `amount` | `{#amount#}` | Optional | |
| `balance` | `{#balance#}` | Optional | |

---

### 3.6 Rate limit flagged (admin-style) — `AUTHKEY_NOTIFY_RATE_LIMIT_FLAGGED_MID`

| Query param | Authkey token | Required | Notes |
|-------------|---------------|----------|--------|
| `email` | `{#email#}` | Optional | Often same as flagged user. |
| `flaggedUserEmail` | `{#flaggedUserEmail#}` | Optional | |
| `flaggedUserId` or `userId` | `{#flaggedUserId#}` / `{#userId#}` | Optional | |
| `cooldownCount` or `count` | `{#cooldownCount#}` / `{#count#}` | Optional | |

---

## 4. Env reference — template ID variables (copy checklist)

Paste into `.env` after creating templates in Authkey:

```bash
MAIL_PROVIDER=authkey
AUTHKEY_AUTH_KEY=

# Email template IDs (mid)
AUTHKEY_EMAIL_VERIFY_MID=
AUTHKEY_PASSWORD_RESET_MID=

AUTHKEY_NOTIFY_WELCOME_MID=
AUTHKEY_NOTIFY_NEW_DEVICE_MID=
AUTHKEY_NOTIFY_PASSWORD_CHANGED_MID=
AUTHKEY_NOTIFY_BANNED_MID=
AUTHKEY_NOTIFY_TOPUP_SUCCEEDED_MID=
AUTHKEY_NOTIFY_RATE_LIMIT_FLAGGED_MID=
```

If a **notification** `mid` is unset, the backend still logs/templates locally but Authkey mail sends **skip** the HTTP call for that message until you set the id (see mailer fallback behavior in code).

---

## 5. Behaviour notes

1. **Naming** — Authkey dynamic keys must match query params exactly (e.g. `link`, not `verifyLink`).
2. **HTML** — Build rich HTML inside the Authkey console template; the server may still generate fallback HTML for logs/non-Authkey providers, but Authkey delivery uses your portal template + params.
3. **Security** — Tokens appear only inside `link` for verify/reset; do not shorten or log templates with raw tokens client-side.
4. **Tests / local dev** — With `MAIL_PROVIDER` not `authkey`, the app uses the logging mailer and ignores live Authkey calls.

---

## 6. SMS templates (`sid`)

Implemented helper: `smsService.sendTemplate({ mobile, countryCode, sid, params })` in `src/infra/sms.ts`.

| Query param | Meaning |
|-------------|---------|
| `authkey` | From `AUTHKEY_AUTH_KEY` |
| `mobile` | Local number (no country prefix; per your Authkey account rules) |
| `country_code` | E.g. `91` |
| `sid` | SMS template id from Authkey |
| `…` | Additional keys must match `{#…#}` in the SMS template |

**Suggested future env vars** (not wired yet — add when product defines flows):

- `AUTHKEY_SMS_OTP_SID` — OTP / verification SMS  
- `AUTHKEY_SMS_ALERT_SID` — generic alert  

Until those exist, pass numeric `sid` from application code when calling `sendTemplate`.

---

## 7. Setup checklist

1. Create Authkey account and copy **Auth Key** → `AUTHKEY_AUTH_KEY`.
2. Create **email** templates for §2 and §3; record each numeric **mid** → matching `AUTHKEY_*_MID` env.
3. Align every `{#placeholder#}` with the **Query param** tables above.
4. Set `MAIL_PROVIDER=authkey` in production.
5. (Optional) Create **SMS** templates; note **sid** values for use in code or future env vars.
6. Deploy env vars and send a test email-verify link (`/verify?token=...`) / password-reset from staging.

---

## 8. Source of truth in code

| Concern | Location |
|---------|----------|
| Env schema | `src/config/env.ts` |
| MID routing | `src/config/authkey.ts` |
| Authkey HTTP client | `src/infra/authkey.client.ts` |
| Mail adapter | `src/infra/mailer.ts` |
| SMS helper | `src/infra/sms.ts` |
| Transactional sends | `src/services/auth.service.ts`, `src/routes/admin/auth.routes.ts` |
| Notification sends | `src/workers/notification.worker.ts` |

When this doc and Authkey console drift, update templates or env names together and reflect changes here.
