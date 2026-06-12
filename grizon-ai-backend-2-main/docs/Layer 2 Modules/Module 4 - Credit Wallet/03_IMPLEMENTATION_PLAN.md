# 03 — Implementation Plan

Concrete, ordered build for Module 4. Assumes Module 2 is at least partially shipped (so `req.plan.creditDiscount` and `req.plan.creditsIncluded` exist on the snapshot), and `subscription.events.*` are emitted on signup/upgrade/renew/refund.

## Files to Create

| Path | Purpose |
|---|---|
| `src/types/wallet.d.ts` | `Wallet`, `WalletTransaction`, `WalletTxType`, `WalletHold` |
| `src/config/credits.ts` | Default `MODEL_CREDIT_RATES`, `AGENT_MULTIPLIERS`, `ESTIMATE_OUTPUT_RATIO` (= 3 for chat) |
| `src/services/creditCalculator.service.ts` | Pure `calculateCost({ inputTokens, outputTokens, modelId, agentSlug, planDiscount }) → number` |
| `src/services/wallet.service.ts` | Atomic `holdPending`, `confirmDeduction`, `releaseHold`, `grant`, `topup`, `adjust`, `getBalance`, `listTransactions` |
| `src/gateway/creditBudget.middleware.ts` | Replaces the existing stub. See Pipeline Order below. |
| `src/events/wallet.events.ts` | Typed emitter: `wallet.deducted`, `wallet.granted`, `wallet.adjusted`, `wallet.released` |
| `src/routes/user/wallet.routes.ts` | `GET /wallet`, `GET /wallet/transactions`, `GET /wallet/transactions/:id`, `POST /wallet/topup` |
| `src/routes/admin/wallets.routes.ts` | `POST /admin/users/:id/wallet`, `GET /admin/wallets` |
| `src/controllers/user/wallet.controller.ts` | Thin handlers per route |
| `src/controllers/admin/wallets.controller.ts` | Thin handlers per route |
| `src/workers/wallet.janitor.worker.ts` | Cron-like (10 min) — `releaseHold` for holds older than 30 min |
| `src/db/migrations/014_wallets.sql` | `wallets` table + `UNIQUE (user_id)` + `created_at default now()` |
| `src/db/migrations/015_wallet_transactions.sql` | Ledger table + indexes; **`UNIQUE (job_id)` partial index where `type = 'topup'`** for replay-safety |
| `src/db/migrations/022_wallet_tx_idempotency_key.sql` | Adds `wallet_transactions.idempotency_key` + unique partial index. Subscription lifecycle grants and top-ups use deterministic keys so retries are no-ops. |
| `test/unit/services/creditCalculator.service.test.ts` | Formula edge cases (zero tokens, all multipliers stack, ceiling rounding) |
| `test/unit/services/wallet.service.test.ts` | Concurrency (two holds racing), confirm/release idempotency, negative-balance refusal |
| `test/integration/middleware/creditBudget.middleware.test.ts` | 402 below balance, allow above, hold persisted, header set |
| `test/integration/routes/wallet.user.routes.test.ts` | All four user routes against a seeded user + plan |
| `test/integration/routes/wallet.admin.routes.test.ts` | Adjust + list + RBAC + audit-row written |

## Files to Modify

| Path | Change |
|---|---|
| `src/app.ts` | The pipeline already places `rateLimitMiddleware` at slot 10 and `creditBudgetMiddleware` at slot 11 (rate-limit before credit budget — see [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md)). Module 4 only **replaces the credit-budget stub** at slot 11 with the real implementation. No reorder needed. |
| `src/routes/user/index.ts` | `userRoutes.use('/wallet', walletRoutes)` |
| `src/routes/admin/index.ts` | `adminRoutes.use('/wallets', adminWalletsRoutes)` |
| `src/utils/errors.ts` | Add `Errors.insufficientCredits(details)`, `Errors.invalidPackage()`, `Errors.topupsDisabledOnPlan()`, `Errors.zeroDelta()`, `Errors.reasonRequired()`, `Errors.negativeBalanceRequiresForce()` |
| `src/services/subscription.service.ts` (Module 2) | Wire `subscription.events.granted/renewed/refunded` to call `walletService.grant/adjust`. Top-up handler reads `pg_order_id → walletService.grant` and ensures idempotency via the `UNIQUE` index on `wallet_transactions.job_id` for `type='topup'`. |
| `src/services/auth.service.ts` (Module 1) | On `register`, after the user row commits, call `walletService.createForUser(userId)` followed by `subscriptionService.ensureGrantsForUser(userId)` (which is idempotent). On `register_google`, the work is owned by `subscriptionService.assignFreePlan(userId)` — do NOT also call `walletService.grant` from auth.service to avoid double-crediting. |
| `src/services/subscription.service.ts` (Module 2) | All wallet grants tied to subscription lifecycle (`assignFreePlan`, `upgradeSubscription`, immediate `cancelSubscription`, `adminAdjustSubscription`, `renewDueSubscriptions`) flow through the in-service helper `applySubscriptionGrants`. The helper writes through `walletService.grant` with deterministic idempotency keys (`subscription_grant:<sub>:<event>:<granted|rollover>`). `planMiddleware` calls `subscriptionService.ensureGrantsForUser(userId)` on every authenticated request as a self-healing reconciler. |
| `docs/LLM_NEW_MODULE_PROMPT.md` | Update **Middleware Stack and How to Use It** section to reflect the swap, and add Module 4 Postman groups under "Postman groups currently include". |
| `grizon-ai-backend-2.postman_collection.json` | Add groups `Module 4 - User Wallet Contracts` (4 reqs) and `Module 4 - Admin Wallet Contracts` (2 reqs). |

