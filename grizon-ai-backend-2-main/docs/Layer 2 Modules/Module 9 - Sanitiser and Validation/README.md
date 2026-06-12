# Module 9 — Request Sanitiser & Validation

> Pipeline-slot 12 middleware: schema validation, prompt-injection strip, per-plan size enforcement, file type/size checks, HTML sanitisation, content policy.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §11](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, scope, types, file structure, dependencies |
| 2 | [02_VALIDATION_AND_INJECTION_GUARDS.md](02_VALIDATION_AND_INJECTION_GUARDS.md) | Per-route Zod schemas, prompt-injection patterns, length / file-size enforcement, HTML sanitisation, abuse-signal detection, error envelopes |
| 3 | [03_IMPLEMENTATION_PLAN.md](03_IMPLEMENTATION_PLAN.md) | Files to create/modify, build order, tests, verification |

## Status

- **Stage:** Planning complete · implementation not started
- **Owner:** Backend
- **Last updated:** 2026-05-05

## Key Decisions

- **Slot 12, locked.** Module 9 is the last guard before route handlers. It runs **after** auth, plan, feature flags, rate limit, and credit budget so it never wastes work on requests that will be denied upstream.
- **Per-route Zod schemas.** Module 9 does not own schemas globally; each route file imports its own schema and calls `parseBody(schema, req.body)`. The middleware's job is **non-schema** policy (length, injection, file checks, abuse signals, content policy).
- **Prompt-injection strip is a sanitiser, not a blocker.** Known patterns (`ignore previous instructions`, `disregard earlier system prompt`, `you are DAN`, etc.) are removed from the body before forwarding. Repeated attempts increment an abuse counter.
- **Length caps come from the plan.** `req.plan.limits.maxMessageContentLength` (Free 2 K, Starter 5 K, Pro 10 K, Enterprise 50 K). No hard-coded constants.
- **File-type whitelist + size cap** are enforced both here and in Module 8's upload route — defense-in-depth.
- **HTML inputs are stripped of `<script>`, event handlers, and javascript: URLs** via `sanitize-html` with a strict allowlist.
- **Repeat-message detection** (same `content` hash from same user > 5× in 60 s) emits `sanitiser.abuse_signal` for Module 5 / admin.
- **Content-policy keyword filter is a thin pass-through today.** Hook reserved for future moderation API integration; rejecting content is **not** done in Module 9 — the Smart Router's agents apply policy at LLM call time.
- **Fail-closed on Module 9 errors.** If sanitiser throws unexpectedly, `errorHandler` returns `INTERNAL_ERROR`. Never silently allow.

## Surface

- **0 user routes** (middleware-only)
- **0 admin routes** (admin abuse review goes through Module 5's `/admin/ratelimits/flagged` and Module 1's audit)
- **1 middleware:** `sanitiserMiddleware` at slot 12
- **1 service:** `sanitiser.service.ts` (pure helpers)
- **1 config file:** `sanitiser.ts` (regex catalogue, file allowlist, abuse thresholds)
- **0 tables** (abuse counters live in Redis; persistent flags re-use Module 1's `auth_audit`)
- **Postman groups:** none (no routes)

## Dependencies

- Module 1 — `req.user.id` for abuse counters
- Module 2 — `req.plan.limits.maxMessageContentLength`, `maxFileSize` (when Module 9 inspects file uploads at the form-data layer; main file checks live in Module 8)
- Module 5 — emits `sanitiser.abuse_signal` consumed by the rate-limit flagging path
- `src/infra/redis.ts` — abuse counters
- `src/utils/{response,errors,logger}.ts` — universal envelope, `AppError`, structured logs
- `sanitize-html` (npm) — HTML stripping
- `crypto` (node stdlib) — content hashing for repeat-message detection
