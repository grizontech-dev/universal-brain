# 02 — Credit Formula, Wallet Operations, Routes

The single source of truth for the cost formula, the wallet's atomic operations, the gating middleware, and every HTTP contract Module 4 exposes.

---

## A. Credit Cost Formula

Pure function. No DB, no Redis, no clock. Same inputs → same output forever.

```
cost = ceil(
  (inputTokens + outputTokens) / 1000
  × modelCreditRate(modelId)
  × agentMultiplier(agentSlug)
  × planDiscount
)
```

Implementation: `src/services/creditCalculator.service.ts → calculateCost(args): number`

### Model rates (per 1K tokens)

Lives on the `ai_models` row, hot-cached in Redis (`ai_models:rates`). Defaults:

| Tier | Examples | Rate |
|---|---|---|
| Nano | Haiku 4.5, GPT-4o-mini, Gemini Flash Lite | 0.5× |
| Standard | Gemini Flash, Sonnet 4.6 | 1.0× |
| Premium | GPT-4o, Gemini Pro | 2.0× |
| Frontier | Opus 4.7, GPT-4, Gemini Ultra | 5.0× |
| Reasoning | o1, Gemini 2.5 Pro thinking | 8.0× |

Admin can edit any rate via Module 12's `PATCH /admin/models/:id` (out of scope here). Edits invalidate the Redis cache key.

### Agent multipliers

Lives on the `agents` row. Defaults:

| Agent | Multiplier |
|---|---|
| chat / writer | 1.0× |
| codeAssistant | 1.2× |
| documentAgent | 1.2× |
| dataAnalyst | 1.3× |
| uiGenerator | 1.3× |
| researchAgent / architect | 1.5× |
| deepResearch | 2.0× |

### Plan discount

From `req.plan.creditDiscount`. Examples: `1.0` (FREE), `0.95` (Starter), `0.85` (Pro), `0.70` (Enterprise).

### Estimating cost up-front

For the pre-flight check, the worker doesn't know `outputTokens` yet. The middleware uses `estimatedTokens` supplied by the route handler (Module 7 sets `estimatedTokens = inputTokens × 3` as the default ratio for chat). If actual exceeds estimate by > 25%, the worker emits a `wallet.over_estimate` log line — non-blocking.

---

## B. Atomic Wallet Operations

Every balance change is a **single DB transaction** with `SELECT … FOR UPDATE` on the wallet row. No two-step "read then write" — that's a race vector.

### `holdPending(userId, amount, ctx) → holdId`

```sql
BEGIN;
SELECT balance, pending FROM wallets WHERE user_id = $1 FOR UPDATE;
-- If balance - pending < amount → throw INSUFFICIENT_CREDITS (no row written)
UPDATE wallets SET pending = pending + $amount, updated_at = now() WHERE user_id = $1;
INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, job_id, ...)
  VALUES (..., 'hold', -$amount, balance, $jobId, ...);   -- type 'hold' is internal-only; not exposed in API
COMMIT;
RETURN tx.id;   -- this is holdId
```

### `confirmDeduction(holdId, actualCost) → void`

The worker calls this after the LLM responds. Cost is recomputed with `actualTokens`.

```sql
BEGIN;
SELECT * FROM wallets WHERE id = (SELECT wallet_id FROM wallet_transactions WHERE id = $holdId) FOR UPDATE;
UPDATE wallets
  SET pending = pending - $heldAmount,                    -- release the hold
      balance = balance - $actualCost,                    -- charge actual
      lifetime_spent = lifetime_spent + $actualCost,
      updated_at = now()
WHERE id = $walletId;
INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, job_id, message_id, agent_slug, model_id, input_tokens, output_tokens, credit_rate, agent_multiplier, plan_discount, ...)
  VALUES (..., 'deduct', -$actualCost, balance, ...);
COMMIT;
```

If `actualCost < heldAmount`, the difference simply stays in `balance` — no refund row needed.
If `actualCost > heldAmount` and `balance < actualCost - heldAmount`, the call **still succeeds** (the LLM has already run). The user goes negative; admin tooling (`/admin/users/:id/wallet`) can correct. Logged as `wallet_balance_negative`.

### `releaseHold(holdId, reason) → void`

Worker on failure / cancel:

```sql
BEGIN;
UPDATE wallets SET pending = pending - $heldAmount, updated_at = now() WHERE id = $walletId;
INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, job_id, description, ...)
  VALUES (..., 'refund', +$heldAmount, balance, ..., $reason);
COMMIT;
```

### `grant(userId, amount, source, ctx)`

```sql
BEGIN;
-- If ctx.idempotencyKey is set, exit early with the existing transaction
-- (and its wallet snapshot) when wallet_transactions.idempotency_key already
-- has a row. This makes subscription lifecycle grants safe to retry.
SELECT * FROM wallet_transactions WHERE idempotency_key = $key LIMIT 1;
UPDATE wallets SET balance = balance + $amount, lifetime_earned = lifetime_earned + $amount, updated_at = now() WHERE user_id = $1;
INSERT INTO wallet_transactions (..., type='grant' | 'topup' | 'rollover', idempotency_key=$key, ...);
COMMIT;
```

