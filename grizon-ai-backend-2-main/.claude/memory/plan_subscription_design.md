---
name: Plan & Subscription Design Decisions
description: Key rules for how plans and subscriptions work — immutability, rollover, history tracking
type: project
originSessionId: 0c9d0c8e-5e36-4f0a-89fe-e618574d9cee
---
**Core rules for plans:**
- Plans are **immutable once active** — never edit a live plan, always create a new version
- Archive old plans when launching new ones — existing subscribers keep their plan, no new signups allowed
- `plan_snapshot` (frozen JSONB copy) is stored on the subscription at subscribe time for historical accuracy even after plan changes
- `is_introductory` flag for limited-time launch offers that get archived later
- `is_public` controls whether plan appears on pricing page

**Subscription rules:**
- Every user always has a subscription record (free users get a FREE plan sub)
- One active subscription per user at a time
- `billing_cycle`: monthly or annual (annual = per-month price when billed yearly)
- `cancel_at_period_end`: true = access continues until period ends, then stops
- `credits_rolled_over` tracked separately from `credits_granted` for analytics

**Credit rollover logic:**
- `plan.credits.rollover: boolean` — if false, unused credits expire at period end
- `plan.credits.maxRollover: number | null` — cap on rollover (null = unlimited)
- Rollover calculated at renewal: `min(unused_balance, maxRollover) + new_period_credits`

**Top-up packages:** Each plan can define ad-hoc credit packages users can purchase (e.g. 1000 credits for $5).

**How to apply:** When building plan CRUD in admin, enforce the archive-not-edit pattern. When building subscription renewal logic, always run the rollover calculation before zeroing the wallet.
