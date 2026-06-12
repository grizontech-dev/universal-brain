# 02 — File Structure

Every file owned by Module 2, where it lives, and what it does. Paths are relative to the repo root (`src/...`).

## Tree

```
src/
├── config/
│   └── plan.ts                            ← FREE plan id, currency (INR), PhonePe env keys (loaded but unused), defaults
│
├── gateway/                               ← Express middleware (run in pipeline order)
│   └── plan.middleware.ts                 ← Loads active subscription, attaches req.plan + req.subscription (currently a stub)
│
├── services/                              ← Business logic, called from routes
│   ├── plan.service.ts                    ← list / get / create / update / archive / publish plans, subscribers-of-plan
│   ├── subscription.service.ts            ← getActive / assignFree / upgrade / cancel / list / adminAdjust + period & rollover math
│   └── payment/
│       └── phonepe.adapter.ts             ← STUB: PaymentGatewayAdapter interface, PhonePe-shaped methods (throws NOT_IMPLEMENTED)
│
├── routes/
│   ├── user/
│   │   └── plan.routes.ts                 ← /api/v1/{subscription, plans} (4 endpoints)
│   └── admin/
│       └── plan.routes.ts                 ← /api/v1/admin/{plans, subscriptions} (8 endpoints)
│
├── db/
│   └── migrations/
│       ├── 009_plans.sql
│       ├── 010_subscriptions.sql
│       ├── 011_subscription_history.sql
│       └── 012_seed_free_plan.sql         ← Inserts canonical plan_free_v1 row
│
├── types/
│   └── plan.d.ts                          ← Plan, Subscription, PlanLimits, PlanCredits, CreditPackage,
│                                            SubscriptionHistoryEntry; augments Express.Request
│
└── events/
    └── plan.events.ts                     ← typed emitter: plan.created, subscription.upgraded, subscription.cancelled, ...
```

## File-by-File

### Config

| File | Purpose | Exports |
|---|---|---|
| `src/config/plan.ts` | Single source of truth for plan-system knobs. Loaded once at boot, validated with Zod. | `freePlanId` (`'plan_free_v1'`), `currency` (`'inr'`), `defaultBillingCycle` (`'monthly'`), `phonepe` (`{merchantId, saltKey, saltIndex, baseUrl}` — read from env, never used in this module), `rolloverGracePeriodDays` |

### Middleware

| File | Mounts on | Behaviour |
|---|---|---|
| `src/gateway/plan.middleware.ts` | Global, after `authMiddleware` & `adminMiddleware` (slot already reserved at `src/app.ts:27`) | If no `req.user` or path is in public allowlist → `next()`. Else load active subscription via `subscription.service.getActiveSubscriptionForUser(req.user.id)`. If miss, call `assignFreePlan(userId)` (idempotent) and re-load. Attach `req.subscription` and `req.plan = subscription.planSnapshot`. Per-request memoisation via `WeakMap<Request, Subscription>` to avoid double-query if downstream calls the loader again. |

### Services

| File | Purpose | Exports |
|---|---|---|
| `src/services/plan.service.ts` | All CRUD + read paths over `plans`. Enforces immutability rules on `update`. | `listPublicPlans({page, pageSize})`, `listAllPlans({status?, page, pageSize})`, `getPlanById(id)`, `createPlan(payload, createdBy)`, `updatePlan(id, patch)` (rejects breaking-field changes with `PLAN_FIELD_IMMUTABLE`), `archivePlan(id)`, `publishPlan(id)`, `getSubscribersOfPlan(planId, {page, pageSize})` |
| `src/services/subscription.service.ts` | All write/read paths over `subscriptions` and `subscription_history`. Owns snapshot freezing, period math, rollover math. | `getActiveSubscriptionForUser(userId)`, `assignFreePlan(userId)` (idempotent — does nothing if active sub exists), `upgradeSubscription(userId, {planId, billingCycle})` (rejects FREE plan id with `INVALID_UPGRADE_TARGET`; rejects same plan+cycle with `ALREADY_ON_PLAN`), `cancelSubscription(userId, {immediate})` (rejects FREE with `CANNOT_CANCEL_FREE_PLAN`), `listSubscriptions({userId?, planId?, status?, page, pageSize})`, `adminAdjustSubscription(id, patch)`, `computePeriodWindow(billingCycle, startAt)`, `computeRolloverGrant(plan, unusedCredits)`, `appendHistory(subscriptionId, event, payload, actorUserId?)` |
| `src/services/payment/phonepe.adapter.ts` | **STUB ONLY.** Locks in the contract a future PhonePe integration must satisfy. Every method throws `AppError('NOT_IMPLEMENTED', 501)`. | `interface PaymentGatewayAdapter { createOrder({merchantTransactionId, amount, redirectUrl, callbackUrl, mobileNumber?}); verifyCallback({xVerify, body}); refund({merchantTransactionId, amount, originalTxnId}); }` and a `phonepeAdapter: PaymentGatewayAdapter` instance that throws on every call. |

