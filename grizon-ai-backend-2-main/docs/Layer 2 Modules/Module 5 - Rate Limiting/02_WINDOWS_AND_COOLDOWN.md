# 02 — Sliding Windows, Cooldown, Headers, Admin Routes

The full contract for how Module 5 counts, denies, and exposes its state.

---

## A. Sliding-Window Algorithm

Each user gets four Redis sorted sets, one per window. The **score** of each member is the request timestamp in milliseconds; the **member** is a unique id (timestamp + random suffix). Trimming is on read.

### Redis keys

```
ratelimit:hourly:{userId}     (sorted set, TTL 3600s,    score = ts)
ratelimit:daily:{userId}      (sorted set, TTL 86400s,   score = ts)
ratelimit:weekly:{userId}     (sorted set, TTL 604800s,  score = ts)
ratelimit:monthly:{userId}    (sorted set, TTL 2592000s, score = ts)
ratelimit:cooldown:{userId}   (string,    TTL = admin/default duration) — set only via admin `apply` or manual service calls
```

### Per-request flow

```
On each authed, counted request:
  now = Date.now()

  if EXISTS ratelimit:cooldown:{userId} → deny (RATE_LIMIT_COOLDOWN)

  for each window in [hourly, daily, weekly, monthly] where plan.limits[window] is not null:
    key = ratelimit:{window}:{userId}
    cutoff = now - windowSec * 1000
    pipeline:
      ZREMRANGEBYSCORE key 0 cutoff
      ZCARD key

  inspect pipeline results in order:
    if any count >= plan.limits[window]:
      → deny (RATE_LIMIT_EXCEEDED), do NOT add to any window, do NOT write escalation keys

  // All windows passed → record this request in every window
  pipeline:
    for each window:
      ZADD key now {now}-{rand}
      EXPIRE key windowSec
  exec()

  → allow
```

The pipeline keeps the cost to **two Redis round-trips** per request (one read pass, one write pass). On allow, both run; on deny, only the read pass runs.

### Why sorted sets, not fixed buckets

Fixed-window counters reset at boundaries — a user can do `2 × limit` in two seconds straddling the boundary. Sorted-set sliding windows give a smooth, accurate count at the cost of slightly more Redis memory (one entry per request per window per user, expiring naturally).

For monthly windows specifically, memory is `requests_in_30d × ~32 bytes`. At Pro plan's 20K monthly cap that's < 700 KB per active user — acceptable.

---

## B. Cooldown (manual / admin only)

There is **no automatic burst cooldown** after repeated `RATE_LIMIT_EXCEEDED` responses. Enforcement is **plan windows only** until an operator applies cooldown via `POST /admin/ratelimits/:userId/cooldown` (or equivalent service call). That sets `ratelimit:cooldown:{userId}` with the requested TTL (default from `COOLDOWN_DURATION_SEC` in `src/config/rateLimit.ts`) and writes `rate_limit_events` (`event_type='cooldown'`). After each such row is inserted, `rateLimitService.applyCooldown` may insert `flagged` when the user's cooldown-event count in the last 24h reaches `FLAG_TRIGGER.count` (see implementation).

```
cooldownsToday = SELECT COUNT(*) FROM rate_limit_events
                 WHERE user_id = $1
                   AND event_type = 'cooldown'
                   AND created_at > now() - interval '24 hours'
if cooldownsToday >= FLAG_TRIGGER.count:
  INSERT rate_limit_events (type='flagged', user_id, …)
  emit ratelimit.flagged                     (consumed by admin notifications)
```

(`FLAG_TRIGGER.count` is defined in `src/config/rateLimit.ts`.)

A flagged user is **not** automatically banned; the admin gets a notification and can use Module 1's `POST /admin/auth/users/:id/ban` if the pattern is abusive.

---

## C. Counted vs Skipped Routes

Module 5 skips a small allowlist so users aren't blocked from basic UX:

| Skipped | Reason |
|---|---|
| `GET /health` | infra |
| `GET /api/v1/auth/me` | profile sidebar refresh |
| `GET /api/v1/wallet` | balance pill refresh |
| `GET /api/v1/usage/summary` | Module 6 sidebar |
| `GET /api/v1/conversations` (list only, not detail) | sidebar refresh |
| Anything under `/api/v1/admin/*` | admins are bounded by their own pipeline; no rate-limit on tools |