## Reused Utilities (do not re-implement)

- `src/infra/postgres.ts` → `withTransaction(fn)` wrapper (uses `BEGIN`/`COMMIT`/`ROLLBACK`)
- `src/infra/redis.ts` → only used to invalidate `ai_models:rates` cache key on rate edits; balance never touches Redis
- `src/utils/response.ts` → `ok()`, `created()`, `fail()`
- `src/utils/errors.ts` → `AppError` + new `Errors.*` factories
- `src/utils/logger.ts` → structured logs (`wallet_balance_negative`, `wallet_over_estimate`, `wallet_janitor_released`)
- Module 2's frozen-snapshot pattern — reuse for `req.plan.creditDiscount`

## Implementation Order

1. **Migrations 014 + 015** — apply, verify with `psql \\d wallets` and `\\d wallet_transactions`.
2. **Types** (`src/types/wallet.d.ts`) — contract every other file imports.
3. **`config/credits.ts`** — pure data + helpers.
4. **`creditCalculator.service.ts`** — pure function; ships with unit test first.
5. **`wallet.service.ts`** — atomic ops via `withTransaction`. Test concurrency by spawning two parallel `holdPending` calls in the unit test.
6. **`creditBudget.middleware.ts`** — replaces the slot-11 stub. Reads `req.creditEstimate` (set by the chat enqueue handler — Module 7 dependency stub for now: skip middleware if missing).
7. **Error helpers** — six new `Errors.*` factories.
8. **User routes** — one route file, one controller, four endpoints.
9. **Admin routes** — `requireAdmin` (or `requireSuperadmin` for `force=true`).
10. **Wallet janitor worker** — runs every 10 min via existing `bullmq` repeatable jobs (Module 7 owns the queue layer; Module 4 just registers a job processor).
11. **Subscription event listeners** — Module 2 services emit, Module 4 listens.
12. **Auth bootstrap** — `walletService.createForUser` on `register` / `register_google`.
13. **Tests** — see file table above.
14. **Postman + status report** — last step before opening PR.

## Pipeline Order (locked)

The middleware pipeline is canonical and locked in [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md):

```
... 9. featureFlagMiddleware → 10. rateLimitMiddleware → 11. creditBudgetMiddleware → 12. sanitiserMiddleware ...
```

`creditBudgetMiddleware` runs **after** `rateLimitMiddleware`, so a denied request never opens a pending wallet hold. Module 4 only replaces the existing slot-11 stub — no reorder.

## Verification

```bash
npm run migrate                                    # apply 014, 015
npm run build                                      # TypeScript compile must pass
npm test -- test/unit/services/creditCalculator.service.test.ts
npm test -- test/unit/services/wallet.service.test.ts
npm test -- test/integration/middleware/creditBudget.middleware.test.ts
npm test -- test/integration/routes/wallet.user.routes.test.ts
npm test -- test/integration/routes/wallet.admin.routes.test.ts
```

Manual smoke (FREE user with `creditsIncluded: 100`):

1. `GET /api/v1/wallet` → balance 100, pending 0, spendable 100.
2. Send a chat message that estimates 80 credits → `creditBudgetMiddleware` opens hold; `pending=80`. Response headers show `X-Wallet-Spendable: 20`.
3. Worker confirms with `actualCost=72` → balance 28, pending 0. SSE `wallet_update`.
4. Send another costing 50 → `402 INSUFFICIENT_CREDITS` envelope with `creditsNeeded:50, creditsAvailable:28, topupUrl:'/wallet/topup'`.
5. Admin grants 200 via `POST /admin/users/:id/wallet { delta: 200, reason: 'support credit' }` → balance 228. Audit row written in `auth_audit('admin_wallet_adjusted')`.
6. Force-stop the worker mid-call so a hold is orphaned. After 30 min, janitor releases it. Verify `wallet_transactions` shows a `refund` row with `description='janitor_timeout'`.
7. Stop Postgres. Hit any chargeable endpoint → universal-envelope 500 with `code: 'INTERNAL_ERROR'`. No silent allows.

## Risks / Notes

- **Negative balance possible** when actual exceeds estimate AND new charges arrive before the user notices. Mitigation: estimate ratio (3×) is conservative for chat; monitor `wallet_balance_negative` log line. Hard correction is admin-side only.
- **Janitor TTL** of 30 min is generous; long-running deep-research jobs may run that long. If product later wants 10-min jobs, raise the TTL to 60. Document the change in this file.
- **Top-up idempotency** depends on the PhonePe webhook delivering the same `order_id` for retries. Confirm with Module 2's adapter contract before shipping.
- **Estimate misuse:** any caller can set `req.creditEstimate`, but only the chat enqueue handler does today. Add a typed wrapper `setCreditEstimate(req, args)` that asserts `args.tokens <= plan.maxContextMessages × maxTokensPerMessage` to prevent crafted bodies forcing massive holds.
- **Plan downgrade between hold and confirm:** if the user is moved to a cheaper plan during a hold, `confirmDeduction` recomputes cost with the **frozen plan from the hold's snapshot** (stored in `wallet_transactions.plan_discount`). User benefits from the lower price they had at request time.
