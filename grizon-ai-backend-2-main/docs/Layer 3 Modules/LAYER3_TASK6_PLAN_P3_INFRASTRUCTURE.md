# Layer 3 Task 6 — P3: Infrastructure Gaps
## Implementation Plan

> **Priority:** P3 — Operational hardening; none of these block core features  
> **Depends on:** P1 complete (Judge0 language map after tools are registered)  
> **Last Updated:** 2026-05-09

---

## Table of Contents
1. [Overview](#1-overview)
2. [3.1 Cloudflare R2 Storage](#2-31-cloudflare-r2-storage)
3. [3.2 Notification Worker Templates](#3-32-notification-worker-templates)
4. [3.3 Centralised Provider Health Monitor](#4-33-centralised-provider-health-monitor)
5. [3.4 Judge0 Language Map Expansion](#5-34-judge0-language-map-expansion)
6. [Files Changed / Created](#6-files-changed--created)

---

## 1. Overview

Four independent infrastructure gaps identified in the audit:

| Gap | Current State | Target |
|---|---|---|
| R2 storage | `throw notImplemented()` | Working S3-compatible R2 implementation |
| Notification templates | `JSON.stringify(vars)` as email body | HTML email templates for 4 event types |
| Provider health monitor | Circuit breaker only in modelSelector | Shared `ProviderHealthMonitor` used everywhere |
| Judge0 languages | 3 languages (python, javascript, typescript) | 9 languages per spec |

---

## 2. 3.1 Cloudflare R2 Storage

**File:** `src/artifacts/artifact.storage.ts`

### Current state
`R2ArtifactStorage` class exists with 4 methods all throwing `notImplemented("R2 artifact storage")`.

The env switch (`storageConfig.driver === 'r2'`) and the `ArtifactStorage` interface are already correct.

### Implementation using `@aws-sdk/client-s3`

R2 is S3-compatible. Use AWS SDK v3 with a custom endpoint.

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class R2ArtifactStorage implements ArtifactStorage {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = env.R2_BUCKET_NAME;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    const stream = response.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async signedUrl(key: string, ttlSec: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSec }
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }
}
```

### Required environment variables
Add to `.env.example`:
```
STORAGE_DRIVER=local            # 'local' or 'r2'
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

### Required packages
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Migration path
No code change needed outside this file. Switch `STORAGE_DRIVER=r2` in EasyPanel env when ready.

---

## 3. 3.2 Notification Worker Templates

**File:** `src/workers/notification.worker.ts`

### Current state
Sends raw `JSON.stringify(vars)` as email body — unusable as a real email.

### Required notification types
Based on events emitted in `chat.worker.ts` and the queue system:

| Event type | Trigger | Recipient |
|---|---|---|
| `job.completed` | Chat job finishes while user is offline | User |
| `job.failed` | Chat job errors after max retries | User |
| `credits.low` | Wallet balance < 10% of plan monthly grant | User |
| `ratelimit.flagged` | User flagged for manual review (Module 5) | Admin |

### Template approach
Use simple inline HTML — no templating engine dependency. Each template is a function returning HTML string.

**File:** `src/notifications/templates.ts`

```typescript
export function jobCompletedTemplate(vars: {
  userName: string;
  conversationTitle: string;
  agentUsed: string;
  creditsDeducted: number;
  previewText: string;
}): { subject: string; html: string } {
  return {
    subject: `Your ${vars.agentUsed} response is ready`,
    html: `
      <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#111">Response ready ✓</h2>
        <p>Hi ${vars.userName},</p>
        <p>Your <strong>${vars.agentUsed}</strong> has finished responding in 
           <strong>${vars.conversationTitle}</strong>.</p>
        <blockquote style="border-left:3px solid #ccc;padding:8px 16px;color:#555">
          ${vars.previewText}
        </blockquote>
        <p style="color:#888;font-size:12px">Credits used: ${vars.creditsDeducted}</p>
      </body></html>
    `,
  };
}

export function jobFailedTemplate(vars: {
  userName: string;
  errorCode: string;
}): { subject: string; html: string } {
  return {
    subject: 'Your request could not be completed',
    html: `
      <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#c00">Request failed</h2>
        <p>Hi ${vars.userName}, we were unable to complete your request (error: ${vars.errorCode}).</p>
        <p>Credits have been refunded. Please try again.</p>
      </body></html>
    `,
  };
}

export function creditsLowTemplate(vars: {
  userName: string;
  balance: number;
  planName: string;
}): { subject: string; html: string } {
  return {
    subject: 'Your credits are running low',
    html: `
      <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2>Credits running low</h2>
        <p>Hi ${vars.userName}, you have <strong>${vars.balance} credits</strong> remaining on your 
           <strong>${vars.planName}</strong> plan.</p>
        <p><a href="/wallet/topup" style="background:#111;color:#fff;padding:10px 20px;border-radius:4px;
           text-decoration:none">Top up credits</a></p>
      </body></html>
    `,
  };
}

export function rateLimitFlaggedTemplate(vars: {
  adminName: string;
  flaggedUserId: string;
  flaggedUserEmail: string;
  cooldownCount: number;
}): { subject: string; html: string } {
  return {
    subject: `User flagged for rate limit review: ${vars.flaggedUserEmail}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2>Rate limit review required</h2>
        <p>User <strong>${vars.flaggedUserEmail}</strong> (ID: ${vars.flaggedUserId}) 
           has hit the cooldown threshold ${vars.cooldownCount} times in 24 hours.</p>
        <p><a href="/admin/ratelimits/flagged/${vars.flaggedUserId}">Review in admin panel →</a></p>
      </body></html>
    `,
  };
}
```

### Updated `notification.worker.ts`

```typescript
import {
  jobCompletedTemplate,
  jobFailedTemplate,
  creditsLowTemplate,
  rateLimitFlaggedTemplate,
} from '../notifications/templates';

// In the worker process function:
const templateMap = {
  'job.completed':        jobCompletedTemplate,
  'job.failed':           jobFailedTemplate,
  'credits.low':          creditsLowTemplate,
  'ratelimit.flagged':    rateLimitFlaggedTemplate,
};

const templateFn = templateMap[job.data.type];
if (!templateFn) {
  logger.warn({ type: job.data.type }, 'Unknown notification type');
  return;
}

const { subject, html } = templateFn(job.data.vars);
await mailerService.sendHtml({ to: job.data.to, subject, html });
```

### `mailerService.sendHtml()` addition
Add an `html` variant to the existing mailer service if not present:
```typescript
async sendHtml(opts: { to: string; subject: string; html: string }): Promise<void>
```

---

## 4. 3.3 Centralised Provider Health Monitor

**File:** `src/models/health.ts` (new)

### Current state
Circuit-breaker tracking is embedded inside `src/router/modelSelector.ts`. This means:
- No shared health state between the router and the streaming layer
- No way for the provider to self-report failures back to the health monitor
- Health state is only updated on model selection, not on actual streaming failures

### Design

```typescript
export type HealthStatus = 'healthy' | 'degraded' | 'down';

interface HealthWindow {
  successes: number;
  failures: number;
  lastUpdated: number;        // epoch ms
  degradedSince: number | null;
  downSince: number | null;
}

const HEALTH_WINDOW_MS = 60_000;   // 60 second rolling window
const DEGRADED_THRESHOLD = 0.5;   // < 50% success rate
const MIN_CALLS_FOR_DEGRADED = 5; // need at least 5 calls before marking degraded
const DOWN_AFTER_DEGRADED_MS = 30_000;  // degraded for 30s → mark down
const RECOVER_AFTER_DOWN_MS = 60_000;   // down for 60s → retry

class ProviderHealthMonitor {
  private windows = new Map<string, HealthWindow>();

  recordSuccess(providerId: string): void {
    const w = this.getOrCreate(providerId);
    w.successes++;
    w.lastUpdated = Date.now();
    this.maybeRecover(providerId, w);
  }

  recordFailure(providerId: string): void {
    const w = this.getOrCreate(providerId);
    w.failures++;
    w.lastUpdated = Date.now();
    this.maybeDegrade(providerId, w);
  }

  getStatus(providerId: string): HealthStatus {
    const w = this.windows.get(providerId);
    if (!w) return 'healthy';
    const now = Date.now();

    if (w.downSince !== null) {
      if (now - w.downSince > RECOVER_AFTER_DOWN_MS) {
        // Reset and retry
        this.reset(providerId);
        return 'healthy';
      }
      return 'down';
    }

    if (w.degradedSince !== null) {
      if (now - w.degradedSince > DOWN_AFTER_DEGRADED_MS) {
        w.downSince = now;
        return 'down';
      }
      return 'degraded';
    }

    return 'healthy';
  }

  isAvailable(providerId: string): boolean {
    return this.getStatus(providerId) !== 'down';
  }

  private maybeDegrade(providerId: string, w: HealthWindow): void {
    const total = w.successes + w.failures;
    if (total < MIN_CALLS_FOR_DEGRADED) return;
    const rate = w.successes / total;
    if (rate < DEGRADED_THRESHOLD && w.degradedSince === null) {
      w.degradedSince = Date.now();
    }
  }

  private maybeRecover(providerId: string, w: HealthWindow): void {
    const total = w.successes + w.failures;
    if (total < MIN_CALLS_FOR_DEGRADED) return;
    const rate = w.successes / total;
    if (rate >= DEGRADED_THRESHOLD) {
      w.degradedSince = null;
      w.downSince = null;
    }
  }

  private reset(providerId: string): void {
    this.windows.set(providerId, {
      successes: 0, failures: 0,
      lastUpdated: Date.now(),
      degradedSince: null, downSince: null,
    });
  }

  private getOrCreate(providerId: string): HealthWindow {
    if (!this.windows.has(providerId)) this.reset(providerId);
    return this.windows.get(providerId)!;
  }
}

// Singleton — shared across router and streaming layer
export const providerHealth = new ProviderHealthMonitor();
```

### Integration points

**`src/router/modelSelector.ts`** — replace embedded circuit breaker with `providerHealth`:
```typescript
import { providerHealth } from '../models/health';
// Replace: if (health(p) != down)
// With:    if (providerHealth.isAvailable(p.id))
```

**`src/workers/chat.worker.ts`** — in the streaming error handler:
```typescript
import { providerHealth } from '../models/health';

// On each successful stream finish:
providerHealth.recordSuccess(decision.modelProvider);

// On provider error (retryable):
providerHealth.recordFailure(decision.modelProvider);
```

**`src/routes/admin/system.routes.ts`** — expose health in `GET /admin/system/health`:
```typescript
import { providerHealth } from '../../models/health';
// Add to health response:
providers: ['anthropic', 'openai', 'google', 'deepseek', 'xai'].map(id => ({
  id,
  status: providerHealth.getStatus(id),
}))
```

---

## 5. 3.4 Judge0 Language Map Expansion

**File:** `src/tools/codeExecution.tool.ts`

### Current state
Only 3 languages mapped:
```typescript
const LANG_MAP: Record<string, number> = {
  python: 71,
  javascript: 63,
  typescript: 74,
};
```

### Target: 9 languages per spec

```typescript
const LANG_MAP: Record<string, number> = {
  // Scripting
  python:     71,   // Python 3.8.1
  javascript: 63,   // JavaScript (Node.js 12.14.0)
  typescript: 74,   // TypeScript 3.7.4

  // Systems
  c:          50,   // C (GCC 9.2.0)
  cpp:        54,   // C++ (GCC 9.2.0)
  'c++':      54,   // alias

  // JVM / compiled
  java:       62,   // Java (OpenJDK 13.0.1)
  go:         60,   // Go (1.13.5)
  rust:       73,   // Rust (1.40.0)

  // Shell
  bash:       46,   // Bash (5.0.0)
};

// Validation: accepted language names (for display to LLM)
export const SUPPORTED_LANGUAGES = Object.keys(LANG_MAP);
```

### Update allowlist validation
```typescript
// Replace:
if (!['javascript', 'python', 'typescript'].includes(params.language)) {
// With:
if (!SUPPORTED_LANGUAGES.includes(params.language)) {
  return { ok: false, error: `Unsupported language: ${params.language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}` };
}
```

### Update tool description (in registry)
```
description: "Execute code in a sandbox. Supported languages: python, javascript, typescript, c, cpp, java, go, rust, bash. Returns stdout, stderr, exit_code."
```

---

## 6. Files Changed / Created

| File | Action |
|---|---|
| `src/artifacts/artifact.storage.ts` | **Modify** — implement `R2ArtifactStorage` |
| `src/notifications/templates.ts` | **Create** — 4 HTML email templates |
| `src/workers/notification.worker.ts` | **Modify** — use template functions |
| `src/models/health.ts` | **Create** — `ProviderHealthMonitor` singleton |
| `src/router/modelSelector.ts` | **Modify** — replace inline circuit breaker with `providerHealth` |
| `src/workers/chat.worker.ts` | **Modify** — call `providerHealth.recordSuccess/Failure` |
| `src/routes/admin/system.routes.ts` | **Modify** — expose provider health in health endpoint |
| `src/tools/codeExecution.tool.ts` | **Modify** — expand language map to 9 languages |
| `.env.example` | **Modify** — add R2 env vars |
| `package.json` | **Modify** — add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
