# 09 — Dependencies

How Module 2 connects to the rest of Layer 2 and the infrastructure layer.

## Infrastructure It Consumes

| Resource | Purpose | Failure mode |
|---|---|---|
| **PostgreSQL 16** | All three module tables (`plans`, `subscriptions`, `subscription_history`) | DB down → 503 from `planMiddleware` (cannot load sub); all routed traffic fails fast |
| **In-process EventEmitter** | Domain event fan-out (`subscription.upgraded`, etc.) | Synchronous; subscriber crashes are caught and logged, never bubbled |
| **Config / env** | `FREE_PLAN_ID`, `PHONEPE_*` (loaded but unused in this module) | Missing key at boot → process refuses to start |
| **PhonePe Standard Checkout API** | **Reserved only.** Not called in Module 2. The future integration will use `pay/v1/pay`, `pay/v1/refund`, and the X-VERIFY header. | N/A — adapter throws `NOT_IMPLEMENTED` |

No Redis dependency in Module 2 today. When the renewal cron and per-request caching land (with Module 5), Redis will hold the per-user active-subscription cache.

## Modules That Depend on Module 2

Every other authenticated-route module in Layer 2 reads `req.plan` and/or `req.subscription`.

| Downstream module | Reads |
|---|---|
| Module 3 — Feature Flags | `req.plan.featureFlags[<flag>]` to gate feature access (`requireFeature` / `requireFeatureWithLimit`) |
| Module 4 — Credit Wallet | `req.plan.credits.included` (initial grant), `req.plan.credits.rollover` / `.maxRollover` (renewal); listens to `subscription.upgraded` and `subscription.renewed` events to write wallet balances |
| Module 5 — Rate Limit | `req.plan.limits.{hourly,daily,weekly,monthly}` for per-user buckets; bucket key is `req.user.id`, but the cap is plan-driven |
| Module 6 — Usage Tracking | `req.subscription.id` and `req.plan.id` written into the usage record so analytics can attribute cost to a plan |
| Module 9 — Sanitiser | `req.plan.limits.{maxFileSize, maxContextMessages, maxFilesPerChat, maxArtifactVersions}` for size enforcement |
| Module 10 — Smart Router | `req.plan.modelAccess` and `req.plan.agentAccess` for routing decisions |

If `req.plan` is missing on an authenticated route, downstream modules treat it as a programming bug (not a user error). `planMiddleware` guarantees presence except on the public allowlist.

## Modules Module 2 Depends On

| Upstream | Dependency |
|---|---|
| **Module 1 — Auth & Identity** | `req.user.id` (required), `req.user.role` (for admin gating). Module 1's `auth.service.register` calls `subscription.service.assignFreePlan` directly. |
| **Foundation utilities** | `src/utils/response.ts` (envelope), `src/utils/errors.ts` (`AppError` + `Errors.*`), `src/utils/logger.ts`, `src/db/pool.ts` (`getPool`). |
| **Migration runner** | `src/db/migrations/run.ts` (shared with all modules). |

It deliberately does **not** call into Wallet, Feature Flags, Rate Limit, or any business module. Plan/subscription is upstream of all of them and must avoid circular dependencies. Wallet effects of upgrades happen via the **event emitter**, not direct calls.

## Events Emitted

Module 2 publishes typed events on the in-process emitter (`src/events/plan.events.ts`). Subscribers run synchronously in a try/catch — Module 2 never `await`s them and never lets a subscriber failure roll back its own transaction.

| Event | Payload | Subscribers (planned) |
|---|---|---|
| `plan.created` | `{ planId, slug, actorUserId }` | Analytics (catalog change), Notification (internal) |
| `plan.updated` | `{ planId, changedFields, actorUserId }` | Analytics |
| `plan.archived` | `{ planId, actorUserId }` | Analytics, Notification (subscribers see banner) |
| `plan.published` | `{ planId, actorUserId }` | Marketing webhook (future) |
| `subscription.created` | `{ userId, subscriptionId, planId, billingCycle, creditsGranted }` | Module 4 (wallet grant), Analytics |
| `subscription.upgraded` | `{ userId, subscriptionId, fromPlanId, toPlanId, billingCycle, creditsGranted, creditsRolledOver }` | Module 4 (wallet grant), Notification (welcome to Pro), Analytics |
| `subscription.cancel_scheduled` | `{ userId, subscriptionId, effectiveAt }` | Notification (confirmation email), Analytics |
| `subscription.cancelled` | `{ userId, subscriptionId, sourcePlanId, mode: 'graceful' \| 'immediate' }` | Module 4 (wallet zero-out for immediate), Notification, Analytics |
| `subscription.renewed` | `{ userId, subscriptionId, planId, creditsGranted, creditsRolledOver }` | Module 4 (wallet refresh), Analytics |
| `subscription.admin_adjusted` | `{ subscriptionId, userId, actorUserId, reason, patch }` | Notification (security email to user), Audit dashboard |

Like Module 1's events, these will graduate to Redis pub/sub or BullMQ when the system splits across processes — without changing the typed payload contract.

## Public Contract Recap

What downstream code can rely on after `planMiddleware` runs:

```ts
req.subscription: {
  id: string;
  userId: string;
  planId: string;
  planSnapshot: Plan;
  billingCycle: 'monthly' | 'annual';
  status: 'active' | 'past_due' | 'cancelled' | 'paused';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  creditsGranted: number;
  creditsRolledOver: number;
  // pg_* fields exist on the type but are admin-only at the API layer
  createdAt: Date;
};

req.plan: Plan;   // = req.subscription.planSnapshot
                  // FROZEN at subscription/upgrade time. Downstream must read entitlements
                  // from this object, NEVER from a fresh DB lookup of `plans`.
```

These shapes live in `src/types/plan.d.ts` and augment `Express.Request` so all downstream modules type-check against the same contract.

## Boot Order

```
1. Load env config (fail-fast on missing FREE_PLAN_ID, etc.)
2. Initialise DB pool
3. Run migrations 001–008 (Module 1) and 009–012 (Module 2) — idempotent
4. Mount middleware in fixed order: ... → planMiddleware → ...
5. Mount /api/v1/{subscription,plans} and /api/v1/admin/{plans,subscriptions} route files
6. Open HTTP listener
```

If migration 012 cannot find a superadmin row to use for `created_by`, it fails loudly. Operationally, Module 1's seed (008) must run before Module 2's seed (012).

## Out-of-Process Future Work

| Capability | Owning module / phase | Touches Module 2 how |
|---|---|---|
| Renewal cron worker | Future Module (likely co-located with Module 4) | Reads `subscriptions WHERE current_period_end <= now()`, emits `subscription.renewed` |
| PhonePe live charges | Future PhonePe integration module | Calls `phonepeAdapter` (real impl), writes `pg_*` columns via `adminAdjustSubscription` or a dedicated service method |
| Webhook receiver for PhonePe callbacks | Future PhonePe integration | Verifies X-VERIFY, looks up subscription by `pg_merchant_transaction_id`, transitions status |
| Per-user subscription cache | Future Module 5 work | Wraps `getActiveSubscriptionForUser` with a Redis layer; invalidates on every emitted Module 2 event |

None of these change Module 2's public contract — they add capabilities behind it.