### Routes

| File | Mounts on | Endpoints |
|---|---|---|
| `src/routes/user/plan.routes.ts` | `/api/v1` | `GET /subscription`, `POST /subscription/upgrade`, `POST /subscription/cancel`, `GET /plans` |
| `src/routes/admin/plan.routes.ts` | `/api/v1/admin` | `GET /plans`, `POST /plans`, `PATCH /plans/:id`, `POST /plans/:id/archive`, `POST /plans/:id/publish`, `GET /plans/:id/subscribers`, `GET /subscriptions`, `PATCH /subscriptions/:id` (`requireSuperadmin`) |

Routes are thin: validate body with Zod → call service → reply via `ok` / `created` / `fail` from `src/utils/response.ts`. No business logic in route files.

### Migrations

| File | What it creates |
|---|---|
| `src/db/migrations/009_plans.sql` | `plans` table + indexes `(status, is_public)`, `(slug)` |
| `src/db/migrations/010_subscriptions.sql` | `subscriptions` table + partial unique index on `(user_id) WHERE status='active'` + indexes on `(user_id)`, `(plan_id)`, `(status)`, `(current_period_end)` |
| `src/db/migrations/011_subscription_history.sql` | `subscription_history` table + index `(subscription_id, occurred_at DESC)` |
| `src/db/migrations/012_seed_free_plan.sql` | Inserts `plan_free_v1` (active, public, ₹0, modest credits/limits, all premium feature flags off). Uses superadmin id from `008_seed_superadmin.sql` for `created_by`. |

Migrations run via the existing idempotent runner at `src/db/migrations/run.ts`.

### Types

| File | Purpose | Exports |
|---|---|---|
| `src/types/plan.d.ts` | TypeScript contracts shared by services, routes, and downstream modules. | `Plan`, `Subscription`, `PlanLimits`, `PlanCredits`, `CreditPackage`, `SubscriptionStatus`, `BillingCycle`, `SubscriptionHistoryEvent`, `SubscriptionHistoryEntry`. Augments `Express.Request` with `plan?: Plan` and `subscription?: Subscription`. |

### Events

| File | Purpose | Events emitted |
|---|---|---|
| `src/events/plan.events.ts` | In-process typed emitter, mirrors the pattern in `events/auth.events.ts`. Auth-style: emit-and-forget; never `await`ed. | `plan.created`, `plan.archived`, `plan.published`, `plan.updated`, `subscription.created` (incl. FREE assignment), `subscription.upgraded`, `subscription.cancelled`, `subscription.cancel_scheduled`, `subscription.renewed`, `subscription.admin_adjusted` |

## Files Touched (not owned)

| File | Change |
|---|---|
| `src/gateway/plan.middleware.ts` | Replace stub body with real loader (see Middleware row above). |
| `src/routes/user/index.ts` | `userRouter.use(planRoutes)` — mount the new user route file. |
| `src/routes/admin/index.ts` | `adminRouter.use(planRoutes)` — mount the new admin route file. |
| `src/services/auth.service.ts` | After successful registration, call `subscription.service.assignFreePlan(user.id)` so every new user lands on FREE. Lazy-import to avoid a circular dep. |
| `src/utils/errors.ts` | Add `Errors.planNotFound`, `Errors.planArchived`, `Errors.planNotPublic`, `Errors.alreadyOnPlan`, `Errors.invalidBillingCycle`, `Errors.subscriptionNotFound`, `Errors.planFieldImmutable`, `Errors.invalidUpgradeTarget`, `Errors.cannotCancelFreePlan`. |
| `grizon-ai-backend-2.postman_collection.json` | Add two new groups: `Module 2 - User Plan Contracts` and `Module 2 - Admin Plan Contracts`. |
| `docs/LLM_NEW_MODULE_PROMPT.md` | Append the two new Postman group names to the list. |

## Test Files

```
test/
├── unit/
│   └── services/
│       ├── plan.service.test.ts                ← immutability guard, archive/publish state, public filter
│       └── subscription.service.test.ts        ← rollover (with cap, no cap, disabled), period math, snapshot freeze, ALREADY_ON_PLAN, cancel modes
├── integration/
│   ├── routes/
│   │   ├── user.plan.routes.test.ts            ← GET /subscription on fresh user → FREE; upgrade → 201; cancel; GET /plans (public)
│   │   └── admin.plan.routes.test.ts           ← admin CRUD; archive blocks new signups; superadmin guard on PATCH /admin/subscriptions/:id
│   └── middleware/
│       └── plan.middleware.test.ts             ← req.plan populated on authed routes; FREE auto-assignment idempotent; allowlist skipped
```

## Boot-Time Dependencies (this module)

1. `users` table exists (Module 1 migrations 001 + 008)
2. `getPool()` returns a connected Postgres client
3. `superadmin` row exists (referenced by `012_seed_free_plan.sql` for `created_by`)

If any of those is missing, migrations 009–012 fail loudly — by design.
