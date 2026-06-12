# 04 — Access Control

How Module 2 decides *who can see / change which plan or subscription*. Module 2 does **not** verify identity — that's Module 1's job. It only enforces role-based authorization on its own routes.

## Roles Read

Same enum as Module 1:

```ts
type UserRole = 'user' | 'admin' | 'superadmin';
```

| Role | What they can do in Module 2 |
|---|---|
| `user` | Read own subscription; upgrade; cancel; list public plans |
| `admin` | Everything `user` can + full plan CRUD + read all subscriptions |
| `superadmin` | Everything `admin` can + adjust *any* subscription's period/status/credits (`PATCH /admin/subscriptions/:id`) |

## Middleware Chain

Module 2 owns a single middleware: `planMiddleware`. It runs **after** auth but **before** every business module. It does not gate access by itself — it only enriches the request:

```
Request
  ↓
1. requestId
  ↓
2. authMiddleware                ← Module 1 sets req.user
  ↓
3. adminMiddleware               ← Module 1 enforces /api/v1/admin/*
  ↓
4. requestLogger / helmet / cors / json
  ↓
5. planMiddleware                ← THIS MODULE: load active sub → req.subscription, req.plan
  ↓
6. featureFlag / creditBudget / rateLimit / sanitiser   ← downstream modules
  ↓
7. Route handlers
```

Route-level guards are inherited from Module 1:

| Guard | Used on |
|---|---|
| `requireAuth` (implicit on `/api/v1/*` non-public) | All user `/subscription/*` endpoints |
| `requireAdmin` | All `/admin/plans/*` and `GET /admin/subscriptions` |
| `requireSuperadmin` | `PATCH /admin/subscriptions/:id` only — bypasses billing, must be tightly scoped |

## `planMiddleware` Behaviour

```ts
export const planMiddleware: RequestHandler = async (req, res, next) => {
  // 1. Skip if no authenticated user (public route, or pre-auth route)
  if (!req.user) return next();

  // 2. Skip explicit allowlist (these never need a plan)
  if (PLAN_ALLOWLIST.has(req.path)) return next();
  // PLAN_ALLOWLIST = { '/health', '/plans', + '/auth/*' (handled by req.user being absent) }

  // 3. Hot-path memo
  const memo = perRequestSubMemo.get(req);
  if (memo) {
    req.subscription = memo;
    req.plan = memo.planSnapshot;
    return next();
  }

  // 4. Load active sub; auto-assign FREE if missing (idempotent)
  let sub = await subscriptionService.getActiveSubscriptionForUser(req.user.id);
  if (!sub) sub = await subscriptionService.assignFreePlan(req.user.id);

  perRequestSubMemo.set(req, sub);
  req.subscription = sub;
  req.plan = sub.planSnapshot;
  return next();
};
```

Failures here propagate to `errorHandler` and become standard envelope `500 INTERNAL_ERROR`. Module 2 never returns its own `401` — auth has already passed.

## Route-Level RBAC

A "✓" means the role can perform the action; "—" means denied (`403`).

| Action | user | admin | superadmin |
|---|---|---|---|
| `GET /plans` (public catalog) | public | public | public |
| `GET /subscription` (own) | ✓ | ✓ | ✓ |
| `POST /subscription/upgrade` (own) | ✓ | ✓ | ✓ |
| `POST /subscription/cancel` (own) | ✓ | ✓ | ✓ |
| `GET /admin/plans` | — | ✓ | ✓ |
| `POST /admin/plans` | — | ✓ | ✓ |
| `PATCH /admin/plans/:id` | — | ✓ | ✓ |
| `POST /admin/plans/:id/archive` | — | ✓ | ✓ |
| `POST /admin/plans/:id/publish` | — | ✓ | ✓ |
| `GET /admin/plans/:id/subscribers` | — | ✓ | ✓ |
| `GET /admin/subscriptions` | — | ✓ | ✓ |
| `PATCH /admin/subscriptions/:id` | — | — | ✓ |

## Platform Header

Inherited unchanged from Module 1:

| Route group | Allowed `x-platform` |
|---|---|
| `/api/v1/{subscription,plans}/*` | `web`, `mobile-ios`, `mobile-android` |
| `/api/v1/admin/{plans,subscriptions}/*` | `admin` only |

Mismatch returns `400 PLATFORM_MISMATCH` from Module 1's middleware before Module 2 sees the request.

## Error Code Reference (plan-related)

| Code | HTTP | Meaning |
|---|---|---|
| `PLAN_NOT_FOUND` | 404 | `plans.id` lookup miss |
| `PLAN_ARCHIVED` | 410 | `plans.status='archived'` — cannot subscribe |
| `PLAN_NOT_PUBLIC` | 403 | User route trying to subscribe to a non-public plan |
| `PLAN_FIELD_IMMUTABLE` | 400 | PATCH attempted to modify `slug`, `name`, `id`, or another structural field |
| `INVALID_BILLING_CYCLE` | 400 | Body had a `billingCycle` other than `monthly` / `annual` |
| `INVALID_UPGRADE_TARGET` | 400 | User passed FREE plan id to `/subscription/upgrade` (use `/subscription/cancel` instead) |
| `ALREADY_ON_PLAN` | 409 | Upgrade target equals current plan + cycle |
| `SUBSCRIPTION_NOT_FOUND` | 404 | No active sub for user, or admin lookup miss |
| `CANNOT_CANCEL_FREE_PLAN` | 400 | Cancel called against a FREE subscription |
| `SUBSCRIPTION_CONFLICT` | 409 | Partial-unique-index violation on concurrent upgrade |

All other errors (auth, role, validation, 500s) come from shared middleware/helpers — see `src/utils/errors.ts` and Module 1 §04.
