# Module 4 — Credit Wallet

> Per-user credit balance, deduction formula, and pre-flight budget gate.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §6](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, types (`Wallet`, `WalletTransaction`), file structure, plan-shape extension, dependencies |
| 2 | [02_CREDIT_FORMULA_AND_WALLET.md](02_CREDIT_FORMULA_AND_WALLET.md) | Cost formula, model rates, agent multipliers, plan discounts, pending holds, `creditBudgetMiddleware`, route contracts (user + admin), error envelopes |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, migrations, tests, verification |

## Status

- **Stage:** Implemented (schema + services + middleware + routes + tests)
- **Owner:** Backend
- **Last updated:** 2026-05-05

## Key Decisions

- **Currency-of-account:** internal credits, integer. INR pricing for top-ups (paise) is owned by Module 2.
- **Two tables only:** `wallets` (one row per user, balance + pending) and `wallet_transactions` (immutable ledger).
- **Pending holds prevent overdraft.** `creditBudgetMiddleware` increments `wallets.pending` before LLM call; the worker confirms (deduct + clear hold) on success or releases on failure.
- **Cost formula is a pure function** of `inputTokens + outputTokens`, model rate, agent multiplier, plan discount. Defined once in `creditCalculator.service.ts` and reused by Module 7's worker.
- **Atomic writes via SELECT … FOR UPDATE** inside a single transaction; never two SQL round-trips for balance changes.
- **No PG live yet.** PhonePe top-up is owned by Module 2's payment adapter; Module 4 only credits the wallet on a `subscription.events.topup_succeeded` event.
- **Insufficient credits = hard 402 before LLM.** No "soft pass" path.

## Surface

- **4 user routes** under `/api/v1/wallet/*`
- **2 admin routes** under `/api/v1/admin/wallets/*`
- **1 middleware:** `creditBudgetMiddleware` (pipeline slot #11, after rate-limit slot #10 per `LLM_NEW_MODULE_PROMPT.md`)
- **2 services:** `wallet.service.ts`, `creditCalculator.service.ts`
- **2 tables:** `wallets`, `wallet_transactions`
- **Postman groups:** `Module 4 - User Wallet Contracts`, `Module 4 - Admin Wallet Contracts`

## Dependencies

- Module 1 — `req.user.id`
- Module 2 — `req.plan.creditDiscount` (numeric, e.g. 0.85), `req.plan.creditsIncluded` (granted at subscription start)
- Module 5 — runs *after* rate limit so over-quota users don't burn pending holds
- Module 6 — Module 4 emits the post-call deduction; Module 6 mirrors it in `usage_records`
- Module 7 — chat worker calls `wallet.confirmDeduction()` / `wallet.releaseHold()` after each LLM call
