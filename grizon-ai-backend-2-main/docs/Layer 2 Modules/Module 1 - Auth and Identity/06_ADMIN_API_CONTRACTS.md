# 06 — Admin API Contracts

Base path: **`/api/v1/admin/auth`** · Mounted by `src/routes/admin/auth.routes.ts`.

All routes require:
- `Authorization: Bearer <jwt>` of a user with `role IN ('admin','superadmin')`
- `x-platform: admin`

Routes marked `[SA]` require `role = 'superadmin'`.

Every action writes a row to `auth_audit` with `actor_id = req.user.id`.

## Quick Index

| # | Method | Path | Role |
|---|---|---|---|
| 1 | GET | `/admin/auth/users` | admin |
| 2 | GET | `/admin/auth/users/:id` | admin |
| 3 | PATCH | `/admin/auth/users/:id` | admin (role change → SA) |
| 4 | POST | `/admin/auth/users/:id/ban` | admin |
| 5 | POST | `/admin/auth/users/:id/unban` | admin |
| 6 | POST | `/admin/auth/users/:id/force-logout` | admin |
| 7 | POST | `/admin/auth/users/:id/reset-password` | admin |
| 8 | POST | `/admin/auth/users/:id/impersonate` | `[SA]` |
| 9 | GET | `/admin/auth/audit` | admin |
| 10 | GET | `/admin/auth/sessions` | admin |
| 11 | DELETE | `/admin/auth/sessions/:id` | admin |

---

## 1. GET `/admin/auth/users`

**Query params**
```
q?:          string            // free-text on email + display_name
role?:       'user'|'admin'|'superadmin'
status?:     'active'|'banned'|'suspended'
created_after?:  ISO8601
created_before?: ISO8601
page?:       int (default 1)
page_size?:  int (default 25, max 200)
sort?:       'created_at'|'last_login_at'|'email'   (prefix '-' for desc)
```

**200 OK**
```ts
{
  users: AdminUser[],
  page: number,
  page_size: number,
  total: number
}
```

`AdminUser` extends the user shape from §05 with `failed_login_attempts`, `locked_until`, `banned_at`, `ban_reason`, `last_login_ip`.

---

## 2. GET `/admin/auth/users/:id`

Full identity record + last 20 audit events + active session count + active API key count.

**200 OK**
```ts
{
  user:           AdminUser,
  active_sessions: number,
  active_api_keys: number,
  recent_audit:   AuditEvent[]
}
```

---

## 3. PATCH `/admin/auth/users/:id`

Update mutable identity fields.

**Body** (all optional)
```ts
{
  name?:         string,
  bio?:          string,
  avatar_url?:   string,
  status?:       'active'|'suspended',     // 'banned' uses the dedicated endpoint
  role?:         'user'|'admin'|'superadmin'  // role change → requires superadmin
}
```

A role change triggers `force-logout` for the target user atomically.

**200 OK** → updated `AdminUser`.

**Errors:** `403 SUPERADMIN_REQUIRED` (when changing role as a regular admin), `404 USER_NOT_FOUND`.

---

## 4. POST `/admin/auth/users/:id/ban`

**Body** `{ reason: string }`

Effects (in one transaction):
1. `users.status = 'banned'`, `banned_at`, `banned_by`, `ban_reason` set
2. All `refresh_tokens` for the user → `revoked_at = now()`, `revoke_reason = 'ban'`
3. All active access JTIs added to blacklist with `expires_at = original exp`
4. Emits `auth.banned` event

**200 OK** → updated `AdminUser`.

---

## 5. POST `/admin/auth/users/:id/unban`

Reverses ban. `users.status = 'active'`, banned-at fields cleared. Sessions are **not** restored — the user must log in again.

**200 OK**.

---

## 6. POST `/admin/auth/users/:id/force-logout`

Revokes every session + blacklists every active access token for the user. Same as steps 2–3 of ban, without status change.

**Body** `{ reason?: string }` (logged in audit)

**204 No Content**.

---

## 7. POST `/admin/auth/users/:id/reset-password`

Sends a reset link to the user's email (same flow as `/auth/password/forgot` but admin-initiated and audited). Optionally sets `users.must_change_password = true` (future flag).

**Body** `{ notify: boolean }` — if `false`, returns the one-time link directly to the admin (use sparingly).

**200 OK**
```ts
{ ok: true, link?: string }   // link only when notify=false
```

---

## 8. POST `/admin/auth/users/:id/impersonate` `[SA]`

Issues an impersonation access token (5 min, no refresh) that the superadmin can use to act as the target user. Requires `reason`. Heavily audited.

**Body** `{ reason: string }` (min 10 chars)

**200 OK**
```ts
{
  access_token: string,
  expires_in:   300,
  impersonates: { user_id: string, email: string }
}
```

The issued JWT carries `act: { sub: <admin_id> }` claim. `auth.middleware` recognises it, attaches both `req.user` (the impersonated user) and `req.actor` (the admin). Every request made with this token is audited as `event_type = 'admin_impersonate_action'`.

The token cannot perform admin actions — `requireAdmin` checks the `act` claim and refuses.

---

## 9. GET `/admin/auth/audit`

Paginated audit log.

**Query params**
```
user_id?:     uuid
actor_id?:    uuid
event_type?:  string (or csv)
success?:     boolean
from?:        ISO8601
to?:          ISO8601
page?:        int
page_size?:   int (max 500)
```

**200 OK**
```ts
{ events: AuditEvent[], page, page_size, total }
```

---

## 10. GET `/admin/auth/sessions`

System-wide active session list. Each row is one signed-in device. Useful for support ("which devices is this user on?") and security investigations.

**Query params**
```
user_id?:      uuid
platform?:     'web' | 'admin' | 'mobile-ios' | 'mobile-android'
ip?:           string
fingerprint?:  string
issued_after?: ISO8601
page?, page_size?
```

**200 OK**
```ts
{
  sessions: [
    {
      id, user_id, user_email,
      platform, device_name, device_type, os, browser, app_version,
      ip, country, city,
      issued_at, last_used_at, expires_at
    }
  ],
  page, page_size, total
}
```

---

## 11. DELETE `/admin/auth/sessions/:id`

Revoke any session by id (one specific device, any user). Audited.

**Body** `{ reason?: string }`

**204 No Content** · **404** if not found.

---

## Error Codes Specific to Admin

| Code | HTTP | Meaning |
|---|---|---|
| `USER_NOT_FOUND` | 404 | Target id does not exist |
| `CANNOT_BAN_SUPERADMIN` | 403 | Banning a superadmin requires another superadmin |
| `CANNOT_DEMOTE_SELF` | 400 | Admin cannot demote their own role |
| `IMPERSONATION_NOT_ALLOWED` | 403 | Target is a superadmin (no peer impersonation) |
| `REASON_REQUIRED` | 400 | Mutation endpoint missing audit reason |

## Audit Footprint per Endpoint

| Endpoint | `event_type` written |
|---|---|
| 3 PATCH user | `admin_user_updated` (one row per field changed) |
| 4 ban | `admin_ban` |
| 5 unban | `admin_unban` |
| 6 force-logout | `admin_force_logout` |
| 7 reset-password | `admin_reset_password` |
| 8 impersonate | `admin_impersonate_start` (and `_end` on token expiry / explicit revoke) |
| 11 session delete | `admin_session_revoked` |