The optional `ctx.idempotencyKey` is the canonical mechanism for at-most-once
wallet grants. Subscription lifecycle events use deterministic keys of the
form `subscription_grant:<subscriptionId>:<event>:<granted|rollover>` (see
[Module 2 → Subscription/Wallet Synchronization](../Module%202%20-%20Plan%20and%20Subscription/07_FLOWS.md#g-subscriptionwallet-synchronization-contract)),
so re-running `subscriptionService.assignFreePlan`, `upgradeSubscription`,
`cancelSubscription` (immediate), or `renewDueSubscriptions` cannot
double-credit a user. Top-ups continue to use the existing `UNIQUE (job_id)
WHERE type='topup'` partial index *and* an idempotency key of
`topup:<orderId>` for defense in depth. The return value now includes
`alreadyApplied: boolean` so callers can branch on whether a grant was a
no-op.

### `adjust(userId, delta, reason, actorId)` — admin only

Same as `grant` but `type='adjustment'`, `actor_id` set, and `delta` may be negative. Refuses to push balance below `0` unless `force: true` (logged + audited).

---

## C. `creditBudgetMiddleware`

**File:** `src/gateway/creditBudget.middleware.ts` · Pipeline slot **11** — runs after `rateLimitMiddleware` (slot 10) so a denied request never opens a pending wallet hold. See [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md) for the canonical, locked order.

### Behaviour

```
1. If req.method === 'GET' or route is exempt → next()
2. Estimate cost: route's controller passes `req.creditEstimate = { tokens, modelId, agentSlug }`
   (Set by Module 7's enqueue handler, BEFORE the worker runs.)
   If req.creditEstimate is missing → next() (route is not chargeable)
3. wallet = await walletService.getBalance(req.user.id)
4. cost = creditCalculator.calculateCost({ ...req.creditEstimate, planDiscount: req.plan.creditDiscount })
5. spendable = wallet.balance - wallet.pending
6. If spendable < cost → throw Errors.insufficientCredits({ creditsNeeded: cost, creditsAvailable: spendable, topupUrl: '/wallet/topup' })
7. holdId = await walletService.holdPending(req.user.id, cost, ctx)
8. req.wallet = { holdId, heldAmount: cost }
9. next()
```

### Error envelope (402)

```json
{
  "success": false,
  "message": "You don't have enough credits for this request.",
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "details": {
      "creditsNeeded": 320,
      "creditsAvailable": 145,
      "topupUrl": "/wallet/topup"
    }
  },
  "meta": { "request_id": "req_..." }
}
```

### Worker post-processing

After the LLM returns, the chat worker (Module 7) does **exactly one of**:

```ts
await walletService.confirmDeduction(req.wallet.holdId, { actualTokens, modelId, agentSlug });
// OR
await walletService.releaseHold(req.wallet.holdId, 'llm_call_failed');
```

If the worker crashes mid-flight without doing either, a janitor job (`wallet.janitor.worker.ts`, runs every 10 min) finds holds older than 30 min and `releaseHold(reason='janitor_timeout')`. Documented in [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md).

---

## D. User API Routes

Base: `/api/v1/wallet`. All require Bearer JWT (default user-protected per `LLM_NEW_MODULE_PROMPT.md`). Postman group: **Module 4 - User Wallet Contracts**.

### `GET /wallet`

Current snapshot.

**200 OK**
```json
{
  "success": true,
  "message": "Wallet loaded.",
  "data": {
    "balance":       1450,
    "pending":       40,
    "spendable":     1410,
    "lifetimeEarned": 5000,
    "lifetimeSpent":  3550,
    "currency":      "credits",
    "updatedAt":     "2026-05-04T07:14:22Z"
  }
}
```

### `GET /wallet/transactions?page=&page_size=&type=&from=&to=`

Paginated ledger.

```
type?: grant | deduct | topup | rollover | refund | adjustment
from?: ISO8601 (default: 30 days ago)
to?:   ISO8601 (default: now)
page=1, page_size=25 (max 100)
```

**200 OK** → list of `WalletTransaction` (without `actor_id` for non-admin).

### `GET /wallet/transactions/:id`

Single transaction. `404 NOT_FOUND` if not owned by caller.

### `POST /wallet/topup`

Initiates a top-up purchase. **Module 4 does not call any payment gateway** — it forwards to Module 2's payment adapter (PhonePe stub) and returns the gateway redirect URL. Wallet is credited only when Module 2 emits `subscription.events.topup_succeeded` with the user id and credit amount.

**Body**
```ts
{
  packageId: string   // references plans.creditTopupPackages[*].id
}
```

**200 OK**
```json
{
  "success": true,
  "message": "Top-up initiated.",
  "data": {
    "orderId":      "ord_...",
    "creditsToAdd": 1000,
    "amount":       49900,        // paise (INR)
    "redirectUrl":  "https://pay.phonepe.com/..."
  }
}
```

**Errors:** `400 INVALID_PACKAGE`, `403 TOPUPS_DISABLED_ON_PLAN`, `502 UPSTREAM_UNAVAILABLE` (PG down).

---

## E. Admin API Routes

Base: `/api/v1/admin/wallets`. Requires `x-platform: admin` and admin role per pipeline. Postman group: **Module 4 - Admin Wallet Contracts**.

### `POST /admin/users/:id/wallet`

Manual adjustment. Admin-only; some scenarios (negative balance) require superadmin.

**Body**
```ts
{
  delta:  number,    // signed; -500 deducts, +1000 grants
  reason: string,    // min 10 chars; goes to wallet_transactions.description
  force?: boolean    // if true, may push balance < 0; superadmin only
}
```

**200 OK** → updated `Wallet` + the new `WalletTransaction`.

**Errors:** `400 ZERO_DELTA`, `400 REASON_REQUIRED`, `400 NEGATIVE_BALANCE_REQUIRES_FORCE`, `403 SUPERADMIN_REQUIRED`, `404 USER_NOT_FOUND`.

Emits `wallet.adjusted` event; written to both `wallet_transactions` (with `actor_id`) and Module 1's `auth_audit` (`event_type='admin_wallet_adjusted'`).

### `GET /admin/wallets`

System-wide balance snapshot for support / finance.

```
q?:               string            // user email or id substring
balance_below?:   number            // filter: balance < N
balance_above?:   number
pending_above?:   number
sort?:            balance | -balance | lifetime_spent | -lifetime_spent | updated_at | -updated_at
page?, page_size?
```

**200 OK** — array of `{ user: { id, email, name }, wallet: Wallet, plan: { id, slug } }`.

---

## F. Subscription Event Handlers

Module 4 subscribes to four events emitted by Module 2:

| Event | Action |
|---|---|
| `subscription.events.granted` | First-time grant on signup or upgrade. `walletService.grant(userId, plan.creditsIncluded, source='subscription')` |
| `subscription.events.renewed` | Period renewal. Compute rollover per plan flag, then `grant`. Two transactions: one `rollover`, one `grant`. |
| `subscription.events.topup_succeeded` | PhonePe webhook confirmed payment via Module 2. `walletService.grant(userId, package.credits, source='topup', orderId)` |
| `subscription.events.refunded` | Full refund of a top-up. `walletService.adjust(userId, delta=-package.credits, reason='topup_refunded', actorId='system')` |

If a user's balance goes negative due to refund (already spent), the row stays negative; admin reviews via the `wallets/admin` endpoint. No automatic clawback.

---

## G. Error Code Reference

| Code | HTTP | Source |
|---|---|---|
| `INSUFFICIENT_CREDITS` | 402 | `creditBudgetMiddleware` |
| `INVALID_PACKAGE` | 400 | `POST /wallet/topup` |
| `TOPUPS_DISABLED_ON_PLAN` | 403 | `POST /wallet/topup` |
| `ZERO_DELTA` | 400 | `POST /admin/users/:id/wallet` |
| `REASON_REQUIRED` | 400 | admin adjust |
| `NEGATIVE_BALANCE_REQUIRES_FORCE` | 400 | admin adjust |
| `WALLET_NOT_FOUND` | 404 | rare race; treated as bug |
| `UPSTREAM_UNAVAILABLE` | 502 | top-up redirect when Module 2's PG adapter is down |

All registered in `src/utils/errors.ts` as `Errors.*` factories per [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

---

## H. Response Headers (set on every authed request)

```
X-Wallet-Balance:     1450
X-Wallet-Pending:     40
X-Wallet-Spendable:   1410
```

Set by a tiny tail middleware after `creditBudgetMiddleware` so the frontend can update the balance pill without re-fetching `/wallet`. Updated again by the worker via SSE event `wallet_update` after deduction.

---

## I. Security Notes

| Concern | Mitigation |
|---|---|
| Race-on-balance | Single DB tx + `SELECT … FOR UPDATE`. No Redis cache writes touch balance. |
| Replay of top-up event | `wallet_transactions.job_id` (= PhonePe order id) is `UNIQUE` on `type='topup'`. Duplicate event = no-op. |
| Negative-balance abuse | Pre-check in `holdPending`. Worker confirmation may slip past it for over-estimates; bounded by `actualTokens / estimatedTokens` ratio. |
| Self-grant via crafted body | Adjust route is admin-only, both at route mount (`requireAdmin`) and at service layer (`walletService.adjust` requires `actorId !== userId` for non-superadmin). |
| Janitor double-release | `releaseHold` is idempotent; second call sees no `pending` row and exits clean. |
| Cost-formula tampering | Pure function, no params from request body. Estimate from request is bounded by `req.plan.maxContextMessages × maxTokensPerMessage`. |
