# 03 — Universal Request / Response

Every API endpoint in this codebase speaks the same envelope. The frontend can rely on the shape of *every* response — both success and error — without per-endpoint conditionals.

## Request Convention

### Headers (every request)

| Header | Required | Notes |
|---|---|---|
| `Content-Type: application/json` | yes (when body) | The only body format we accept |
| `Authorization: Bearer <jwt>` | on authed routes | Module 1 issues this |
| `x-platform` | yes | `web` \| `admin` \| `mobile-ios` \| `mobile-android` |
| `x-device-name` | optional | Human-readable label for the sessions list |
| `x-request-id` | optional | If the client supplies one, the server reuses it; otherwise the server generates a UUID and echoes it back |
| `Accept-Language` | optional | Used to localise the `message` field on errors when a translation exists |

### Body shape

We do not standardise input bodies — they are per-endpoint and validated by Zod on entry. See [04_ERROR_HANDLING.md §VALIDATION_FAILED](04_ERROR_HANDLING.md) for how Zod errors are converted into the universal envelope.

## Response Envelope

**Both** success and failure responses share this top-level shape:

```ts
type Envelope<T = unknown> =
  | {
      success: true,
      message: string,                  // human-readable, safe to display
      data:    T,                       // the actual payload (never null when success)
      meta?:   ResponseMeta              // pagination, rate-limit headers mirror, etc.
    }
  | {
      success: false,
      message: string,                  // human-readable, safe to display
      error: {
        code:    string,                // stable machine code, e.g. 'INVALID_CREDENTIALS'
        details?: unknown               // optional structured info (field errors, retry-after, …)
      },
      meta?:   ResponseMeta
    };
```

> **`message` is mandatory in both branches.** It is the string the frontend can render to the user as-is. Use it for toasts, banners, modal copy. Internal codes go in `error.code` (failure) or are not needed (success).

## Success Examples

### Single object

`GET /auth/me`

```json
{
  "success": true,
  "message": "Profile loaded.",
  "data": {
    "id": "usr_…",
    "email": "maulik@example.com",
    "name": "Maulik",
    "bio": "Indie hacker",
    "role": "user",
    "linked_providers": [
      { "provider": "google", "provider_email": "maulik@gmail.com", "linked_at": "2026-04-01T08:01:00Z" }
    ]
  },
  "meta": { "request_id": "req_8a…" }
}
```

### Action with side-effects

`POST /auth/login`

```json
{
  "success": true,
  "message": "Welcome back, Maulik.",
  "data": {
    "user": { "id": "usr_…", "email": "…", "name": "Maulik" },
    "access_token":  "eyJ…",
    "refresh_token": "rt_…",
    "expires_in": 900
  },
  "meta": { "request_id": "req_…" }
}
```

### Paginated list

`GET /conversations?page=1&page_size=25`

```json
{
  "success": true,
  "message": "Loaded 25 conversations.",
  "data": [ { "id": "…", "title": "…" }, … ],
  "meta": {
    "request_id": "req_…",
    "pagination": { "page": 1, "page_size": 25, "total": 312, "total_pages": 13 }
  }
}
```

### No body (used to be 204)

We **prefer 200 with an empty `data: {}` envelope** over `204 No Content`, so the client can always rely on a `message`:

`POST /auth/logout`

```json
{
  "success": true,
  "message": "Signed out from this device.",
  "data": {},
  "meta": { "request_id": "req_…" }
}
```

(Status code is still 200; the only 204s in the system are pre-flight CORS responses.)

## Error Envelope

Same top-level shape, `success: false`. The `message` is what the frontend shows; `error.code` is what conditionals branch on.

```json
{
  "success": false,
  "message": "Email or password is incorrect.",
  "error": {
    "code": "INVALID_CREDENTIALS"
  },
  "meta": { "request_id": "req_…" }
}
```

### With field-level details

`POST /auth/register` body fails validation:

```json
{
  "success": false,
  "message": "Please fix the highlighted fields.",
  "error": {
    "code": "VALIDATION_FAILED",
    "details": {
      "fields": [
        { "path": "email",    "code": "INVALID_EMAIL",      "message": "Enter a valid email address." },
        { "path": "password", "code": "PASSWORD_TOO_SHORT", "message": "Password must be at least 10 characters." }
      ]
    }
  },
  "meta": { "request_id": "req_…" }
}
```

The frontend renders `message` at the top of the form and the per-field `message` next to each input.

### With retry hints

`429 Too Many Requests`:

```json
{
  "success": false,
  "message": "You're sending requests too fast. Please wait a moment and try again.",
  "error": {
    "code": "RATE_LIMITED",
    "details": { "retry_after_seconds": 42, "limit_type": "hourly" }
  },
  "meta": { "request_id": "req_…" }
}
```

## `meta`

Common keys (all optional):

| Key | When |
|---|---|
| `request_id` | Always present — same as `x-request-id` response header |
| `pagination` | List endpoints |
| `rate_limit` | `{ remaining_hour, remaining_day, reset_at }` mirrored from headers, for clients that can't read headers easily |
| `deprecation` | `{ sunset: '2026-09-01', alternative: '/api/v2/...' }` when an endpoint is on the way out |

## HTTP Status Code Mapping

| Status | When | `error.code` examples |
|---|---|---|
| 200 | Success | — |
| 201 | Resource created (we keep using 200 unless creation is the entire purpose) | — |
| 400 | Bad input from client | `VALIDATION_FAILED`, `INVALID_GOOGLE_TOKEN`, `PLATFORM_MISMATCH` |
| 401 | Not authenticated | `NOT_AUTHENTICATED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` |
| 402 | Payment required (wallet empty) | `INSUFFICIENT_CREDITS` |
| 403 | Authenticated but not allowed | `USER_BANNED`, `ADMIN_REQUIRED`, `FEATURE_NOT_AVAILABLE`, `CAPTCHA_REQUIRED` |
| 404 | Resource doesn't exist (or is hidden) | `NOT_FOUND` |
| 409 | Conflict with current state | `EMAIL_TAKEN`, `GOOGLE_ALREADY_LINKED` |
| 422 | Semantically invalid (rare; we usually use 400) | — |
| 423 | Account locked | `ACCOUNT_LOCKED` |
| 429 | Rate-limited | `RATE_LIMITED`, `TOO_MANY_REQUESTS` |
| 500 | Bug / unexpected exception | `INTERNAL_ERROR` |
| 502 / 503 | Upstream provider failure | `UPSTREAM_UNAVAILABLE` |

## Headers Always Set on Responses

| Header | Value |
|---|---|
| `x-request-id` | Echo of client value or server-generated UUID |
| `x-user-id` | On authed responses (Module 1) |
| `x-session-id` | On authed responses (Module 1) |
| `x-rate-limit-*` | Set by Module 5 — see [Layer 2 §7](../LAYER2_API_GATEWAY.md#7-module-5--rate-limiting-4-tier) |

## Streaming (SSE)

The chat endpoint streams via Server-Sent Events. The envelope still applies — the **first** SSE event is always either `{ event: 'queued', data: {…} }` or an error envelope serialised as `{ event: 'error', data: <Envelope> }`. After the first event, individual chunks use their own per-event shape (see Module 7 in [LAYER2_API_GATEWAY.md §9](../LAYER2_API_GATEWAY.md)). This way clients can detect a failed start without parsing a chunk.

## Helpers

`src/utils/response.ts` exposes:

```ts
ok<T>(res: Response, data: T, message: string, meta?: ResponseMeta): void;
created<T>(res: Response, data: T, message: string, meta?: ResponseMeta): void;
fail(res: Response, status: number, code: string, message: string, details?: unknown): void;
```

Routes never construct envelopes manually. They call `ok(res, …)` or throw an `AppError` (see [04_ERROR_HANDLING.md](04_ERROR_HANDLING.md)) and the error middleware handles the rest.
