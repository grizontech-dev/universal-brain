# Module 2 — Plan & Subscription

> Single source of truth for the plan catalog and subscription layer of the Layer 2 API Gateway.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §4](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, responsibilities, non-goals, inputs/outputs |
| 2 | [02_FILE_STRUCTURE.md](02_FILE_STRUCTURE.md) | Every file in the module + its purpose |
| 3 | [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md) | `plans`, `subscriptions`, `subscription_history` DDL |
| 4 | [04_ACCESS_CONTROL.md](04_ACCESS_CONTROL.md) | RBAC, middleware chain, error codes |
| 5 | [05_USER_API_CONTRACTS.md](05_USER_API_CONTRACTS.md) | 4 user endpoints under `/api/v1/{subscription,plans}/*` |
| 6 | [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md) | 8 admin endpoints under `/api/v1/admin/{plans,subscriptions}/*` |
| 7 | [07_FLOWS.md](07_FLOWS.md) | Registration, request pipeline, upgrade, cancel, archive, renewal |
| 8 | [08_SECURITY.md](08_SECURITY.md) | Threat model + mitigations (snapshot tampering, IDOR, replay, etc.) |
| 9 | [09_DEPENDENCIES.md](09_DEPENDENCIES.md) | Inter-module contracts and emitted events |
| 10 | [MODULE2_STATUS_REPORT.md](MODULE2_STATUS_REPORT.md) | Implementation tracking |
| — | [MODULE2_VISUAL.html](MODULE2_VISUAL.html) | Visual diagrams (open in a browser) |

## Reading Order

If you are new to the module: **01 → 04 → 07 → 02 → 03 → 05 → 06 → 08 → 09**.
If you are implementing: **02 → 03 → 05 → 06 → 04 → 08 → 07 → 09**.

## Status

- **Stage:** Implemented (see [MODULE2_STATUS_REPORT.md](MODULE2_STATUS_REPORT.md))
- **Owner:** Backend
- **Last updated:** 2026-05-03

## Key Decisions Locked In

- **Currency:** INR, stored as **paise** (smallest unit, integer). Overrides the USD example in the gateway doc.
- **Payment Gateway:** **PhonePe** (not Stripe). Module 2 ships **no live PG calls**; schema reserves PhonePe-shaped `pg_*` columns and a `PaymentGatewayAdapter` interface stub.
- **Cancel semantics:** dedicated `POST /subscription/cancel` with graceful (default) and `immediate` modes. The `/subscription/upgrade` endpoint **rejects** the FREE plan id with `INVALID_UPGRADE_TARGET`.
- **Period anchoring:** new subscription's `currentPeriodStart = now()` on upgrade. No proration.
- **Snapshot freezing:** every subscription carries a `plan_snapshot` (JSONB). Live plan edits never affect existing subscribers.
- **One-active-sub invariant:** enforced via partial unique index `UNIQUE (user_id) WHERE status='active'`.

## Current Implementation Focus

- Use this documentation set as the source of truth while writing migrations 009–012, services, routes, and the real `planMiddleware`.
- Track implementation delta and live route exposure in [MODULE2_STATUS_REPORT.md](MODULE2_STATUS_REPORT.md).
- Update [`grizon-ai-backend-2.postman_collection.json`](../../../grizon-ai-backend-2.postman_collection.json) and [`docs/LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md) as endpoints go live.