The list lives in `src/config/rateLimit.ts → SKIP_ROUTES` and is route-pattern based (not header-based). Skipped routes still return `X-RateLimit-*` headers reflecting current state, computed via a `peek` (`ZCARD` only, no `ZADD`).

---

## D. Response Headers (every response)

```
X-RateLimit-Hourly-Limit:     100
X-RateLimit-Hourly-Remaining: 87
X-RateLimit-Daily-Limit:      1000
X-RateLimit-Daily-Remaining:  943
X-RateLimit-Weekly-Limit:     5000
X-RateLimit-Weekly-Remaining: 4612
X-RateLimit-Monthly-Limit:    20000
X-RateLimit-Monthly-Remaining: 18441
X-RateLimit-Reset:            1714233600           (next window-tightest reset, unix seconds)
```

Headers are set **after** the middleware decides allow/deny. On deny, `Remaining: 0` for the failed window and `Retry-After: <seconds>` is also set per RFC 6585.

`null` (unlimited) windows set `X-RateLimit-<Window>-Limit: unlimited` and omit the matching `Remaining`.

---

## E. Error Envelopes

### 429 RATE_LIMIT_EXCEEDED

```json
{
  "success": false,
  "message": "You're sending requests too fast. Please wait a moment and try again.",
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "details": {
      "limitType": "hourly",
      "limit": 100,
      "resetAt": "2026-05-04T08:31:00Z",
      "retryAfterSeconds": 240
    }
  },
  "meta": { "request_id": "req_..." }
}
```

### 429 RATE_LIMIT_COOLDOWN

```json
{
  "success": false,
  "message": "You've been temporarily slowed down due to repeated bursts. Try again in a few minutes.",
  "error": {
    "code": "RATE_LIMIT_COOLDOWN",
    "details": {
      "cooldownUntil": "2026-05-04T08:46:00Z",
      "retryAfterSeconds": 540,
      "reason": "cooldown_active"
  },
  "meta": { "request_id": "req_..." }
}
```

Both use `Errors.rateLimited(...)` and `Errors.rateLimitCooldown(...)` from `src/utils/errors.ts`.

---

## F. Admin API Routes

Base: `/api/v1/admin/ratelimits`. Require `x-platform: admin` + admin role per global pipeline. Postman group: **Module 5 - Admin RateLimit Contracts**.

### `GET /admin/ratelimits/users`

Paginated list of users with **active** rate-limit state: non-zero usage in at least one sliding window and/or an active cooldown. Sorted by highest `max_usage_percent` first.

```
page?, page_size?          (defaults 1, 25; max page_size 100)
search?:                   (optional; matches user name or email, case-insensitive)
plan_slug?:                (optional; filter by active subscription plan slug)
```

**200 OK**
```ts
{
  users: [
    {
      user_id, name, email, plan_slug, plan_name,
      cooldown: { active, cooldownUntil },
      windows: {
        hourly:  { used, limit, remaining, usagePercent, resetAt },
        daily:   { … },
        weekly:  { … },
        monthly: { … },
      },
      max_usage_percent: number
    }
  ],
  page, page_size, total,
  degraded?: boolean        // true when Redis is unavailable (empty users list)
}
```

### `POST /admin/ratelimits/:userId/reset-window`

Clears **one** sliding window counter for the user. Other windows and cooldown are unchanged. Audited.

**Body**
```ts
{
  window: 'hourly' | 'daily' | 'weekly' | 'monthly',
  reason: string             // min 10 chars
}
```

**Server logic:**
```
DEL ratelimit:{window}:{userId}
INSERT rate_limit_events (event_type='cleared', limit_type=window, metadata={ actor_id, reason, window })
```

**200 OK** → `{ userId, window }` in envelope `data` · **Errors:** `400 REASON_REQUIRED`, `404 USER_NOT_FOUND`.

### `GET /admin/ratelimits/events`

Paginated audit log.

```
user_id?:    uuid
event_type?: hit (legacy) | cooldown | flagged | cleared | flag_resolved
limit_type?: hourly | daily | weekly | monthly
from?:       ISO8601
to?:         ISO8601
page?, page_size?
```

