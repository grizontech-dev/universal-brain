# 01 — Overview

## Mission

Module 4 is the **money layer**. It tracks how many credits each user has, gates expensive endpoints on remaining balance, deducts credits atomically after each LLM call, and exposes user + admin views of the ledger.

It owns no LLM logic, no plan logic, no pricing logic for top-ups. Its single product responsibility is: **at any moment, the wallet's balance must be the single accurate truth of what a user can spend.**

## Scope

### In scope

- `wallets` and `wallet_transactions` tables (full lifecycle + indexes)
- `creditBudgetMiddleware` — pre-flight check on `req.plan.creditsCost(estimate)` vs `wallet.balance - wallet.pending`
- `wallet.service.ts` — `createForUser`, `getBalance`, `holdPending`, `confirmDeduction`, `releaseHold`, `grant`, `topup`, `adjust`, `listTransactions`
- `creditCalculator.service.ts` — pure cost formula (deterministic, side-effect-free)
- 4 user routes (`GET /wallet`, `GET /wallet/transactions`, `GET /wallet/transactions/:id`, `POST /wallet/topup`)
- 2 admin routes (`POST /admin/users/:id/wallet`, `GET /admin/wallets`)
- Subscription event handlers: `subscription.events.granted`, `subscription.events.renewed`, `subscription.events.topup_succeeded`, `subscription.events.refunded`
- Postman groups added per [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md)

### Out of scope

- Live payment processing (Module 2 + PhonePe adapter)
- Token counting (each provider SDK reports it; Module 7 reads + passes to Module 4)
- Rate limiting (Module 5)
- Usage analytics / aggregation (Module 6 reads from this module's events)
- Per-feature usage caps (Module 3)

## Inputs

| Source | What it carries |
|---|---|
| `req.user.id` (Module 1) | Wallet owner |
| `req.plan.creditDiscount` (Module 2) | Plan multiplier (e.g. `0.85` for Pro) |
| `req.plan.featureFlags.codeExecution`, etc. (Module 3) | Pre-checked upstream — Module 4 trusts those gates |
| `req.body.estimatedTokens` or downstream `actualTokens` | Drives the cost formula |
| Subscription events | Periodic grants, top-up confirmations, refunds |

## Outputs

- **Allow** → `next()` with `req.wallet.holdId` set so the worker can confirm/release
- **Deny** → `402 INSUFFICIENT_CREDITS` envelope with `{ creditsNeeded, creditsAvailable, topupUrl }`
- **Internal events emitted:**
  - `wallet.deducted` `{ userId, walletId, amount, txId, jobId, modelId, agentSlug }`
  - `wallet.granted`  `{ userId, walletId, amount, source: 'subscription' | 'topup' | 'adjustment', txId }`
  - `wallet.adjusted` `{ userId, walletId, delta, reason, actorId, txId }`

All HTTP responses use the universal envelope from [`Project Foundation/03_REQUEST_RESPONSE.md`](../../Project%20Foundation/03_REQUEST_RESPONSE.md). Errors use `Errors.*` from [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

## Type Contracts

```ts
// src/types/wallet.d.ts
export interface Wallet {
  id: string;
  userId: string;
  balance: number;            // current credits available
  pending: number;            // held for in-flight jobs (NOT spendable)
  lifetimeEarned: number;
  lifetimeSpent: number;
  updatedAt: string;
}

export type WalletTxType =
  | 'grant'      // subscription period start / introductory bonus
  | 'deduct'    // post-LLM-call confirmation
  | 'topup'      // user-initiated paid credit purchase
  | 'rollover'  // unused credits carried into the next billing period
  | 'refund'    // worker failure → return held credits
  | 'adjustment';// admin manual change

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: WalletTxType;
  amount: number;             // signed; positive = added, negative = deducted
  balanceAfter: number;
  // Context
  messageId: string | null;
  jobId: string | null;
  agentSlug: string | null;
  modelId: string | null;
  // Cost breakdown (deduct only)
  inputTokens: number | null;
  outputTokens: number | null;
  creditRate: number | null;
  agentMultiplier: number | null;
  planDiscount: number | null;
  // Audit / admin
  actorId: string | null;     // admin id for adjustments
  description: string;
  createdAt: string;
}
```

## Plan-Shape Extension (touches Module 2)

The `Plan` type in `src/types/plan.d.ts` already carries `creditsIncluded` and `creditDiscount`. Module 4 adds **no new column to `plans`**. Where the wallet needs values, it reads them from the **frozen `plan_snapshot`** on the active subscription via `req.plan` — preserving the snapshot guarantee from Module 2.

If Module 2 ships before Module 4, no migration is required by Module 4 against `plans`.

## File Structure

```
src/
├── config/
│   └── credits.ts                       ← MODEL_CREDIT_RATES, AGENT_MULTIPLIERS (defaults; admin-overridable on ai_models / agents tables)
├── gateway/
│   └── creditBudget.middleware.ts       ← Pipeline slot 10. Reads req.plan + estimate; calls wallet.holdPending; sets req.wallet.holdId
├── services/
│   ├── wallet.service.ts                ← Atomic SELECT…FOR UPDATE + INSERT wallet_transactions
│   └── creditCalculator.service.ts      ← Pure: cost(inputTokens, outputTokens, modelId, agentSlug, planDiscount) → number
├── routes/
│   ├── user/
│   │   └── wallet.routes.ts             ← /api/v1/wallet/*
│   └── admin/
│       └── wallets.routes.ts            ← /api/v1/admin/wallets/*
├── controllers/
│   ├── user/
│   │   └── wallet.controller.ts
│   └── admin/
│       └── wallets.controller.ts
├── events/
│   └── wallet.events.ts                 ← typed emitter
└── db/
    └── migrations/
        ├── 014_wallets.sql              ← wallets table + UNIQUE (user_id)
        └── 015_wallet_transactions.sql  ← ledger + indexes on (wallet_id, created_at desc), (job_id), (type, created_at)
```

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | `req.user.id` for wallet lookup |
| Module 2 — Plan & Subscription | `req.plan.creditDiscount` per request; `subscription.events.*` for grants/rollover/refund |
| Module 3 — Feature Flags | Already gates feature-bound endpoints; Module 4 trusts those checks |
| Module 5 — Rate Limit | Runs **before** Module 4 in the pipeline so denied users don't burn pending holds |
| Module 7 — Message Queue | Worker calls `wallet.confirmDeduction(holdId, actualTokens)` or `wallet.releaseHold(holdId)` |
| `src/infra/postgres.ts` | Single transaction per balance write |
| `src/utils/{response,errors,logger}.ts` | Standard envelope, `AppError`, structured logs |

## Modules That Will Use Module 4

| Downstream module | Where it integrates |
|---|---|
| Chat worker (Module 7) | After every LLM response → `confirmDeduction(holdId, { input, output, modelId, agentSlug })` |
| Subscription service (Module 2) | On period renewal → emit `subscription.events.renewed` → Module 4 grants new credits + handles rollover |
| Admin (Module 12 surface) | `POST /admin/users/:id/wallet` for manual adjustments (refund, comp, correction) |
| Usage tracker (Module 6) | Reads `wallet.events.deducted` to fill `usage_records.credits_deducted` |
