# 04 — Error Handling

How errors are raised, classified, displayed to users, and logged.

## Principles

1. **One error class.** Every expected error is an instance of `AppError`. Anything else bubbles up as `INTERNAL_ERROR` (logged, generic message to user).
2. **Stable codes.** `error.code` is part of the public contract. Frontend conditionals key off it. Codes are screaming-snake-case strings (`INVALID_CREDENTIALS`).
3. **Always carry a user-safe message.** The thrown `AppError` includes a `message` already suitable for display. The error handler puts that message into the response envelope unchanged.
4. **Never leak internals.** Stack traces, SQL strings, raw provider payloads stay in logs. The user gets a sanitised message.
5. **Field-level errors are structured.** Validation errors return a list of `{ path, code, message }` so the frontend can attach inline hints.

## `AppError` Class

```ts
// src/utils/errors.ts
export type ErrorDetails = Record<string, unknown> | undefined;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage: string;     // the message shown to end users
  readonly details?: ErrorDetails;
  readonly cause?: unknown;         // original error (for logs only)

  constructor(opts: {
    status: number;
    code: string;
    message: string;                // user-facing
    details?: ErrorDetails;
    cause?: unknown;
    logMessage?: string;            // override for logs; defaults to message
  }) {
    super(opts.logMessage ?? opts.message);
    this.status = opts.status;
    this.code = opts.code;
    this.userMessage = opts.message;
    this.details = opts.details;
    this.cause = opts.cause;
  }
}
```

### Common throw helpers

```ts
export const Errors = {
  validation: (fields: FieldError[]) => new AppError({
    status: 400,
    code: 'VALIDATION_FAILED',
    message: 'Please fix the highlighted fields.',
    details: { fields }
  }),

  notAuthenticated: () => new AppError({
    status: 401, code: 'NOT_AUTHENTICATED',
    message: 'Please sign in to continue.'
  }),

  invalidCredentials: () => new AppError({
    status: 401, code: 'INVALID_CREDENTIALS',
    message: 'Email or password is incorrect.'
  }),

  accountLocked: (lockedUntil: Date) => new AppError({
    status: 423, code: 'ACCOUNT_LOCKED',
    message: 'Too many failed attempts. Try again in a few minutes.',
    details: { locked_until: lockedUntil.toISOString() }
  }),

  notFound: (label: string) => new AppError({
    status: 404, code: 'NOT_FOUND',
    message: `${label} not found.`
  }),

  rateLimited: (retryAfter: number, type: string) => new AppError({
    status: 429, code: 'RATE_LIMITED',
    message: "You're sending requests too fast. Please wait a moment and try again.",
    details: { retry_after_seconds: retryAfter, limit_type: type }
  }),

  insufficientCredits: (needed: number, available: number) => new AppError({
    status: 402, code: 'INSUFFICIENT_CREDITS',
    message: 'Not enough credits to complete this action.',
    details: { needed, available }
  }),

  upstream: (provider: string, cause: unknown) => new AppError({
    status: 502, code: 'UPSTREAM_UNAVAILABLE',
    message: 'A service we depend on is temporarily unavailable. Please try again shortly.',
    details: { provider },
    cause
  }),

  internal: (cause: unknown) => new AppError({
    status: 500, code: 'INTERNAL_ERROR',
    message: 'Something went wrong on our side. We have been notified.',
    cause
  })
};
```

## Error Middleware

Final middleware in the chain. Catches everything:

```ts
// src/gateway/errorHandler.middleware.ts
import { fail } from '@/utils/response';
import { AppError, Errors } from '@/utils/errors';
import { logger } from '@/utils/logger';

export function errorHandler(err, req, res, _next) {
  const appErr = err instanceof AppError ? err : Errors.internal(err);

  // Log: full detail, never sanitised
  logger.error({
    err: {
      message: err.message,
      stack:   err.stack,
      code:    appErr.code,
      cause:   appErr.cause
    },
    req_id:   req.id,
    user_id:  req.user?.id,
    path:     req.path,
    method:   req.method
  }, 'request_failed');

  fail(res, appErr.status, appErr.code, appErr.userMessage, appErr.details);
}
```

## Validation (Zod) Adapter

Routes use Zod schemas. A small wrapper turns Zod failures into `VALIDATION_FAILED`:

```ts
import { z } from 'zod';
import { Errors } from '@/utils/errors';

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = result.error.issues.map(i => ({
      path:    i.path.join('.'),
      code:    mapZodCode(i.code),
      message: i.message                     // schema authors write user-facing messages
    }));
    throw Errors.validation(fields);
  }
  return result.data;
}
```

When defining a schema, **author the messages as user-facing strings**:

```ts
const RegisterBody = z.object({
  email:    z.string().email('Enter a valid email address.'),
  password: z.string().min(10, 'Password must be at least 10 characters.'),
  name:     z.string().min(1, 'Name is required.').max(60, 'Name is too long.')
});
```

## Error Code Catalogue

Stable codes the frontend may switch on. Modules add to this list; don't rename existing ones. (Renames require a deprecation cycle.)

### Auth (Module 1)

| Code | Status | Default user message |
|---|---|---|
| `NOT_AUTHENTICATED` | 401 | "Please sign in to continue." |
| `INVALID_TOKEN` | 401 | "Your session is invalid. Please sign in again." |
| `TOKEN_EXPIRED` | 401 | "Your session has expired. Please sign in again." |
| `TOKEN_REVOKED` | 401 | "Your session was signed out. Please sign in again." |
| `TOKEN_REUSED` | 401 | "Suspicious activity detected. Please sign in again." |
| `INVALID_CREDENTIALS` | 401 | "Email or password is incorrect." |
| `ACCOUNT_LOCKED` | 423 | "Too many failed attempts. Try again in a few minutes." |
| `USER_BANNED` | 403 | "This account has been disabled." |
| `EMAIL_NOT_VERIFIED` | 403 | "Please verify your email to continue." |
| `EMAIL_TAKEN` | 409 | "An account with this email already exists." |
| `INVALID_EMAIL` | 400 | "Enter a valid email address." |
| `PASSWORD_TOO_WEAK` | 400 | "Choose a stronger password." |
| `INVALID_GOOGLE_TOKEN` | 400 | "Google sign-in failed. Please try again." |
| `GOOGLE_EMAIL_NOT_VERIFIED` | 400 | "Your Google email is not verified yet." |
| `GOOGLE_ALREADY_LINKED` | 409 | "This Google account is linked to another user." |
| `ALREADY_LINKED` | 409 | "Google is already linked to your account." |
| `LAST_SIGN_IN_METHOD` | 400 | "Set a password before unlinking Google — it's your only sign-in method." |
| `CAPTCHA_REQUIRED` | 403 | "Please complete the captcha to continue." |
| `ADMIN_REQUIRED` | 403 | "You don't have permission to perform this action." |
| `SUPERADMIN_REQUIRED` | 403 | "This action requires a superadmin." |
| `PLATFORM_MISMATCH` | 400 | "This action isn't available on this device." |

### Resource & validation

| Code | Status | Default user message |
|---|---|---|
| `VALIDATION_FAILED` | 400 | "Please fix the highlighted fields." |
| `NOT_FOUND` | 404 | "Not found." (caller usually overrides with a specific noun) |
| `CONFLICT` | 409 | "That action conflicts with the current state." |

### Quotas & cost

| Code | Status | Default user message |
|---|---|---|
| `RATE_LIMITED` | 429 | "You're sending requests too fast. Please wait and try again." |
| `INSUFFICIENT_CREDITS` | 402 | "Not enough credits to complete this action." |
| `FEATURE_NOT_AVAILABLE` | 403 | "This feature isn't available on your plan." |

### System

| Code | Status | Default user message |
|---|---|---|
| `UPSTREAM_UNAVAILABLE` | 502 | "A service we depend on is temporarily unavailable. Please try again shortly." |
| `INTERNAL_ERROR` | 500 | "Something went wrong on our side. We have been notified." |

## Localisation (forward-looking)

`message` ships in English today. When localisation lands:
1. Each error code maps to a key (e.g. `errors.invalid_credentials`).
2. The error middleware reads `Accept-Language` and resolves the key against locale files.
3. The wire shape is unchanged — only the string content is translated.
4. `details` keys (`locked_until`, `retry_after_seconds`) stay locale-neutral; the frontend formats them.

## Throwing — Quick Reference

| Situation | Throw |
|---|---|
| Bad input | `Errors.validation([...])` (after Zod) |
| Wrong password | `Errors.invalidCredentials()` |
| Banned account | `new AppError({ status: 403, code: 'USER_BANNED', message: 'This account has been disabled.' })` |
| Resource missing | `Errors.notFound('Conversation')` |
| Plan gate | `new AppError({ status: 403, code: 'FEATURE_NOT_AVAILABLE', message: '…on your plan.' })` |
| Anthropic 503 | `Errors.upstream('anthropic', err)` |
| Anything unexpected | Don't catch — let the middleware turn it into `INTERNAL_ERROR` |

## What NOT to do

- ❌ `res.status(401).json({ error: 'wrong password' })` — bypasses the envelope and the logger.
- ❌ `throw new Error('not authorised')` — generic JS errors become `INTERNAL_ERROR` (500). Use `AppError`.
- ❌ Including SQL, file paths, or upstream payload snippets in `message`.
- ❌ Silently swallowing errors. If you catch one, either rethrow as `AppError` or log it explicitly.
