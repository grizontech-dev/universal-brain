# 01 — Overview

## Mission

Module 9 is the **last gate**. Every authenticated, plan-checked, rate-allowed, credit-funded request still has to be safe and well-formed before a route handler touches it. Module 9 removes the ways a request can break the system: oversized bodies, malformed payloads, prompt-injection prefixes, hostile HTML, repeat-spam patterns, files that don't match their declared type.

It does **not** sit on top of validation as a replacement for per-route Zod schemas — those still happen in the route via `parseBody(schema, req.body)`. Module 9 owns the policy that doesn't fit in a per-route schema: length capped by plan, body shape independent of the route, injection patterns, file-form checks, abuse signals.

## Scope

### In scope
- `sanitiserMiddleware` at pipeline slot 12 (locked, see [`LLM_NEW_MODULE_PROMPT.md`](../../LLM_NEW_MODULE_PROMPT.md))
- Pure helpers in `sanitiser.service.ts`:
  - `stripPromptInjection(text)` — pattern catalogue + redaction
  - `enforceMessageLength(text, max)` — throws `MESSAGE_TOO_LONG` past the cap
  - `sanitiseHtml(text)` — strict allowlist via `sanitize-html`
  - `hashContent(userId, text)` — for repeat-message detection
  - `validateFilePart(part, plan)` — multipart guard at form-data parse time
- Abuse counters in Redis with sliding 60 s windows (`sanitiser:repeat:{userId}:{hash}` and `sanitiser:injection_attempts:{userId}`)
- Emit `sanitiser.abuse_signal` to the rate-limit flagging hook
- A Zod adapter `parseBody<T>(schema, body): T` reused by every route file (see [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md))

### Out of scope
- Per-route schemas (each route owns its own)
- LLM-side moderation / policy classification (lives in agents, not here)
- File parsing or virus scanning (Module 8's file worker does parsing; AV scan reserved for later)
- Image / video frame analysis (Module 8 + agents)
- IP / TLS sanitisation (nginx / helmet at the edge)

## Inputs

| Source | What it carries |
|---|---|
| `req.user.id` (Module 1) | Abuse-counter bucket key |
| `req.plan.limits.maxMessageContentLength` (Module 2) | Per-plan body cap |
| `req.plan.limits.maxFileSize` (Module 2) | Form-data upload cap |
| `req.body` | The thing being sanitised |
| `req.is('multipart/form-data')` | Triggers file-part validation |

If `req.user` or `req.plan` is missing on a route that uses Module 9, that's a programming bug — surfaced as `500 INTERNAL_ERROR`. The middleware never falls back to a default plan.

## Outputs

- **Allow** → `next()` after rewriting `req.body` with sanitised content (e.g. injection prefixes stripped, HTML cleaned)
- **Deny** → one of:
  - `400 VALIDATION_FAILED` (size/type/HTML structure)
  - `400 MESSAGE_TOO_LONG` (over plan cap)
  - `400 FILE_TOO_LARGE` (multipart over plan cap)
  - `400 FILE_TYPE_NOT_ALLOWED`
  - `400 PROMPT_INJECTION_REJECTED` (when **rejection** mode is on for a sensitive route — default is **strip**)
  - `409 REPEAT_MESSAGE` (same content > 5× in 60 s)
- **Events emitted** on `src/events/sanitiser.events.ts`:
  - `sanitiser.injection_stripped` `{ userId, route, patternsMatched: string[] }`
  - `sanitiser.abuse_signal` `{ userId, kind: 'repeat_message' | 'injection_burst' }`

All HTTP responses use the universal envelope from [`Project Foundation/03_REQUEST_RESPONSE.md`](../../Project%20Foundation/03_REQUEST_RESPONSE.md).

## Type Contracts

```ts
// src/types/sanitiser.d.ts
export interface SanitiserPolicy {
  allowedFileTypes: readonly string[];
  maxMessageLength: number;
  maxFileSize: number;                      // bytes
  injectionMode: 'strip' | 'reject';        // per-route override; default 'strip'
}

export interface InjectionPattern {
  id: string;                                // 'ignore_prev_instructions'
  regex: RegExp;
  redaction: string;                         // typically empty string; some patterns get '[redacted]'
}

export interface FilePartCheck {
  fieldName: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
}
```

## File Structure

```
src/
├── config/
│   └── sanitiser.ts                  ← INJECTION_PATTERNS, FILE_ALLOWLIST (mime → ext), DEFAULT_POLICY, REPEAT_THRESHOLD={count:5,withinSec:60}
├── gateway/
│   └── sanitiser.middleware.ts       ← Pipeline slot 12. Reads policy, runs all checks, mutates req.body, throws on deny
├── services/
│   └── sanitiser.service.ts          ← stripPromptInjection, enforceMessageLength, sanitiseHtml, hashContent, validateFilePart
├── utils/
│   └── parseBody.ts                  ← Zod adapter (already exists per Project Foundation 04; cross-reference)
├── events/
│   └── sanitiser.events.ts           ← Typed emitter
└── types/
    └── sanitiser.d.ts
```

No tables, no routes, no migrations. Module 9's footprint is two files plus the existing middleware slot.

## Dependencies

| Dependency | How used |
|---|---|
| Module 1 — Auth | `req.user.id` |
| Module 2 — Plan & Subscription | `req.plan.limits.maxMessageContentLength`, `maxFileSize` |
| Module 5 — Rate Limit | Listens for `sanitiser.abuse_signal` and may flag the user |
| `src/infra/redis.ts` | Repeat-message + injection-attempt counters |
| `sanitize-html` | HTML allowlist |
| `crypto` | SHA-256 of message content for repeat detection |
| `src/utils/{response,errors,logger}.ts` | Standard envelope, `AppError`, structured logs |

## Modules That Will Use Module 9

| Downstream module | How |
|---|---|
| Module 7 — `POST /chat` | Body content stripped of injection prefixes, length-capped before enqueue |
| Module 8 — `POST /files/upload` | Multipart file parts validated for size + mime/extension match |
| Module 8 — `PATCH /conversations/:id` (title) | HTML stripped from title; length-capped at 120 chars |
| Module 8 — artifact text content | HTML/code blocks pass through `sanitiseHtml` only when type='html'; other types untouched |
| Every other authed route | Inherits length cap and injection strip via the global middleware |
