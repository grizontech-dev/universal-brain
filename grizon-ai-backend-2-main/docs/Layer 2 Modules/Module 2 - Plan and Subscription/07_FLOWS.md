# 07 — Flows

End-to-end narratives for the four state-changing flows Module 2 owns. ASCII diagrams show the order of operations and which component is responsible for each step.

---

## A. Registration → FREE Plan Auto-Assignment

Triggered by Module 1's `auth.service.register()`. Module 2 hooks in via a single call (no listener — direct call to keep the user's first request fast and predictable).

```
┌──────────┐       ┌────────────────────┐       ┌──────────────────────┐
│ Client   │──POST▶│ /auth/register     │──────▶│ auth.service         │
└──────────┘       │ (Module 1)         │       │ .register()          │
                   └────────────────────┘       └──────────┬───────────┘
                                                           │
                                            (in same DB tx)│
                                                           ▼
                                          ┌────────────────────────────────┐
                                          │ subscription.service           │
                                          │ .assignFreePlan(userId)        │
                                          │                                │
                                          │  1. SELECT FROM subscriptions  │
                                          │     WHERE user_id=? AND        │
                                          │     status='active' (idempot.) │
                                          │  2. If none, INSERT new row:   │
                                          │     plan_id='plan_free_v1'     │
                                          │     plan_snapshot=<frozen>     │
                                          │     billing_cycle='monthly'    │
                                          │     period: now → now+1mo      │
                                          │     credits_granted=1000       │
                                          │  3. INSERT subscription_history│
                                          │     event='created'            │
                                          │  4. Emit subscription.created  │
                                          └────────────────────────────────┘
                                                           │
                                                           ▼
                                          200 OK { user, tokens } back to client
                                          (subscription is invisible at this point;
                                           client sees it on first GET /subscription)
```

**Idempotency contract:** if `assignFreePlan` is called for a user who already has an active sub, it's a no-op. This makes it safe to call from `planMiddleware` as a recovery path too.

---

## B. Authenticated Request → `req.plan` Injection

Every authenticated request goes through this. The hot path must stay fast (single indexed query, per-request memo).

```
Request with Bearer JWT
   │
   ▼
┌─────────────────────┐
│ authMiddleware      │ ← Module 1: sets req.user
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ adminMiddleware     │ ← Module 1: gates /admin/* by role + platform
└──────────┬──────────┘
           ▼
┌─────────────────────────────────────────────┐
│ planMiddleware (THIS MODULE)                │
│                                             │
│  if !req.user            → next()           │
│  if path in allowlist    → next()           │
│  if memo[req] hit        → next() with memo │
│                                             │
│  sub = getActiveSubscriptionForUser(uid)    │
│  if !sub:                                   │
│     sub = assignFreePlan(uid)  // recovery  │
│                                             │
│  memo[req] = sub                            │
│  req.subscription = sub                     │
│  req.plan = sub.planSnapshot                │
│  next()                                     │
└──────────┬──────────────────────────────────┘
           ▼
   downstream modules read req.plan
   (featureFlag, creditBudget, rateLimit, sanitiser)
           │
           ▼
   route handler
```

**Failure mode:** if `getActiveSubscriptionForUser` throws (DB error), the request short-circuits to `errorHandler` → `500 INTERNAL_ERROR`. We never let a request through with no `req.plan` — downstream modules trust it exists.

---

## C. Upgrade

User chooses a paid plan. Period starts at `now()`; no proration. Old sub is closed in the same transaction.

```
Client ──POST /subscription/upgrade {planId, billingCycle}──▶ user/plan.routes
                                                                   │
                                                                   ▼
                                                  subscription.service.upgradeSubscription()
                                                                   │
                                                                   ▼ (single DB tx)
   ┌────────────────────────────────────────────────────────────────────────────┐
   │ 1. plan = plans WHERE id=:planId                                          │
   │    if !plan                  → 404 PLAN_NOT_FOUND                          │
   │    if plan.status='archived' → 410 PLAN_ARCHIVED                           │
   │    if !plan.is_public        → 403 PLAN_NOT_PUBLIC                         │
   │    if plan.id = freePlanId   → 400 INVALID_UPGRADE_TARGET                  │
   │                                                                            │
   │ 2. current = subscriptions WHERE user_id=? AND status='active' FOR UPDATE  │
   │    if current.plan_id=:planId AND current.billing_cycle=:cycle             │
   │                              → 409 ALREADY_ON_PLAN                         │
   │                                                                            │
   │ 3. unused = (computed at point of read; once Module 4 ships, query wallet) │
   │    rollover = plan.credits.rollover                                        │
   │      ? min(unused, plan.credits.maxRollover ?? Infinity)                   │
   │      : 0                                                                   │
   │                                                                            │
   │ 4. UPDATE current SET status='cancelled' (period_end stays as audit)       │
   │    INSERT subscription_history (current.id, 'cancelled', ..., reason='upgraded')│
   │                                                                            │
   │ 5. INSERT new subscription:                                                │
   │    plan_snapshot = <frozen plan>                                           │
   │    period: now → now + (cycle==='annual' ? 1y : 1mo)                       │
   │    credits_granted = plan.credits.included                                 │
   │    credits_rolled_over = rollover                                          │
   │    pg_provider/etc = NULL  (no charge today)                               │
   │                                                                            │
   │ 6. INSERT subscription_history (new.id, 'upgraded',                        │
   │    from_plan_id=current.plan_id, to_plan_id=plan.id,                       │
   │    actor_user_id=req.user.id, payload={cycle, rollover})                   │
   │                                                                            │
   │ 7. emit('subscription.upgraded', {userId, fromPlanId, toPlanId, cycle,     │
   │                                    creditsGranted, creditsRolledOver})     │
   └────────────────────────────────────────────────────────────────────────────┘
                                                                   │
                                                                   ▼
                                                       201 { subscription: <new> }
```

