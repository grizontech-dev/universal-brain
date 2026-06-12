# 05 — User API Contracts

Base paths: **`/api/v1/subscription`** and **`/api/v1/plans`** · Mounted by `src/routes/user/plan.routes.ts`.

All requests must send `Content-Type: application/json` and `x-platform: web | mobile-ios | mobile-android`. Authenticated routes require `Authorization: Bearer <access_jwt>` (handled by Module 1's `authMiddleware`).

All responses use the universal envelope:

```ts
{ success: true,  message: string, data: <T>,    meta?: { request_id, ... } }
{ success: false, message: string, error: { code, details? }, meta?: { request_id } }
```

## Quick Index

| # | Method | Path | Auth |
|---|---|---|---|
| 1 | GET | `/plans` | public |
| 2 | GET | `/subscription` | JWT |
| 3 | POST | `/subscription/upgrade` | JWT |
| 4 | POST | `/subscription/cancel` | JWT |

---

## 1. GET `/plans`

Public catalog used by the pricing page. Returns only `status='active'` AND `is_public=true` plans.

**Query**
```
?page=1&pageSize=20
```

**200 OK**
```ts
{
  plans: Plan[],
  pagination: { page: number, pageSize: number, total: number }
}
```

`Plan` shape per `src/types/plan.d.ts` (matches the catalog row, with `pricing` in INR paise).

**Notes**
- No `Authorization` required. Path is in the auth public allowlist.
- Always returns `200`; an empty catalog returns `plans: []`.
- Sorted by `pricing.monthly ASC` (cheapest first), then `created_at ASC`.

**Errors:** `400 VALIDATION_FAILED` (bad query), `500 INTERNAL_ERROR`.

---

## 2. GET `/subscription`

Returns the caller's current active subscription, including the **frozen plan snapshot** they're entitled to.

**200 OK**
```ts
{
  subscription: {
    id: string,
    planId: string,
    planSnapshot: Plan,                    // what THIS user gets right now
    billingCycle: 'monthly' | 'annual',
    status: 'active' | 'past_due' | 'cancelled' | 'paused',
    currentPeriodStart: string,            // ISO 8601
    currentPeriodEnd: string,              // ISO 8601
    cancelAtPeriodEnd: boolean,
    creditsGranted: number,
    creditsRolledOver: number,
    createdAt: string
  }
}
```

**Notes**
- A fresh user (just registered) is auto-assigned the FREE plan by `planMiddleware`, so this endpoint always returns a subscription — never 404.
- `pg_*` columns are intentionally excluded from the response (internal-only).

**Errors:** `401 NOT_AUTHENTICATED` (no Bearer), `500 INTERNAL_ERROR`.

---

## 3. POST `/subscription/upgrade`

Upgrade (or sideways-change) to a different paid plan. Starts a new period at `now()` with no proration. The old subscription is moved to `status='cancelled'` in the same transaction.

**Body**
```ts
{
  planId:       string,                    // target plan id, e.g. 'plan_pro_v1'
  billingCycle: 'monthly' | 'annual'
}
```

**201 Created**
```ts
{
  subscription: Subscription               // same shape as GET /subscription
}
```

**Behaviour**
- New `currentPeriodStart = now()`.
- New `currentPeriodEnd = now() + (billingCycle === 'annual' ? 1 year : 1 month)`.
- `plan_snapshot` is frozen from the live `plans` row at this moment.
- `creditsGranted = plan.credits.included`. Rollover from the prior period is computed (`creditsRolledOver`) and stored, but the actual wallet credit is performed by Module 4 in response to the `subscription.upgraded` event.
- `subscription_history` gets an `upgraded` row with `from_plan_id` / `to_plan_id`.

**Errors**
- `400 VALIDATION_FAILED` — bad body shape
- `400 INVALID_BILLING_CYCLE`
- `400 INVALID_UPGRADE_TARGET` — caller passed FREE plan id (use `/subscription/cancel` instead)
- `404 PLAN_NOT_FOUND`
- `403 PLAN_NOT_PUBLIC` — plan exists but `is_public=false`
- `410 PLAN_ARCHIVED`
- `409 ALREADY_ON_PLAN` — caller already has this exact plan + cycle
- `409 SUBSCRIPTION_CONFLICT` — concurrent upgrade race (retry once)

> **No payment is taken.** Until the future PhonePe integration ships, upgrades succeed without a real charge. Admins can use this gap to manually provision pilot accounts.

---

## 4. POST `/subscription/cancel`

Cancel the current paid subscription. Defaults to **graceful** (the user keeps their plan until `currentPeriodEnd`, then drops to FREE). Pass `immediate: true` to drop to FREE right now.

**Body**
```ts
{
  immediate?: boolean    // default false
}
```

**200 OK** — graceful (default)
```ts
{
  subscription: Subscription,              // status still 'active', cancelAtPeriodEnd: true
  effectiveAt: string                      // = currentPeriodEnd (ISO)
}
```

**200 OK** — `immediate: true`
```ts
{
  subscription: Subscription,              // the new FREE subscription, freshly created
  cancelledSubscriptionId: string          // id of the just-cancelled paid sub
}
```

**Behaviour**
- **Graceful (`immediate=false`):** sets `cancel_at_period_end=true` on the active sub. Appends `cancel_scheduled` to history. Emits `subscription.cancel_scheduled`. The renewal cron (future) will flip to `cancelled` and call `assignFreePlan()` at `currentPeriodEnd`.
- **Immediate (`immediate=true`):** in a single transaction sets the active sub to `status='cancelled'`, then inserts a new FREE active sub via `assignFreePlan()`. Appends `cancelled` to history on the old, `created` on the new. Emits `subscription.cancelled`.

**Errors**
- `401 NOT_AUTHENTICATED`
- `400 CANNOT_CANCEL_FREE_PLAN` — the active sub is already FREE; nothing to cancel
- `404 SUBSCRIPTION_NOT_FOUND` — only possible if the user record is corrupt; planMiddleware should have made this impossible
- `500 INTERNAL_ERROR`

---

## Notes Common to All Endpoints

- All money is **INR paise** (integer). Frontends should divide by 100 for display.
- Timestamps are **ISO 8601 with timezone** (Postgres `timestamptz`).
- Pagination shape is consistent with Module 1.
- `request_id` in `meta` is propagated from `requestId` middleware and helps correlate logs.
