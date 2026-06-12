# 06 — Admin API Contracts

Base paths: **`/api/v1/admin/plans`** and **`/api/v1/admin/subscriptions`** · Mounted by `src/routes/admin/plan.routes.ts`.

All requests must send `Content-Type: application/json` and `x-platform: admin` and `Authorization: Bearer <admin_jwt>`. The route group is gated by `adminMiddleware` + `requireAdmin`. Endpoints marked `[SA]` additionally require `requireSuperadmin`.

All responses use the universal envelope (`success`, `message`, `data` | `error`, `meta`).

## Quick Index

| # | Method | Path | Role |
|---|---|---|---|
| 1 | GET | `/admin/plans` | admin |
| 2 | POST | `/admin/plans` | admin |
| 3 | PATCH | `/admin/plans/:id` | admin |
| 4 | POST | `/admin/plans/:id/archive` | admin |
| 5 | POST | `/admin/plans/:id/publish` | admin |
| 6 | GET | `/admin/plans/:id/subscribers` | admin |
| 7 | GET | `/admin/subscriptions` | admin |
| 8 | PATCH | `/admin/subscriptions/:id` | **superadmin [SA]** |

---

## 1. GET `/admin/plans`

List **all** plans, including archived and non-public ones.

**Query**
```
?status=active|archived           (optional)
&isPublic=true|false              (optional)
&page=1&pageSize=50
```

**200 OK**
```ts
{
  plans: Plan[],
  pagination: { page, pageSize, total }
}
```

**Errors:** `400 VALIDATION_FAILED`, `403 ADMIN_REQUIRED`.

---

## 2. POST `/admin/plans`

Create a new plan version. The id is required and must be unique — convention is `plan_<slug>_v<n>`.

**Body**
```ts
{
  id:              string,                 // 'plan_pro_v1'
  name:            string,                 // 'Pro'
  slug:            string,                 // 'pro' (must be unique)
  isPublic?:       boolean,                // default false; flip via /publish later
  isIntroductory?: boolean,                // default false
  pricing: {
    monthly: number,                       // INR paise
    annual:  number,                       // INR paise per month when billed annually
    currency: 'inr'                        // only INR supported
  },
  credits: {
    included:      number,
    rollover:      boolean,
    maxRollover:   number | null,
    topupEnabled:  boolean,
    topupPackages: { credits: number, price: number }[]   // price in paise
  },
  limits: {
    hourly: number, daily: number, weekly: number, monthly: number,
    maxContextMessages: number,
    maxFileSize: number,                   // bytes
    maxFilesPerChat: number,
    maxArtifactVersions: number
  },
  modelAccess:  string[],
  agentAccess:  string[],
  featureFlags: Record<string, boolean>
}
```

**201 Created**
```ts
{ plan: Plan }
```

`createdBy` is set from `req.user.id`; `createdAt` is `now()`.

**Errors:** `400 VALIDATION_FAILED`, `409 PLAN_ID_TAKEN`, `409 PLAN_SLUG_TAKEN`, `403 ADMIN_REQUIRED`.

---

## 3. PATCH `/admin/plans/:id`

Update a plan's **non-breaking fields** in place. Existing subscribers are **not** affected (their `plan_snapshot` is frozen).

**Allowed fields:** `pricing`, `credits`, `limits`, `modelAccess`, `agentAccess`, `featureFlags`, `isPublic`, `isIntroductory`.
**Rejected fields:** `id`, `slug`, `name`, `status`, `createdBy`, `createdAt`, `archivedAt` — modifying these requires creating a new plan version and archiving this one.

**Body** — partial of the allowed-fields above.

**200 OK**
```ts
{ plan: Plan }
```

**Errors:**
- `400 VALIDATION_FAILED`
- `400 PLAN_FIELD_IMMUTABLE` — body included a rejected field; `details` lists which
- `404 PLAN_NOT_FOUND`
- `403 ADMIN_REQUIRED`

---

## 4. POST `/admin/plans/:id/archive`

Archive a plan: existing subscribers keep it (their `plan_snapshot` is unaffected), but no new signups can pick it. Sets `status='archived'`, `archivedAt=now()`.

