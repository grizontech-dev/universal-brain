# 05 — Logging

How the backend logs. One library, one format, one set of fields, redacted before it ever reaches disk.

## Principles

1. **Structured JSON in production**, pretty-printed in development. Never plain `console.log`.
2. **One logger.** `src/utils/logger.ts` exports a single Pino instance; everything else creates child loggers from it.
3. **One request log line per request.** Plus any explicit `logger.info/.error` calls inside that request.
4. **Sensitive fields are redacted before serialisation**, not after.
5. **Correlation via `request_id`.** Every log line within a request carries the same id.

## Library

[**Pino**](https://getpino.io) — fastest Node logger, structured by default, mature redaction support.

## Setup

```ts
// src/utils/logger.ts
import pino from 'pino';
import { env } from '@/config/env';

export const logger = pino({
  level: env.LOG_LEVEL,                          // trace | debug | info | warn | error | fatal
  base:  { service: 'api', version: env.APP_VERSION },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'req.body.password',
      'req.body.current_password',
      'req.body.new_password',
      'req.body.id_token',
      'req.body.refresh_token',
      'req.body.token',
      'res.body.access_token',
      'res.body.refresh_token',
      'user.password_hash',
      'oauth.id_token'
    ],
    remove: true                                 // keys are dropped, not replaced with [REDACTED]
  },
  transport: env.LOG_PRETTY
    ? { target: 'pino-pretty', options: { colorize: true, singleLine: false } }
    : undefined,                                 // raw JSON in production
  timestamp: pino.stdTimeFunctions.isoTime
});

// Per-request child logger (created in middleware)
export function reqLogger(reqId: string, userId?: string) {
  return logger.child({ req_id: reqId, user_id: userId });
}
```

## Levels — When to Use What

| Level | Use for | Example |
|---|---|---|
| `trace` | Hyper-verbose; off by default | "entered cacheManager.placeBreakpoint" |
| `debug` | Dev investigation | "rate-limit window count = 7" |
| `info` | Normal lifecycle | "request_completed", "user_registered", "queue_drained" |
| `warn` | Recoverable anomaly | "anthropic rate-limited; falling back to openai" |
| `error` | Request-failing or job-failing exception | "request_failed", "worker_job_failed" |
| `fatal` | Process about to die | "missing JWT key at boot" |

## Request Log Middleware

Mounted right after `requestId.middleware`. Logs **once per request** at the appropriate level.

```ts
// src/gateway/logger.middleware.ts
import { reqLogger } from '@/utils/logger';

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  req.log = reqLogger(req.id);

  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';

    req.log[level]({
      method:       req.method,
      path:         req.path,
      status:       res.statusCode,
      duration_ms:  durationMs,
      user_id:      req.user?.id,
      session_id:   req.session?.id,
      platform:     req.platform,
      ip:           ipPrefix24(req.ip),
      user_agent:   req.headers['user-agent']
    }, 'request_completed');
  });

  next();
}
```

## A Standard Request Log Line (production JSON)

```json
{
  "level": 30,
  "time": "2026-04-28T07:14:22.014Z",
  "service": "api",
  "version": "1.4.0",
  "req_id": "req_8a14…",
  "user_id": "usr_…",
  "session_id": "ses_…",
  "method": "POST",
  "path": "/api/v1/chat",
  "status": 200,
  "duration_ms": 312,
  "platform": "web",
  "ip": "203.0.113.0",
  "user_agent": "Mozilla/5.0 …",
  "msg": "request_completed"
}
```

## Inside a Service / Worker

Use `req.log` from the route, or pull a child logger keyed to a job id:

```ts
// inside a service called from a route
async function login(req, body) {
  const log = req.log.child({ flow: 'login' });
  log.info({ email_hash: hash(body.email) }, 'login_attempt');
  ...
  log.info({ user_id: user.id }, 'login_success');
}

// inside a BullMQ worker
const log = logger.child({ worker: 'chat', job_id: job.id, user_id: job.data.userId });
log.info({ agent: 'research' }, 'job_started');
```

## What to Log (and What Not To)

✅ **Do log**
- Request lifecycle (`request_completed`)
- Auth events (`login_success`, `login_failed` with email hash, `password_changed`)
- Decision points (`agent_selected`, `model_selected`, `cache_hit`)
- External calls (`anthropic_call`, with tokens + cost + latency, no prompt/response)
- Errors (full stack, no PII payload)

❌ **Never log**
- Plaintext passwords, refresh tokens, access tokens, Google ID tokens, reset tokens
- Full email of unauthenticated users (use SHA-256 hash for email-check audit)
- Full chat message bodies (PII heavy; aggregate metrics only)
- Uploaded file contents
- Stripe / payment payloads
- Customer support PII (only IDs)

The redaction config above drops the obvious ones automatically; the rule above is what to *not write in the first place*.

## Correlation

- Every response carries `x-request-id`.
- Every log line within a request carries the same id under `req_id`.
- Frontend errors include the `meta.request_id` from the response envelope (see [03_REQUEST_RESPONSE.md](03_REQUEST_RESPONSE.md)). Support staff paste the id, find the trace, done.

## Audit Logs vs App Logs

These are different streams:

| | App logs (Pino) | Audit (`auth_audit` table) |
|---|---|---|
| Storage | stdout → log aggregator | Postgres |
| Retention | 30 d hot, then archived | Permanent |
| Purpose | Operational debugging | Compliance, security investigation |
| Schema | Free-form JSON | Strict columns |

A login writes both: app log line `login_success` *and* a row in `auth_audit`. They serve different audiences.

## Aggregation

Phase 1: stdout → EasyPanel container logs → manual `docker logs`. Adequate for one VPS.

When traffic justifies it, ship to one of:
- **Better Stack / Logtail**
- **Grafana Loki** (self-hosted)
- **Axiom**

The Pino JSON output is already in the format these tools ingest; no code changes needed at switchover, only an env var (`LOG_DESTINATION`).

## Local Dev Output

`LOG_PRETTY=true` makes lines look like:

```
[07:14:22.014] INFO  (api/8237): request_completed
    req_id: "req_8a14…"
    method: "POST"
    path: "/api/v1/chat"
    status: 200
    duration_ms: 312
```

Set `LOG_LEVEL=debug` in `.env` to see decisions like cache hits, classifier outputs, etc.

## Performance Notes

- Pino is fast (sub-microsecond per log call); it's safe to log liberally at `info`.
- Avoid building expensive objects just to log: `log.debug({ payload: bigObj })` evaluates `bigObj` even when level is `info`. Wrap with a level check or use `log.isLevelEnabled('debug')`.
- Don't log inside hot loops (token streaming) at `info` — use `debug` or sample.

## Sample Code — Tying It All Together

```ts
// src/index.ts (excerpt)
import express from 'express';
import { logger } from '@/utils/logger';
import { requestId } from '@/gateway/requestId.middleware';
import { requestLogger } from '@/gateway/logger.middleware';
import { errorHandler } from '@/gateway/errorHandler.middleware';

const app = express();

app.use(requestId);          // sets req.id
app.use(requestLogger);      // sets req.log + logs at finish
app.use(express.json());
// ... auth, plan, ratelimit ...
app.use('/api/v1', userRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use(errorHandler);       // last

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'http_listening');
});
```

That's the entire logging contract. Every module participates by using `req.log` or a child of the root `logger`, and respecting the redaction list.