**200 OK**
```ts
{
  events: [
    { id, user_id, user_email, event_type, limit_type, created_at, metadata }
  ],
  page, page_size, total
}
```

### `POST /admin/ratelimits/:userId/clear`

Wipes all window counters and any active cooldown for the user. Audited.

**Body** `{ reason: string }` (min 10 chars)

**Server logic:**
```
DEL ratelimit:hourly:{userId}
DEL ratelimit:daily:{userId}
DEL ratelimit:weekly:{userId}
DEL ratelimit:monthly:{userId}
DEL ratelimit:cooldown:{userId}
INSERT rate_limit_events (event_type='cleared', user_id, metadata={ actor_id, reason })
emit ratelimit.cleared
```

**204 No Content** · **Errors:** `400 REASON_REQUIRED`, `404 USER_NOT_FOUND`.

### `POST /admin/ratelimits/:userId/cooldown`

Manually apply or remove a cooldown.

**Body**
```ts
{
  action:   'apply' | 'remove',
  duration?: number,          // seconds; default 900 for 'apply'
  reason:   string             // min 10 chars
}
```

**200 OK** → `{ cooldownUntil: ISO8601 | null }`

### `GET /admin/ratelimits/flagged`

List users currently flagged for manual review (i.e. ≥ 5 cooldowns in the last 24 h, not yet resolved).

**200 OK**
```ts
{
  flagged: [
    {
      user_id, user_email, plan_slug,
      cooldowns_24h: 7,
      first_flag_at: ISO8601,
      last_event_at: ISO8601
    }
  ]
}
```

### Optional `PATCH /admin/ratelimits/flagged/:userId`

Resolve the flag (mark reviewed, optionally whitelist for 24 h, or escalate to ban via Module 1).

**Body**
```ts
{
  action: 'resolve_no_action' | 'whitelist_24h' | 'escalate_ban',
  notes:  string
}
```

If `action === 'escalate_ban'`, Module 5 calls into Module 1's `auth.service.ban(userId, reason='ratelimit_abuse')`. Otherwise it just inserts a `rate_limit_events` row with `event_type='flag_resolved'`.

---

## G. Error Code Reference

| Code | HTTP | Source |
|---|---|---|
| `RATE_LIMIT_EXCEEDED` | 429 | middleware |
| `RATE_LIMIT_COOLDOWN` | 429 | middleware (cooldown active) |
| `REASON_REQUIRED` | 400 | admin clear / cooldown |
| `USER_NOT_FOUND` | 404 | admin endpoints |

All registered as `Errors.*` factories per [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

---

## H. Redis-Down Behaviour

`getRedisClient()` is fail-fast (1.5 s). If Redis is unavailable:

- The middleware **logs WARN** (`rate_limit_redis_unavailable`) and **fails open** — the request is allowed, no counters incremented, no headers set. Same posture as Module 3's `requireFeatureWithLimit`.
- A `ratelimit.degraded` metric is incremented (when the metrics module lands).
- Rationale: a brief Redis blip should not 429 the whole platform. Hard hourly caps are nice-to-have; correctness of billing (Module 4) is what we never compromise.

---

## I. Security Notes

| Concern | Mitigation |
|---|---|
| User forges `req.plan.limits` | Impossible; `req.plan` is the frozen snapshot from Module 2. |
| Counter inflation by another user | All keys are scoped to `userId`. |
| Bypass via skipped route enumeration | Skip list is short, well-known, and limited to genuinely cheap GETs. Each entry is justified in `SKIP_ROUTES` comments. |
| Header leakage | `X-RateLimit-*` headers expose only the caller's own state. |
| Audit-table flooding | `cooldown`, `flagged`, `cleared`, and `flag_resolved` events are persisted for admin actions and escalation. Plan-window denials do not write `hit` rows. `allow` is never written. Index on `(user_id, created_at desc)` keeps queries cheap. |
| Cooldown bypass via plan upgrade | Cooldown key is user-scoped, not plan-scoped. Upgrading mid-cooldown does not lift it; admin clear is required. |
| Sliding-set memory blow-up | Caps at `monthly_limit` entries per user (~700 KB worst case at Pro). Enterprise unlimited monthly is treated as `null` → no monthly key. |