**200 OK**
```ts
{ plan: Plan }
```

Idempotent: archiving an already-archived plan returns `200` and the row unchanged.

**Errors:** `404 PLAN_NOT_FOUND`, `403 ADMIN_REQUIRED`.

---

## 5. POST `/admin/plans/:id/publish`

Make a plan public on `/plans` (`is_public=true`). Often paired with `POST /admin/plans/:id` followed by this endpoint to launch a new tier.

**200 OK**
```ts
{ plan: Plan }
```

Idempotent.

**Errors:**
- `404 PLAN_NOT_FOUND`
- `410 PLAN_ARCHIVED` — cannot publish an archived plan; create a new version instead
- `403 ADMIN_REQUIRED`

---

## 6. GET `/admin/plans/:id/subscribers`

Paginated list of users currently subscribed to this plan.

**Query**
```
?status=active|past_due|cancelled|paused    (optional, default 'active')
&page=1&pageSize=50
```

**200 OK**
```ts
{
  subscribers: {
    userId: string,
    email: string,
    name: string,
    subscriptionId: string,
    billingCycle: 'monthly' | 'annual',
    status: SubscriptionStatus,
    currentPeriodEnd: string
  }[],
  pagination: { page, pageSize, total }
}
```

**Errors:** `404 PLAN_NOT_FOUND`, `403 ADMIN_REQUIRED`.

---

## 7. GET `/admin/subscriptions`

Cross-plan subscription search.

**Query**
```
?userId=<uuid>          (optional)
&planId=<plan_id>       (optional)
&status=active|...      (optional)
&page=1&pageSize=50
```

**200 OK**
```ts
{
  subscriptions: Subscription[],
  pagination: { page, pageSize, total }
}
```

`Subscription` includes the frozen `planSnapshot` and the `pg_*` columns (admin-only visibility).

**Errors:** `400 VALIDATION_FAILED`, `403 ADMIN_REQUIRED`.

---

## 8. PATCH `/admin/subscriptions/:id`  `[SA]`

Superadmin-only. Manually adjust a subscription. Used for support refunds, comping pilots, fixing PG-failure aftermath.

**Body** — any subset of:
```ts
{
  status?:                'active' | 'past_due' | 'cancelled' | 'paused',
  currentPeriodStart?:    string,        // ISO; must be < currentPeriodEnd
  currentPeriodEnd?:      string,        // ISO; must be > currentPeriodStart
  cancelAtPeriodEnd?:     boolean,
  creditsGranted?:        number,        // integer >= 0
  creditsRolledOver?:     number,        // integer >= 0
  pgProvider?:            'phonepe' | null,
  pgSubscriptionId?:      string | null,
  pgMerchantTransactionId?: string | null,
  pgCustomerRef?:         string | null,
  reason:                 string         // required: free-text explanation, written into history.payload
}
```

**Behaviour**
- Runs in a transaction. Validates that the resulting row still respects the partial unique index (only one `active` per user).
- Appends `admin_adjusted` to `subscription_history` with `actor_user_id = req.user.id` and the supplied `reason`.
- Emits `subscription.admin_adjusted`.
- **Does not** call `plan.service`; it never touches the catalog.

**200 OK**
```ts
{ subscription: Subscription }
```

**Errors:**
- `400 VALIDATION_FAILED` (incl. period-window inversions, missing `reason`)
- `404 SUBSCRIPTION_NOT_FOUND`
- `409 SUBSCRIPTION_CONFLICT` — would create a second active sub for the user
- `403 SUPERADMIN_REQUIRED`

---

## Common Notes

- Money in admin payloads is **INR paise** (integer), same as user-facing.
- All admin actions write `subscription_history` (or are read-only). The history table is the audit trail; do not introduce a separate `admin_audit_for_plans` log.
- Idempotency: `archive` and `publish` are explicitly idempotent. `PATCH /admin/plans/:id` is **not** (sequential PATCHes accumulate).
- The `pg_*` fields are visible to admins so they can correlate failed PhonePe charges once that integration ships.