**Concurrent upgrade:** if two upgrade requests race for the same user, the partial unique index makes the second INSERT fail. Service catches the `23505` SQLSTATE and maps it to `409 SUBSCRIPTION_CONFLICT` (client retries).

---

## D. Cancel

Two modes: graceful (default) keeps the user on their plan until period end, then drops to FREE; immediate drops to FREE right now.

### D.1 Graceful

```
Client ──POST /subscription/cancel {}──▶ user/plan.routes
                                              │
                                              ▼
                            subscription.service.cancelSubscription({immediate:false})
                                              │
                                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ active = SELECT WHERE user_id=? AND status='active'             │
   │ if !active                  → 404 SUBSCRIPTION_NOT_FOUND         │
   │ if active.plan_id = freeId  → 400 CANNOT_CANCEL_FREE_PLAN        │
   │                                                                  │
   │ UPDATE active SET cancel_at_period_end=true                      │
   │ INSERT subscription_history (active.id, 'cancel_scheduled',      │
   │   actor_user_id=req.user.id)                                     │
   │ emit('subscription.cancel_scheduled', {userId, effectiveAt})     │
   └──────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                            200 { subscription, effectiveAt: currentPeriodEnd }

   ─── later, at currentPeriodEnd (renewal cron, future Module 4/5 work) ───
   cron picks up rows WHERE cancel_at_period_end=true AND current_period_end <= now()
   → UPDATE status='cancelled'
   → assignFreePlan(userId)
   → emit('subscription.cancelled')
```

### D.2 Immediate

```
Client ──POST /subscription/cancel {immediate:true}──▶ ... cancelSubscription({immediate:true})
                                                              │
                                                              ▼ (single DB tx)
   ┌──────────────────────────────────────────────────────────────────┐
   │ Same precondition checks as D.1                                  │
   │                                                                  │
   │ UPDATE active SET status='cancelled'                             │
   │ INSERT subscription_history (active.id, 'cancelled',             │
   │   actor_user_id=req.user.id, payload={mode:'immediate'})         │
   │                                                                  │
   │ free = INSERT new subscription with plan_id=freePlanId,          │
   │        plan_snapshot=<frozen FREE>, status='active', period: now │
   │ INSERT subscription_history (free.id, 'created',                 │
   │   payload={reason:'immediate_cancel'})                           │
   │                                                                  │
   │ emit('subscription.cancelled', {userId, sourcePlanId})           │
   │ emit('subscription.created',   {userId, planId: freePlanId})     │
   └──────────────────────────────────────────────────────────────────┘
                                                              │
                                                              ▼
                                          200 { subscription:<free>, cancelledSubscriptionId }
```

The partial unique index protects this: between the UPDATE and INSERT, no other process can sneak in another active row.

---

## E. Plan Archive (Admin)

Admin retires a plan. Existing subscribers continue using it (their `plan_snapshot` is independent), but no new signups can pick it.

```
Admin ──POST /admin/plans/:id/archive──▶ admin/plan.routes
                                              │
                                              ▼
                                  plan.service.archivePlan(id)
                                              │
                                              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ UPDATE plans SET status='archived', archived_at=now() WHERE id=? │
   │   if no rows                → 404 PLAN_NOT_FOUND                 │
   │   if already archived       → return current row (idempotent)    │
   │ emit('plan.archived', {planId, actorUserId})                     │
   └──────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                                       200 { plan }

   Effect on existing subscribers: zero. Their subscriptions row is unchanged
   and their planSnapshot still resolves on every authenticated request.
   The next time they hit GET /plans, the archived plan no longer appears.
   If they explicitly try POST /subscription/upgrade {planId: <archived>},
   they get 410 PLAN_ARCHIVED.
```

---

## F. Renewal & Rollover (future — sketch only)

Not implemented in Module 2. Documented here so the contract is locked in for the cron worker to be added with Module 4.

```
Every minute, cron scans:
  SELECT id, user_id, plan_snapshot, billing_cycle, cancel_at_period_end
  FROM subscriptions
  WHERE status='active' AND current_period_end <= now()

For each row:
  if cancel_at_period_end:
     UPDATE status='cancelled'
     assignFreePlan(user_id)
     emit('subscription.cancelled')
     continue

  unused = wallet.getBalance(user_id)            // Module 4
  plan = row.plan_snapshot
  rollover = plan.credits.rollover
    ? min(unused, plan.credits.maxRollover ?? Infinity)
    : 0
  granted = plan.credits.included

  UPDATE subscription SET
    current_period_start = current_period_end,
    current_period_end   = current_period_end + (cycle==='annual' ? 1y : 1mo),
    credits_granted      = granted,
    credits_rolled_over  = rollover

  INSERT subscription_history (id, 'renewed',
    payload={granted, rollover})

  emit('subscription.renewed', {userId, planId, granted, rollover})
  → Module 4 listens, sets wallet balance = granted + rollover
```

When the live PhonePe integration ships, this same loop will additionally call `phonepeAdapter.charge()` before incrementing the period and will move the subscription to `past_due` on charge failure.

---

## Failure & Recovery Notes

| Failure | What happens | Recovery |
|---|---|---|
| DB unavailable during `assignFreePlan` from registration | `auth.service.register` rolls back; user sees 500 | Client retries; on retry, idempotent assign succeeds |
| `planMiddleware` finds no active sub (data corruption) | Auto-`assignFreePlan` recovers; logs a `WARN` | Backfill job (future) sweeps for users with no active sub |
| Concurrent upgrade → unique-index violation | Service catches `23505` → `409 SUBSCRIPTION_CONFLICT` | Client retries once |
| Snapshot drift (live plan edited mid-period) | None — snapshot is frozen, request reads `req.plan` | By design |
| Admin breaks an immutability rule | Service rejects with `400 PLAN_FIELD_IMMUTABLE` | Admin creates new plan version + archives old |
| Wallet grant fails after subscription commit | Subscription row is correct; wallet stays unchanged | `planMiddleware` reconciles via `subscriptionService.ensureGrantsForUser` on the next authenticated request |

---

## G. Subscription/Wallet Synchronization Contract

`subscriptions.credits_granted` / `credits_rolled_over` are **metadata** that
record what the lifecycle event tried to grant. `wallets.balance` /
`wallet_transactions` are the **source of truth** for spendable credits and
the chat credit-budget gate (Module 4). Module 2 is responsible for keeping
the two in sync via a single helper, `applySubscriptionGrants`.

### Lifecycle → grant mapping

| Lifecycle event | Trigger | Subscription row write | Wallet effect |
|---|---|---|---|
| `created` (free) | `assignFreePlan` from registration / Google signup / `planMiddleware` recovery | INSERT subscription with `credits_granted = plan.credits.included` | `walletService.grant` with key `subscription_grant:<sub>:created:granted` |
| `upgraded` | `upgradeSubscription` | INSERT new subscription, cancel old | `walletService.grant` with keys `…:upgraded:rollover` and `…:upgraded:granted` |
| `immediate_cancel` | `cancelSubscription({immediate:true})` | Cancel old, INSERT free sub | `walletService.grant` for the new free sub with key `…:immediate_cancel:granted` |
| `renewed` | `renewDueSubscriptions` cron | UPDATE existing subscription's period + credits | `walletService.grant` with keys `…:renewed:rollover` and `…:renewed:granted` |
| `admin_adjusted` | `PATCH /admin/plans/subscriptions/:id` with `creditsGranted`/`creditsRolledOver` change | UPDATE subscription | `walletService.adjust(delta, force=true)` audited with the patch reason |

Every wallet grant runs **after** the subscription DB transaction commits.
A wallet failure therefore cannot roll back a successful subscription change;
the next call to `ensureGrantsForUser` (run automatically by `planMiddleware`)
re-applies the same grant safely because of the deterministic idempotency
key on `wallet_transactions.idempotency_key`.

### Idempotency keys

```
subscription_grant:<subscriptionId>:<event>:granted
subscription_grant:<subscriptionId>:<event>:rollover
```

Stored in `wallet_transactions.idempotency_key` (migration 022); a unique
partial index makes duplicate grants a no-op (the existing transaction is
returned with `alreadyApplied: true`). Top-ups use `topup:<orderId>` and
remain protected by the existing `UNIQUE (job_id) WHERE type='topup'` index.

### Renewal cron

`subscriptionService.renewDueSubscriptions({ batchSize })` is implemented and
exposed via `src/workers/subscription.renewal.worker.ts → runSubscriptionRenewalOnce`.
Wire it through the standard BullMQ repeatable job mechanism (Module 7) at
the cadence required by the product (the doc default is one minute). For
each due subscription it advances `current_period_*`, refreshes
`credits_granted` / `credits_rolled_over` (computed via
`computeRolloverGrant` against the current wallet balance), writes a
`subscription_history(event='renewed')` row, emits `subscription.renewed`,
and applies the matching wallet grants idempotently.
