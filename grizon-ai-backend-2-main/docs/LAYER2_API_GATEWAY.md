# Layer 2 — API / Backend Gateway
## Complete Module Reference & Design Specification

> **Status:** Active Design  
> **Stack:** Express / TypeScript · PostgreSQL · Redis · BullMQ  
> **Last Updated:** April 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Request Lifecycle](#2-request-lifecycle)
3. [Module 1 — Auth & Identity](#3-module-1--auth--identity)
4. [Module 2 — Plan & Subscription System](#4-module-2--plan--subscription-system)
5. [Module 3 — Feature Flag Engine](#5-module-3--feature-flag-engine)
6. [Module 4 — Credit Wallet System](#6-module-4--credit-wallet-system)
7. [Module 5 — Rate Limiting (4-Tier)](#7-module-5--rate-limiting-4-tier)
8. [Module 6 — Usage Tracking & Analytics](#8-module-6--usage-tracking--analytics)
9. [Module 7 — Message Queue System](#9-module-7--message-queue-system)
10. [Module 8 — Conversation & Message Structure](#10-module-8--conversation--message-structure)
11. [Module 9 — Request Sanitiser & Validation](#11-module-9--request-sanitiser--validation)
12. [Module 10 — Smart Router](#12-module-10--smart-router)
13. [Module 11 — User API](#13-module-11--user-api)
14. [Module 12 — Admin API](#14-module-12--admin-api)
15. [Database Schema](#15-database-schema)
16. [Folder Structure](#16-folder-structure)
17. [API Endpoint Reference](#17-api-endpoint-reference)

---

## 1. Architecture Overview

```
┌───────────────────────────┐    ┌───────────────────────────┐
│      Web App (Next.js)    │    │     Admin App (Next.js)   │
│  Chat · Agents · Artifacts│    │  Users · Plans · Analytics│
└────────────┬──────────────┘    └─────────────┬─────────────┘
             │                                  │
             └──────────────┬───────────────────┘
                            │ HTTPS / SSE
                   ┌────────▼────────┐
                   │      NGINX      │
                   │  SSL · Routing  │
                   └────────┬────────┘
                            │
          ┌─────────────────▼─────────────────────────────┐
          │           EXPRESS / TYPESCRIPT API             │
          │                                                │
          │  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
          │  │  MODULE 1│  │  MODULE 2│  │   MODULE 3  │  │
          │  │  Auth &  │  │  Plan &  │  │  Feature    │  │
          │  │ Identity │  │  Subs    │  │  Flags      │  │
          │  └──────────┘  └──────────┘  └─────────────┘  │
          │                                                │
          │  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
          │  │  MODULE 4│  │  MODULE 5│  │   MODULE 6  │  │
          │  │  Credit  │  │  Rate    │  │  Usage      │  │
          │  │  Wallet  │  │  Limits  │  │  Tracking   │  │
          │  └──────────┘  └──────────┘  └─────────────┘  │
          │                                                │
          │  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
          │  │  MODULE 7│  │  MODULE 8│  │   MODULE 9  │  │
          │  │  Message │  │  Convers-│  │  Sanitiser  │  │
          │  │  Queue   │  │  ations  │  │  Validation │  │
          │  └──────────┘  └──────────┘  └─────────────┘  │
          │                                                │
          │  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
          │  │ MODULE 10│  │ MODULE 11│  │  MODULE 12  │  │
          │  │  Smart   │  │  User    │  │   Admin     │  │
          │  │  Router  │  │  API     │  │   API       │  │
          │  └──────────┘  └──────────┘  └─────────────┘  │
          └──────┬──────────────┬──────────────┬───────────┘
                 │              │              │
         ┌───────▼──┐    ┌──────▼──┐   ┌──────▼──┐
         │ Postgres  │    │  Redis  │   │ BullMQ  │
         │ Users     │    │ Cache   │   │ Queues  │
         │ Plans     │    │ Sessions│   │ Workers │
         │ Wallets   │    │ Limits  │   └─────────┘
         │ Messages  │    │ Locks   │
         └───────────┘    └─────────┘
```

---

## 2. Request Lifecycle

Every request passes through these layers **in order**:

```
Incoming Request
      │
      ▼
1. Auth Middleware          → Verify JWT, load user object
      │
      ▼
2. Plan Resolver            → Load active plan + capabilities from Redis/DB
      │
      ▼
3. Feature Flag Check       → Does this plan allow this feature/agent?
      │
      ▼
4. Rate Limit Check         → Hourly / Daily / Weekly / Monthly counters
      │
      ▼
5. Credit Budget Check      → Does user have enough credits in wallet?
      │
      ▼
6. Request Sanitiser        → Validate schema, strip injection, enforce limits
      │
      ▼
7. Route Handler            → /user/* or /admin/*
      │
      ▼
8. Queue Dispatch           → Enqueue job (BullMQ), return job ID immediately
      │
      ▼
9. Smart Router             → Classify intent → select model → select agent
      │
      ▼
10. Agent + LLM             → Execute, stream response via SSE
      │
      ▼
11. Usage Recording         → Deduct credits, log usage, update counters
```

---

## 3. Module 1 — Auth & Identity

> **Detailed spec:** [`docs/Layer 2 Modules/Module 1 - Auth and Identity/`](Layer%202%20Modules/Module%201%20-%20Auth%20and%20Identity/README.md). This section is a high-level summary; for endpoint contracts, schemas, flows, and security details, see those documents.

**Files:** `src/gateway/auth.middleware.ts`, `src/gateway/admin.middleware.ts`, `src/services/{auth,token,password,oauth,profile,session,audit}.service.ts`, `src/routes/{user,admin}/auth.routes.ts`

### Responsibilities

| Feature | Detail |
|---|---|
| JWT Verification | RS256 access tokens (15 min), verified on every request against issuer / audience / expiry / blacklist |
| User Loading | Attaches `req.user`, `req.session`, `req.platform`, `req.token` for downstream modules |
| Refresh Tokens | Postgres-backed (one row per device in `refresh_tokens`), 30-day TTL, rotated on every use, with **family-based reuse detection** |
| Multi-Device Sessions | A user can be signed in on web + admin + iOS + Android concurrently. Each device is one row; user can list and revoke individual devices via `/auth/sessions` |
| Token Blacklist | On logout / ban / password-change, JTIs go into Redis `auth:blacklist:{jti}` (TTL = remaining JWT life), mirrored to Postgres for cold-restart recovery |
| Email + Password | argon2id hash, lockout after 5 fails / 15 min, full reset + verification flows |
| **Google Sign-In / Sign-Up** | Single endpoint `POST /auth/google` accepts a Google ID token (web GIS or native SDK) and resolves to one of three outcomes: `logged_in` (sub already linked) · `linked_existing` (matched by verified email) · `registered` (fresh account, `password_hash = NULL`) |
| **Email Pre-Check** | `POST /auth/check-email` returns `{ exists, has_password, has_google, suggested_action }` so the frontend can route to login / "Continue with Google" / sign-up before showing the password screen |
| User Profile | Editable `name`, `bio`, `avatar_url`, `locale`, `timezone` via `GET/PATCH /auth/me` |
| Role Guard | `requireAdmin` and `requireSuperadmin` middleware on all `/admin/*` routes |
| Platform Detection | `x-platform: web \| admin \| mobile-ios \| mobile-android` (no `api` — programmatic API access is **not** offered) |
| Device Fingerprint | SHA-256(UA + ip-prefix + accept-language) recorded on every auth event for security audit |
| Audit Log | Append-only `auth_audit` row for every login, logout, password change, ban, impersonation, Google link/unlink, email check |

### Surface Summary

- **18** user endpoints under `/api/v1/auth/*` (incl. `check-email`, `google`, `google/link`, `sessions`, …)
- **11** admin endpoints under `/api/v1/admin/auth/*` (users, sessions, audit, ban/unban/impersonate)
- **2** middleware: `auth`, `admin`
- **6** services: `auth`, `token`, `password`, `oauth`, `audit`, `session` (+ `profile`)
- **13** domain events: `auth.registered`, `auth.login`, `auth.login_new_device`, `auth.logout`, `auth.logout_all`, `auth.profile_updated`, `auth.password_changed`, `auth.google_linked`, `auth.google_unlinked`, `auth.email_check`, `auth.banned`, `auth.unbanned`, `auth.impersonated`

### Role System

```typescript
enum UserRole {
  USER       = 'user',       // standard users
  ADMIN      = 'admin',      // full admin panel access
  SUPERADMIN = 'superadmin'  // can manage other admins, rotate keys, impersonate
}
```

### Auth Flow (Bearer + Refresh)

```
POST /auth/check-email      → { exists, has_password, has_google, suggested_action }
POST /auth/login            → access_token (15m) + refresh_token (30d, family_id)
POST /auth/google           → same shape; outcome ∈ { logged_in, linked_existing, registered }
POST /auth/refresh          → rotates refresh; reuse detection revokes the whole family
POST /auth/logout           → blacklists JTI + revokes that one refresh_tokens row
POST /auth/logout-all       → revokes every device + blacklists every active JTI
GET  /auth/sessions         → all signed-in devices (multi-device list)
```

### Out of Scope

- Programmatic API access (no API keys, no `X-API-Key`, no scopes — first-party clients only)
- OAuth providers other than Google (Apple / GitHub deferred; `oauth_accounts` table is provider-agnostic)
- MFA enrolment (schema reserves `users.mfa_secret` / `mfa_enabled` for later)

---

## 4. Module 2 — Plan & Subscription System

**Files:** `src/gateway/plan.middleware.ts`, `src/services/plan.service.ts`, `src/services/subscription.service.ts`

### Design Principles

- Plans are **immutable once active** — never edit a live plan, create a new version
- A plan can be **archived** (existing subscribers keep it, no new signups)
- Users always have a subscription record — even free users get a `FREE` plan subscription
- Subscriptions can be `monthly` or `annual` (annual gets a discount)
- Credits can optionally **roll over** to next billing period (plan-level flag)
- One user can have only one **active** subscription at a time

### Plan Object

```typescript
interface Plan {
  id: string;
  name: string;                     // "Pro", "Starter", "Intro Special"
  slug: string;                     // "pro", "starter", "intro-special"
  status: 'active' | 'archived';   // archived = no new signups
  isPublic: boolean;                // show on pricing page
  isIntroductory: boolean;          // flag for limited-time plans
  
  pricing: {
    monthly: number;                // USD cents (e.g. 2000 = $20)
    annual: number;                 // USD cents per month when billed annually
    currency: 'usd';
  };
  
  credits: {
    included: number;               // credits per billing period
    rollover: boolean;              // carry unused credits to next period
    maxRollover: number | null;     // cap on rolled-over credits (null = unlimited)
    topupEnabled: boolean;          // allow manual credit purchases
    topupPackages: CreditPackage[]; // [{credits: 1000, price: 500}]
  };
  
  limits: {
    hourly: number;                 // max requests per hour
    daily: number;                  // max requests per day
    weekly: number;                 // max requests per week
    monthly: number;                // max requests per month
    maxContextMessages: number;     // conversation history depth
    maxFileSize: number;            // bytes
    maxFilesPerChat: number;
    maxArtifactVersions: number;
  };
  
  modelAccess: string[];            // list of model IDs allowed
  agentAccess: string[];            // list of agent slugs allowed
  featureFlags: Record<string, boolean>;
  
  createdAt: Date;
  archivedAt: Date | null;
  createdBy: string;                // admin user id
}
```

### Subscription Object

```typescript
interface Subscription {
  id: string;
  userId: string;
  planId: string;
  planSnapshot: Plan;               // frozen copy of plan at time of subscription
  
  billingCycle: 'monthly' | 'annual';
  status: 'active' | 'past_due' | 'cancelled' | 'paused';
  
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  
  creditsGranted: number;           // credits given at period start
  creditsRolledOver: number;        // credits brought from previous period
  
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  
  history: SubscriptionHistory[];   // plan changes, renewals log
  createdAt: Date;
}
```

### Plan Lifecycle

```
Admin creates plan (status: active, isPublic: true)
  → Users can subscribe
  → Admin launches new plan
  → Archive old plan (existing subs continue, new signups go to new plan)
  → Users on archived plan see banner offering upgrade
  → User upgrades → new subscription starts, old one ends at period end
```

### Credit Rollover Logic

```
At billing period renewal:
  unused_credits = wallet.balance
  
  if plan.credits.rollover:
    rollover = min(unused_credits, plan.credits.maxRollover ?? Infinity)
    new_balance = plan.credits.included + rollover
  else:
    new_balance = plan.credits.included
  
  wallet.balance = new_balance
  log: subscription_renewal event
```

---

## 5. Module 3 — Feature Flag Engine

**File:** `src/gateway/featureFlag.middleware.ts`, `src/config/features.ts`

### Feature Flags Per Plan

```typescript
interface FeatureFlags {
  // Search & Research
  webSearch: boolean;               // Tavily / Brave search
  smartSynthesizer: boolean;        // multi-source synthesis agent
  deepResearch: boolean;            // multi-step research agent
  
  // Document Handling
  fileUpload: boolean;              // upload PDF, DOCX, XLSX, etc.
  documentCreation: boolean;        // generate Word, Excel, PDF
  documentAnalysis: boolean;        // extract, compare, summarise files
  
  // Code & Execution
  codeExecution: boolean;           // Judge0 sandboxed runner
  codeAgent: boolean;               // code write/debug agent
  
  // UI & Artifacts
  htmlPreview: boolean;             // sandboxed iframe preview
  uiGenerator: boolean;             // UI generation agent
  artifactVersioning: boolean;      // multi-version artifact history
  
  // Power User
  modelPicker: boolean;             // manual model selection
  customSystemPrompt: boolean;      // prefix custom instructions
  temperatureControl: boolean;      // adjust model temperature
  
  // Memory
  longTermMemory: boolean;          // Qdrant semantic memory per user
  conversationSummary: boolean;     // auto-summarise long chats
  
  // Voice
  voiceMode: boolean;               // real-time voice chat
}
```

> **No programmatic API.** API keys, scopes, and webhook delivery are out of product scope — every request is a first-party user session. See [Module 1 docs](Layer%202%20Modules/Module%201%20-%20Auth%20and%20Identity/01_OVERVIEW.md) for rationale.

### Example Plan → Feature Matrix

| Feature | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| webSearch | ✗ | ✓ | ✓ | ✓ |
| smartSynthesizer | ✗ | ✗ | ✓ | ✓ |
| deepResearch | ✗ | ✗ | ✓ | ✓ |
| fileUpload | ✗ | ✓ | ✓ | ✓ |
| documentCreation | ✗ | ✗ | ✓ | ✓ |
| codeExecution | ✗ | ✓ | ✓ | ✓ |
| htmlPreview | ✗ | ✓ | ✓ | ✓ |
| modelPicker | ✗ | ✗ | ✗ | ✓ |
| longTermMemory | ✗ | ✗ | ✓ | ✓ |
| voiceMode | ✗ | ✗ | ✓ | ✓ |

### Feature Check Middleware

```typescript
// Checks feature flag before reaching the route handler
export const requireFeature = (feature: keyof FeatureFlags) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { plan } = req.user;
    if (!plan.featureFlags[feature]) {
      return res.status(403).json({
        error: 'FEATURE_NOT_AVAILABLE',
        message: `${feature} is not available on your current plan`,
        upgradeUrl: '/pricing'
      });
    }
    next();
  };
};
```

### Feature-Level Usage Limits

Feature flags gate access as binary on/off. For expensive external-service features, an additional layer of **usage quotas** applies on top of the flag check. These are independent of the global rate-limit windows in Module 5.

```typescript
interface FeatureLimits {
  webSearch: {
    dailyLimit:   number | null;   // null = unlimited
    monthlyLimit: number | null;
  } | null;                        // null = feature not available on plan
  codeExecution: {
    hourlyLimit: number | null;
    dailyLimit:  number | null;
  } | null;
}
```

### Per-Plan Feature Quotas

| Feature | Window | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|---|
| webSearch | Daily | ✗ | 20 | 100 | Unlimited |
| webSearch | Monthly | ✗ | 200 | 1,000 | Unlimited |
| codeExecution | Hourly | ✗ | 10 | 50 | 200 |
| codeExecution | Daily | ✗ | 50 | 300 | Unlimited |

`null` in a limit field means unlimited. `null` for the entire feature object means the flag is off (Free plan).

### Redis Key Structure (Feature Counters)

Feature counters use simple INCR keys (not sorted sets) because only the count matters, not individual timestamps.

```
feature:websearch:daily:{user_id}    → INCR counter, TTL 86400s
feature:websearch:monthly:{user_id}  → INCR counter, TTL 2592000s
feature:codeexec:hourly:{user_id}    → INCR counter, TTL 3600s
feature:codeexec:daily:{user_id}     → INCR counter, TTL 86400s
```

### `requireFeatureWithLimit()` Middleware

**File:** `src/gateway/featureLimit.middleware.ts`

Replaces `requireFeature()` for webSearch and codeExecution routes. Checks binary flag first, then usage counter.

```typescript
export const requireFeatureWithLimit = (
  feature: 'webSearch' | 'codeExecution'
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { plan } = req.user;

    // 1. Binary feature flag check
    if (!plan.featureFlags[feature]) {
      return res.status(403).json({
        error: 'FEATURE_NOT_AVAILABLE',
        message: `${feature} is not available on your current plan`,
        upgradeUrl: '/pricing'
      });
    }

    // 2. Feature-level usage limit check
    const limits = plan.featureLimits?.[feature];
    if (limits) {
      const userId = req.user.id;
      const windows = feature === 'webSearch'
        ? [
            { key: `feature:websearch:daily:${userId}`,   limit: limits.dailyLimit,   ttl: 86400,   window: 'daily'   },
            { key: `feature:websearch:monthly:${userId}`,  limit: limits.monthlyLimit, ttl: 2592000, window: 'monthly' },
          ]
        : [
            { key: `feature:codeexec:hourly:${userId}`, limit: limits.hourlyLimit, ttl: 3600,  window: 'hourly' },
            { key: `feature:codeexec:daily:${userId}`,  limit: limits.dailyLimit,  ttl: 86400, window: 'daily'  },
          ];

      for (const w of windows) {
        if (w.limit === null) continue; // unlimited
        const used = parseInt(await redis.get(w.key) ?? '0', 10);
        if (used >= w.limit) {
          res.set(`X-Feature-${feature}-${w.window}-Limit`,     String(w.limit));
          res.set(`X-Feature-${feature}-${w.window}-Remaining`, '0');
          return res.status(429).json({
            error:      'FEATURE_LIMIT_EXCEEDED',
            feature,
            window:     w.window,
            limit:      w.limit,
            used,
            resetAt:    new Date(Date.now() + w.ttl * 1000).toISOString(),
            upgradeUrl: '/pricing'
          });
        }
      }

      // All windows passed — increment all counters
      const pipeline = redis.pipeline();
      for (const w of windows) {
        if (w.limit === null) continue;
        pipeline.incr(w.key);
        pipeline.expire(w.key, w.ttl);
      }
      await pipeline.exec();
    }

    next();
  };
};
```

### Error Response — 429 Feature Limit Exceeded

```json
{
  "error":      "FEATURE_LIMIT_EXCEEDED",
  "feature":    "webSearch",
  "window":     "daily",
  "limit":      20,
  "used":       20,
  "resetAt":    "2026-04-29T00:00:00Z",
  "upgradeUrl": "/pricing"
}
```

### Response Headers (Feature Usage)

```
X-Feature-WebSearch-Daily-Limit:       20
X-Feature-WebSearch-Daily-Remaining:   14
X-Feature-WebSearch-Monthly-Limit:     200
X-Feature-WebSearch-Monthly-Remaining: 194
X-Feature-CodeExec-Hourly-Limit:       10
X-Feature-CodeExec-Hourly-Remaining:   8
X-Feature-CodeExec-Daily-Limit:        50
X-Feature-CodeExec-Daily-Remaining:    47
```

---

## 6. Module 4 — Credit Wallet System

**Files:** `src/services/wallet.service.ts`, `src/services/creditCalculator.service.ts`

### Why Credits (Not Raw Tokens)

Raw API tokens are opaque to users and change when providers update pricing. A credit system:
- Abstracts pricing from provider costs (you control the exchange rate)
- Lets you tweak model costs without touching billing logic
- Supports top-up purchases and rollover natively
- Allows plan-level discounts (Pro users get 0.8× credit cost on all models)

### Credit Cost Formula

```
credits_deducted = ceil(
  (input_tokens + output_tokens) / 1000
  × model_credit_rate 
  × agent_multiplier 
  × plan_discount
)
```

### Model Credit Rates (per 1K tokens)

| Model Tier | Example Models | Credit Rate |
|---|---|---|
| Nano | Haiku 4.5, GPT-4o-mini, Gemini Flash Lite | 0.5× |
| Standard | Gemini Flash, Sonnet 4.6 | 1× |
| Premium | GPT-4o, Gemini Pro, Sonnet 4.6 (complex) | 2× |
| Frontier | Opus 4.7, GPT-4, Gemini Ultra | 5× |
| Reasoning | o1, Gemini 2.5 Pro (thinking) | 8× |

Admin can adjust these rates per model from the Admin Panel without code changes (stored in DB, cached in Redis).

### Agent Multipliers

| Agent | Multiplier | Reason |
|---|---|---|
| Chat (basic) | 1.0× | Simple conversation |
| Writer | 1.0× | Standard generation |
| Research Agent | 1.5× | Search overhead + synthesis |
| Code Assistant | 1.2× | Larger context typical |
| Deep Research | 2.0× | Multi-step, multiple search calls |
| Data Analyst | 1.3× | Code execution overhead |
| Document Agent | 1.2× | File parsing overhead |
| Architect | 1.5× | Large context, complex output |
| UI Generator | 1.3× | Long HTML/CSS output |

### Plan Discount

| Plan | Credit Discount |
|---|---|
| Free | 1.0× (no discount) |
| Starter | 0.95× |
| Pro | 0.85× |
| Enterprise | 0.70× |

### Wallet Object

```typescript
interface Wallet {
  id: string;
  userId: string;
  balance: number;              // current credits
  lifetimeEarned: number;       // total credits ever received
  lifetimeSpent: number;        // total credits ever spent
  
  transactions: WalletTransaction[];
}

interface WalletTransaction {
  id: string;
  walletId: string;
  type: 'grant' | 'deduct' | 'topup' | 'rollover' | 'refund' | 'adjustment';
  amount: number;               // positive = added, negative = deducted
  balance_after: number;
  
  // Context
  messageId: string | null;
  jobId: string | null;
  agentUsed: string | null;
  modelUsed: string | null;
  
  // Cost breakdown
  inputTokens: number | null;
  outputTokens: number | null;
  creditRate: number | null;
  agentMultiplier: number | null;
  planDiscount: number | null;
  
  description: string;
  createdAt: Date;
}
```

### Insufficient Credits Handling

```
If wallet.balance < estimated_cost:
  → return 402 Payment Required
  → include: { creditsNeeded, creditsAvailable, topupUrl }
  → do NOT consume any credits
  → do NOT call LLM
```

---

## 7. Module 5 — Rate Limiting (4-Tier)

**File:** `src/gateway/rateLimit.middleware.ts`

### Four Time Windows

Every request checks all four limits simultaneously. Failing any one blocks the request.

```typescript
interface RateLimitWindows {
  hourly:  { limit: number; window: 3600 };    // rolling 1hr
  daily:   { limit: number; window: 86400 };   // rolling 24hr
  weekly:  { limit: number; window: 604800 };  // rolling 7 days
  monthly: { limit: number; window: 2592000 }; // rolling 30 days
}
```

### Per-Plan Limits

| Window | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| Hourly | 10 req | 30 req | 100 req | 500 req |
| Daily | 50 req | 200 req | 1,000 req | 10,000 req |
| Weekly | 200 req | 1,000 req | 5,000 req | Unlimited |
| Monthly | 500 req | 3,000 req | 20,000 req | Unlimited |

### Redis Key Structure

```
ratelimit:hourly:{user_id}    → sorted set, sliding window, 3600s TTL
ratelimit:daily:{user_id}     → sorted set, sliding window, 86400s TTL
ratelimit:weekly:{user_id}    → sorted set, sliding window, 604800s TTL
ratelimit:monthly:{user_id}   → sorted set, sliding window, 2592000s TTL
ratelimit:cooldown:{user_id}  → simple key, 900s TTL (15-min block)
```

### Implementation (Sliding Window)

```typescript
async checkRateLimit(userId: string, plan: Plan): Promise<RateLimitResult> {
  const now = Date.now();
  const windows = [
    { key: 'hourly',   window: 3600,    limit: plan.limits.hourly },
    { key: 'daily',    window: 86400,   limit: plan.limits.daily },
    { key: 'weekly',   window: 604800,  limit: plan.limits.weekly },
    { key: 'monthly',  window: 2592000, limit: plan.limits.monthly },
  ];
  
  for (const w of windows) {
    const redisKey = `ratelimit:${w.key}:${userId}`;
    const windowStart = now - (w.window * 1000);
    
    // Remove expired entries, count current
    await redis.zremrangebyscore(redisKey, 0, windowStart);
    const count = await redis.zcard(redisKey);
    
    if (count >= w.limit) {
      return {
        allowed: false,
        limitType: w.key,
        limit: w.limit,
        remaining: 0,
        resetAt: new Date(now + (w.window * 1000))
      };
    }
  }
  
  // All windows passed — record this request in all windows
  const pipeline = redis.pipeline();
  for (const w of windows) {
    pipeline.zadd(`ratelimit:${w.key}:${userId}`, now, `${now}`);
    pipeline.expire(`ratelimit:${w.key}:${userId}`, w.window);
  }
  await pipeline.exec();
  
  return { allowed: true };
}
```

### Aggressive User Escalation

```
3 hourly limit hits in 10 minutes → 15-minute cooldown (ratelimit:cooldown:{user_id})
5 cooldowns in 24 hours           → flag for manual review (admin alert + user notified)
Cooldown response: 429 + Retry-After header + { reason, resetAt, upgradeUrl }
```

### Response Headers (on every request)

```
X-RateLimit-Hourly-Limit:     100
X-RateLimit-Hourly-Remaining: 87
X-RateLimit-Daily-Limit:      1000
X-RateLimit-Daily-Remaining:  943
X-RateLimit-Reset:            1714233600
```

### Feature-Level Limits vs Global Rate Limits

| Dimension | Global Rate Limits (this module) | Feature Usage Limits (Module 3) |
|---|---|---|
| What they count | ALL requests regardless of feature | Only webSearch or codeExecution calls |
| Key type | Redis sorted sets (sliding window) | Redis INCR counters (fixed TTL window) |
| Windows | Hourly · Daily · Weekly · Monthly | webSearch: Daily + Monthly; codeExec: Hourly + Daily |
| Trigger | Any request to any endpoint | Only routes guarded by `requireFeatureWithLimit()` |
| Error code | `RATE_LIMIT_EXCEEDED` (429) | `FEATURE_LIMIT_EXCEEDED` (429) |
| Purpose | Protect system capacity | Control per-feature external API costs |

A single request to a web-search endpoint checks **both** layers: global rate-limit windows (Module 5) are applied first; if those pass, the feature-level counter (Module 3) is checked next.

---

## 8. Module 6 — Usage Tracking & Analytics

**Files:** `src/services/usageTracker.service.ts`, `src/services/analytics.service.ts`

Implementation note (current): Module 6 `usage_records` rows for chat are written from **`src/workers/chat.worker.ts`** via `usageTracker.record()` (single writer per terminal job). `wallet.service.ts` does **not** insert usage rows; it only confirms or releases credit holds.

### What Gets Tracked (Per Message / Per Job)

```typescript
interface UsageRecord {
  id: string;
  
  // Identity
  userId: string;
  sessionId: string;               // conversation/session ID
  messageId: string;               // specific message ID
  jobId: string | null;            // BullMQ job ID (if queued)
  
  // Platform & Source
  platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
  clientVersion: string;           // app version
  ipAddress: string;               // hashed for privacy
  userAgent: string;
  
  // Agent & Model
  agentSlug: string;               // 'research', 'code', 'writer', etc.
  modelId: string;                 // 'claude-sonnet-4-6'
  modelProvider: string;           // 'anthropic' | 'openai' | 'google'
  
  // Token Usage (Actual LLM)
  inputTokensFresh: number;        // billed at full rate
  inputTokensCached: number;       // billed at discounted rate
  outputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  
  // Credit Usage (Wallet)
  creditsDeducted: number;
  creditRate: number;              // model rate at time of call
  agentMultiplier: number;
  planDiscount: number;
  walletBalanceBefore: number;
  walletBalanceAfter: number;
  
  // Cost (Actual USD to you)
  actualCostUsd: number;           // what you paid the provider
  
  // Features Used
  webSearchUsed: boolean;
  webSearchEngine: string | null;  // 'tavily' | 'brave'
  webSearchCount: number;          // usually 1; can be >1 for deep research
  fileUploadUsed: boolean;
  codeExecutionUsed: boolean;
  codeExecutionCount: number;      // number of Judge0 executions in this request
  voiceModeUsed: boolean;
  
  // Cache
  cacheHitLayer: 'semantic' | 'prompt' | 'none';
  semanticCacheHit: boolean;
  
  // Performance
  routerLatencyMs: number;         // time to classify intent
  llmFirstTokenMs: number;         // time to first streamed token
  llmTotalMs: number;              // total LLM response time
  totalRequestMs: number;          // wall clock, request to complete
  
  // Outcome
  status: 'success' | 'failed' | 'cancelled' | 'timeout';
  errorCode: string | null;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error' | null;
  
  createdAt: Date;
}
```

### Analytics Aggregates (Pre-computed, Redis + Postgres)

```
Per User (daily rollup):
  - total_requests, success_rate
  - total_credits_spent, total_tokens_used
  - top_agents_used, top_models_used
  - avg_response_time

Per Plan (daily rollup):
  - active_subscribers, churn_rate
  - avg_credits_consumed_per_user
  - feature_usage_breakdown

System-wide (hourly rollup):
  - cache_hit_rate (semantic + prompt)
  - provider_success_rate per provider
  - p50/p95/p99 latency
  - cost_per_request by model
```

---

## 9. Module 7 — Message Queue System

**Files:** `src/queues/chat.queue.ts`, `src/workers/chat.worker.ts`

### Why a Queue

- User sends a message and closes the tab → job continues in background
- Prevents HTTP timeout on long-running operations (deep research, large file analysis)
- Enables retry on failure without user re-sending
- Decouples request acceptance from processing

### Flow

```
1. User sends POST /chat
2. Gateway validates (auth + plan + flags + rate limit + credits)
3. Optimistic credit hold: wallet.pending += estimated_cost
4. Job enqueued to BullMQ: { userId, conversationId, message, options }
5. Response immediately returned: { jobId, status: 'queued' }
6. Client subscribes to SSE: GET /chat/stream/{jobId}
7. Worker picks up job, processes, streams tokens via SSE
8. On completion: confirm credit deduction, resolve pending hold
9. On failure: release credit hold, mark job failed, notify client via SSE
```

### Job Object

```typescript
interface ChatJob {
  jobId: string;
  userId: string;
  conversationId: string;
  messageId: string;             // pre-created message record
  
  payload: {
    content: string;
    attachedFileIds: string[];
    agentSlug: string | null;    // null = auto-route
    modelId: string | null;      // null = auto-select
    options: ChatOptions;
  };
  
  status: 'queued' | 'processing' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  attempts: number;              // current attempt
  maxAttempts: number;           // 3 for most, 1 for code execution
  
  result: {
    content: string | null;
    tokensUsed: TokenUsage | null;
    creditsDeducted: number | null;
    artifactIds: string[];
  };
  
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}
```

### SSE Stream Contract

```
Client connects to: GET /chat/stream/{jobId}

Events emitted:
  { event: 'queued',         data: { position: 3 } }
  { event: 'processing',     data: { agentUsed, modelUsed } }
  { event: 'status',         data: { phase: 'web_search_searching' } }
  { event: 'chunk',          data: { content: '...' } }
  { event: 'artifact',       data: { artifactId, type, title } }
  { event: 'usage',          data: { tokensUsed, creditsDeducted } }
  { event: 'done',           data: { messageId, conversationId } }
  { event: 'error',          data: { code, message } }
  { event: 'heartbeat',      data: {} }   ← every 15s to prevent timeout
```

### Background Completion

If user is offline when job completes:
- Result stored in DB (message record updated)
- `usage` event stored as notification: `notifications:{user_id}`
- Next time user opens app, they receive a `you_have_unread` push via SSE
- Conversation shows completed message with all artifacts

---

## 10. Module 8 — Conversation & Message Structure

**Files:** `src/services/conversation.service.ts`, `src/services/message.service.ts`

### Conversation Object

```typescript
interface Conversation {
  id: string;
  userId: string;
  
  title: string;                     // auto-generated or user-set
  titleGeneratedAt: Date | null;     // null = user-set title
  
  // Attached Files (conversation-level, accessible to all messages)
  attachedFiles: ConversationFile[];
  
  // Agent & Model defaults for this conversation
  defaultAgentSlug: string | null;   // null = auto-route each message
  defaultModelId: string | null;     // null = auto-select
  
  // Context Management
  totalTokensUsed: number;           // running total for this conversation
  messageCount: number;
  summarisedUpToMessageId: string | null;  // context compaction marker
  summaryText: string | null;        // the compacted summary
  
  // Status
  status: 'active' | 'archived';
  pinnedAt: Date | null;
  
  // Tags & Metadata
  tags: string[];
  platform: 'web' | 'admin' | 'mobile-ios' | 'mobile-android';
  
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}
```

### Message Object

```typescript
interface Message {
  id: string;
  conversationId: string;
  userId: string;
  
  role: 'user' | 'assistant' | 'system';
  content: string;                    // full text content
  
  // Attached Resources (on this specific message)
  attachedFiles: MessageFile[];       // files user uploaded with this message
  generatedArtifacts: Artifact[];     // artifacts created in response to this message
  
  // Feature Tags (what was used to generate this response)
  featuresUsed: {
    webSearch: boolean;
    webSearchEngine: string | null;
    fileAnalysis: boolean;
    codeExecution: boolean;
    voiceMode: boolean;
    agentSlug: string;
    modelId: string;
    modelProvider: string;
  };
  
  // Token & Credit Usage
  inputTokens: number;
  outputTokens: number;
  creditsDeducted: number;
  
  // Search Citations (if web search was used)
  citations: Citation[];
  
  // Performance
  latencyMs: number;
  
  // Status
  status: 'pending' | 'streaming' | 'complete' | 'error';
  jobId: string | null;              // linked BullMQ job
  errorMessage: string | null;
  
  // Summarisation flag
  isIncludedInSummary: boolean;      // true = this msg was compacted into summary
  
  createdAt: Date;
  updatedAt: Date;
}
```

### File Attachment Object

```typescript
interface MessageFile {
  id: string;
  messageId: string | null;          // null = conversation-level file
  conversationId: string;
  userId: string;
  
  fileName: string;
  fileType: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'png' | 'jpg' | 'mp4';
  fileSize: number;                  // bytes
  storagePath: string;               // local path or R2 key
  
  processingStatus: 'pending' | 'processing' | 'ready' | 'failed';
  extractedText: string | null;      // parsed content (stored in DB for small files)
  vectorised: boolean;               // true = embedded in Qdrant
  
  uploadedAt: Date;
}
```

### Long Conversation Handling

```
Token threshold check (on every message send):
  totalTokensUsed > 60% of model context window
    → Notify user: "Your conversation is getting long. Consider starting a new chat or summarising."
    → Show button: [Summarise & Continue] [Start New Chat]

  totalTokensUsed > 85% of model context window
    → Auto-summarise oldest messages (rolling compaction)
    → summaryText stored in conversation record
    → summarisedUpToMessageId updated
    → User notified: "Older messages have been summarised to continue the conversation."

Summarisation call:
  model: cheapest available (Haiku / Flash Lite)
  prompt: "Summarise this conversation in 300 words, preserving key decisions, code snippets referenced, and user preferences."
```

### Conversation List Response (for sidebar)

```typescript
interface ConversationListItem {
  id: string;
  title: string;
  lastMessagePreview: string;        // first 120 chars of last message
  lastMessageAt: Date;
  messageCount: number;
  totalCreditsSpent: number;
  attachedFilesCount: number;
  hasArtifacts: boolean;
  agentUsed: string | null;
  status: 'active' | 'archived';
  pinnedAt: Date | null;
}
```

---

## 11. Module 9 — Request Sanitiser & Validation

**File:** `src/gateway/sanitiser.middleware.ts`

| Check | Detail |
|---|---|
| Schema Validation | Zod schemas on all request bodies — fail fast with descriptive errors |
| Prompt Injection | Strip known injection patterns (`ignore previous instructions`, `jailbreak`, `DAN mode`, etc.) |
| Message Length | Enforce max chars per message (Free: 2K, Pro: 10K, Enterprise: 50K) |
| File Type Whitelist | Only allow: PDF, DOCX, XLSX, CSV, TXT, PNG, JPG, MP4 |
| File Size | Enforce plan limit (Free: blocked, Starter: 5MB, Pro: 10MB, Enterprise: 100MB) |
| HTML Sanitisation | Strip `<script>`, event handlers from any HTML input |
| SQL Injection Guard | Parameterised queries only — this is a reminder, not runtime check |
| Rate Abuse Signals | Detect repeated identical messages (bot-like behaviour) → flag |
| Content Policy | Basic keyword filter for policy violations before hitting LLM |

---

## 12. Module 10 — Smart Router

**Files:** `src/router/classifier.ts`, `src/router/modelSelector.ts`, `src/router/agentDispatcher.ts`, `src/router/queryRewriter.ts`

### Classification

```typescript
interface ClassificationResult {
  intent: 'search' | 'code' | 'write' | 'analyse' | 'design' | 'debug' | 'ui' | 'chat' | 'document';
  complexity: 'simple' | 'medium' | 'complex';
  needsWebSearch: boolean;
  needsCodeExecution: boolean;
  needsFileRead: boolean;
  needsFileGen: string[];           // ['excel', 'markdown', 'docx']
  searchContextSize: 'low' | 'medium' | 'high';
  suggestedAgent: string;
  confidence: number;               // 0–1
}
```

### Model Selection

```
simple   → Haiku 4.5 / GPT-4o-mini / Gemini Flash Lite
medium   → Sonnet 4.6 / GPT-4o / Gemini Pro
complex  → Opus 4.7 / GPT-4 / Gemini Ultra
```

Router selects the cheapest model within user's plan `modelAccess` list that can handle the complexity. Falls back to next available if preferred provider is unhealthy.

### Agent Selection (based on plan `agentAccess`)

```
intent: search    → ResearchAgent (if allowed) else ChatAgent
intent: code      → CodeAgent (if allowed) else ChatAgent
intent: write     → WriterAgent
intent: analyse   → AnalystAgent (if allowed) else ChatAgent
intent: design    → ArchitectAgent (if allowed) else ChatAgent
intent: debug     → DebuggerAgent (if allowed) else CodeAgent
intent: ui        → UIAgent (if allowed) else CodeAgent
intent: document  → DocumentAgent (if allowed) else WriterAgent
intent: chat      → ChatAgent
```

---

## 13. Module 11 — User API

Base path: `/api/v1/`

All routes require valid JWT. Feature-gated routes additionally check plan flags.

### Auth

> Detailed contracts: [`docs/Layer 2 Modules/Module 1 - Auth and Identity/05_USER_API_CONTRACTS.md`](Layer%202%20Modules/Module%201%20-%20Auth%20and%20Identity/05_USER_API_CONTRACTS.md). 18 endpoints in total.

```
POST   /auth/check-email          → frontend routing decision (login / google / register)
POST   /auth/register             → create account
POST   /auth/login                → issue tokens
POST   /auth/google               → sign in OR sign up via Google ID token
POST   /auth/google/link          → link Google to existing account (authed)
DELETE /auth/google/link          → unlink Google
POST   /auth/refresh              → rotate access + refresh (reuse-detected)
POST   /auth/logout               → revoke this device
POST   /auth/logout-all           → revoke every device
GET    /auth/me                   → current user (incl. linked_providers)
PATCH  /auth/me                   → update name / bio / avatar / locale / timezone
POST   /auth/password/change      → requires current password
POST   /auth/password/forgot      → silent send reset email
POST   /auth/password/reset       → complete reset
POST   /auth/email/verify/request → send verification email
POST   /auth/email/verify/confirm → confirm with token
GET    /auth/sessions             → list signed-in devices (multi-device)
DELETE /auth/sessions/:id         → revoke one device
```

### Conversations

```
GET    /conversations             → list user's conversations (paginated)
POST   /conversations             → create new conversation
GET    /conversations/:id         → get conversation with messages
PATCH  /conversations/:id         → update title / pin / archive
DELETE /conversations/:id         → soft delete
POST   /conversations/:id/summarise → manual summarise trigger
```

### Chat / Messages

```
POST   /chat                      → send message (returns jobId)
GET    /chat/stream/:jobId         → SSE stream for job result
GET    /chat/job/:jobId            → polling snapshot for networks without SSE
POST   /chat/:conversationId/cancel → cancel a running job
GET    /conversations/:id/messages → paginated message history
```

### Files

```
POST   /files/upload              → upload file (returns fileId)
GET    /files/:id/status          → processing status
DELETE /files/:id                 → delete file
```

### Artifacts

```
GET    /artifacts                 → list user's artifacts
GET    /artifacts/:id             → get artifact content
GET    /artifacts/:id/versions    → version history
POST   /artifacts/:id/fork        → create new version
DELETE /artifacts/:id             → delete artifact
```

### Wallet & Subscription

```
GET    /wallet                    → current balance + recent transactions
GET    /wallet/transactions       → full transaction history (paginated)
GET    /wallet/transactions/:id   → transaction detail by id (owner-only)
POST   /wallet/topup              → purchase credit top-up
GET    /subscription              → current subscription details
POST   /subscription/upgrade      → upgrade plan
POST   /subscription/cancel       → cancel at period end
GET    /plans                     → list available public plans
```

### Usage

```
GET    /usage/summary             → credits used, requests made (current period)
GET    /usage/history             → per-day usage breakdown
```

---

## 14. Module 12 — Admin API

Base path: `/api/v1/admin/`

All routes require `requireAdmin` middleware. Superadmin-only routes marked with `[SA]`.

### User Management

```
GET    /admin/users               → list users (search, filter by plan, status)
GET    /admin/users/:id           → user detail (profile + subscription + usage)
PATCH  /admin/users/:id           → update role, ban/unban
POST   /admin/users/:id/wallet    → manual credit adjustment (add/deduct) with reason
GET    /admin/wallets             → list wallets with filters for support/finance
POST   /admin/users/:id/plan      → force plan change
GET    /admin/users/:id/usage     → full usage history for a user
GET    /admin/users/:id/conversations → view user's conversations (support access)
```

### Plan Management

```
GET    /admin/plans               → list all plans (including archived)
POST   /admin/plans               → create new plan
PATCH  /admin/plans/:id           → update plan (non-breaking fields only)
POST   /admin/plans/:id/archive   → archive plan (no new signups)
POST   /admin/plans/:id/publish   → make plan public on pricing page
GET    /admin/plans/:id/subscribers → users currently on this plan
```

### Subscription Management

```
GET    /admin/subscriptions       → list all active subscriptions
GET    /admin/subscriptions/:id   → subscription detail
PATCH  /admin/subscriptions/:id   → extend period, change status, adjust credits
```

### Model & Agent Configuration

```
GET    /admin/models              → list all models with rates + status
POST   /admin/models              → register new model
PATCH  /admin/models/:id          → update credit rate, toggle active, health override
GET    /admin/agents              → list all agents
PATCH  /admin/agents/:id          → update system prompt, multiplier, model defaults [SA]
POST   /admin/agents/:id/test     → test agent with a sample query
```

### Analytics & Cost Dashboard

```
GET    /admin/analytics/overview       → requests, credits, revenue, cache hit rate
GET    /admin/analytics/users          → top users by usage / spend
GET    /admin/analytics/models         → model usage distribution
GET    /admin/analytics/costs          → actual USD costs vs credits charged
GET    /admin/analytics/errors         → error rates by type / provider
GET    /admin/analytics/ratelimits     → rate limit events, cooldown events
```

### System Configuration

```
GET    /admin/system/health            → Postgres, Redis, BullMQ, providers health
GET    /admin/system/queues            → BullMQ queue depths, active/failed jobs
POST   /admin/system/queues/:name/retry-failed → retry all failed jobs
GET    /admin/system/cache             → Redis memory, cache hit stats
POST   /admin/system/cache/flush       → flush semantic cache [SA]
GET    /admin/system/providers         → provider health + API key status
PATCH  /admin/system/providers/:id     → update API key, toggle active [SA]
```

### Rate Limit Management

```
GET    /admin/ratelimits/events        → recent rate limit hits + cooldowns
POST   /admin/ratelimits/:userId/clear → clear all rate limit windows for a user
POST   /admin/ratelimits/:userId/cooldown → manually apply / remove cooldown
GET    /admin/ratelimits/flagged       → users flagged for manual review
PATCH  /admin/ratelimits/flagged/:userId → resolve flag (whitelist / ban)
```

---

## 15. Database Schema

### Core Tables

```sql
-- Users (identity + profile + auth state)
-- Full DDL incl. indexes lives in: docs/Layer 2 Modules/Module 1 - Auth and Identity/03_DATABASE_SCHEMA.md
users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT UNIQUE NOT NULL,
  email_normalised         TEXT UNIQUE NOT NULL,         -- lowercased + trimmed
  password_hash            TEXT,                          -- argon2id; null = Google-only signup
  role                     TEXT NOT NULL DEFAULT 'user',  -- user | admin | superadmin
  status                   TEXT NOT NULL DEFAULT 'active',-- active | banned | suspended
  -- Profile (user-editable)
  name                     TEXT NOT NULL,
  bio                      TEXT,
  avatar_url               TEXT,
  locale                   TEXT,
  timezone                 TEXT,
  -- Source / multi-platform
  registration_platform    TEXT NOT NULL DEFAULT 'web',
  -- Auth state
  email_verified_at        TIMESTAMPTZ,
  password_changed_at      TIMESTAMPTZ,
  failed_login_attempts    INT NOT NULL DEFAULT 0,
  locked_until             TIMESTAMPTZ,
  mfa_secret               TEXT,
  mfa_enabled              BOOLEAN NOT NULL DEFAULT false,
  last_login_at            TIMESTAMPTZ,
  last_login_ip            INET,
  banned_at                TIMESTAMPTZ,
  banned_by                UUID REFERENCES users(id),
  ban_reason               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Linked OAuth Identities (Google today; Apple/GitHub later)
oauth_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,                    -- 'google'
  provider_user_id    TEXT NOT NULL,                    -- Google `sub`
  provider_email      TEXT NOT NULL,
  email_verified      BOOLEAN NOT NULL,
  raw_profile         JSONB NOT NULL DEFAULT '{}',
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ,
  UNIQUE (provider, provider_user_id)
);

-- Refresh Tokens (one row = one signed-in device; multi-device aware)
refresh_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,               -- SHA-256
  family_id         UUID NOT NULL,                       -- reuse-detection group
  platform          TEXT NOT NULL,                       -- web | admin | mobile-ios | mobile-android
  device_name       TEXT,
  device_type       TEXT,
  os                TEXT,
  browser           TEXT,
  app_version       TEXT,
  fingerprint       TEXT,
  ip                INET,
  user_agent        TEXT,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT,                                -- logout | rotated | reuse_detected | admin | ban
  replaced_by_id    UUID REFERENCES refresh_tokens(id),
  last_used_at      TIMESTAMPTZ
);

-- Access-token Blacklist (Postgres mirror of Redis)
token_blacklist (
  jti          TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  reason       TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth Audit (append-only)
auth_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),               -- nullable: failed login of unknown email
  actor_id      UUID REFERENCES users(id),               -- admin who performed the action
  event_type    TEXT NOT NULL,
  ip            INET,
  user_agent    TEXT,
  fingerprint   TEXT,
  success       BOOLEAN NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-use email tokens
password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,                    -- +30 min
  used_at      TIMESTAMPTZ,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
email_verification_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,                    -- +24 h
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plans
plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  status          TEXT DEFAULT 'active',        -- active | archived
  is_public       BOOLEAN DEFAULT false,
  is_introductory BOOLEAN DEFAULT false,
  pricing_monthly INT NOT NULL,                -- USD cents
  pricing_annual  INT NOT NULL,                -- USD cents/month billed annually
  credits_included INT NOT NULL,
  credits_rollover BOOLEAN DEFAULT false,
  credits_max_rollover INT,                    -- null = unlimited
  credits_topup_enabled BOOLEAN DEFAULT false,
  limits_hourly   INT NOT NULL,
  limits_daily    INT NOT NULL,
  limits_weekly   INT NOT NULL,
  limits_monthly  INT NOT NULL,
  limits_max_context_messages INT DEFAULT 20,
  limits_max_file_size BIGINT DEFAULT 0,
  model_access    TEXT[],                      -- array of model IDs
  agent_access    TEXT[],                      -- array of agent slugs
  feature_flags   JSONB NOT NULL DEFAULT '{}',
  feature_limits  JSONB NOT NULL DEFAULT '{}',  -- per-feature quotas; null value on a key = unlimited
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  archived_at     TIMESTAMPTZ
);

-- Subscriptions
subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID UNIQUE REFERENCES users(id),
  plan_id               UUID REFERENCES plans(id),
  plan_snapshot         JSONB NOT NULL,         -- frozen copy at subscribe time
  billing_cycle         TEXT DEFAULT 'monthly', -- monthly | annual
  status                TEXT DEFAULT 'active',  -- active | past_due | cancelled | paused
  current_period_start  TIMESTAMPTZ NOT NULL,
  current_period_end    TIMESTAMPTZ NOT NULL,
  cancel_at_period_end  BOOLEAN DEFAULT false,
  credits_granted       INT NOT NULL,
  credits_rolled_over   INT DEFAULT 0,
  stripe_subscription_id TEXT,
  stripe_customer_id    TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Credit Wallets
wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE REFERENCES users(id),
  balance         INT NOT NULL DEFAULT 0,
  pending         INT NOT NULL DEFAULT 0,       -- held for in-flight jobs
  lifetime_earned INT NOT NULL DEFAULT 0,
  lifetime_spent  INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Wallet Transactions
wallet_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id           UUID REFERENCES wallets(id),
  type                TEXT NOT NULL,            -- grant | deduct | topup | rollover | refund | adjustment
  amount              INT NOT NULL,             -- positive or negative
  balance_after       INT NOT NULL,
  message_id          UUID,
  job_id              TEXT,
  agent_slug          TEXT,
  model_id            TEXT,
  input_tokens        INT,
  output_tokens       INT,
  credit_rate         NUMERIC,
  agent_multiplier    NUMERIC,
  plan_discount       NUMERIC,
  description         TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Conversations
conversations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID REFERENCES users(id),
  title                     TEXT NOT NULL DEFAULT 'New Conversation',
  title_generated_at        TIMESTAMPTZ,
  default_agent_slug        TEXT,
  default_model_id          TEXT,
  total_tokens_used         INT DEFAULT 0,
  message_count             INT DEFAULT 0,
  summarised_up_to_msg_id   UUID,
  summary_text              TEXT,
  status                    TEXT DEFAULT 'active',  -- active | archived
  pinned_at                 TIMESTAMPTZ,
  tags                      TEXT[],
  platform                  TEXT DEFAULT 'web',
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  last_message_at           TIMESTAMPTZ
);

-- Messages
messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations(id),
  user_id           UUID REFERENCES users(id),
  role              TEXT NOT NULL,              -- user | assistant | system
  content           TEXT NOT NULL,
  input_tokens      INT DEFAULT 0,
  output_tokens     INT DEFAULT 0,
  credits_deducted  INT DEFAULT 0,
  agent_slug        TEXT,
  model_id          TEXT,
  model_provider    TEXT,
  web_search_used   BOOLEAN DEFAULT false,
  code_execution_used BOOLEAN DEFAULT false,
  file_analysis_used BOOLEAN DEFAULT false,
  voice_mode_used   BOOLEAN DEFAULT false,
  citations         JSONB DEFAULT '[]',
  latency_ms        INT,
  status            TEXT DEFAULT 'complete',   -- pending | streaming | complete | error
  job_id            TEXT,
  error_message     TEXT,
  is_included_in_summary BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Files
files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id),
  conversation_id   UUID REFERENCES conversations(id),
  message_id        UUID REFERENCES messages(id),  -- null = conversation-level
  file_name         TEXT NOT NULL,
  file_type         TEXT NOT NULL,
  file_size         BIGINT NOT NULL,
  storage_path      TEXT NOT NULL,
  processing_status TEXT DEFAULT 'pending',
  extracted_text    TEXT,
  vectorised        BOOLEAN DEFAULT false,
  uploaded_at       TIMESTAMPTZ DEFAULT now()
);

-- Artifacts
artifacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id),
  conversation_id     UUID REFERENCES conversations(id),
  message_id          UUID REFERENCES messages(id),
  title               TEXT NOT NULL,
  type                TEXT NOT NULL,            -- code | html | markdown | excel | csv | docx | image | chart
  parent_id           UUID REFERENCES artifacts(id),
  version_number      INT DEFAULT 1,
  content_hash        TEXT,
  storage_path        TEXT,
  content_text        TEXT,
  file_size           BIGINT,                 -- byte length; NULL for legacy rows
  created_by_agent    TEXT,
  is_latest           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Usage Records
usage_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES users(id),
  conversation_id       UUID REFERENCES conversations(id),
  message_id            UUID REFERENCES messages(id),
  job_id                TEXT,
  platform              TEXT,
  agent_slug            TEXT,
  model_id              TEXT,
  model_provider        TEXT,
  input_tokens_fresh    INT DEFAULT 0,
  input_tokens_cached   INT DEFAULT 0,
  output_tokens         INT DEFAULT 0,
  cache_write_tokens    INT DEFAULT 0,
  credits_deducted      INT DEFAULT 0,
  credit_rate           NUMERIC,
  agent_multiplier      NUMERIC,
  plan_discount         NUMERIC,
  actual_cost_usd       NUMERIC,
  cache_hit_layer       TEXT,
  web_search_used       BOOLEAN DEFAULT false,
  code_execution_used   BOOLEAN DEFAULT false,
  web_search_count      INT DEFAULT 0,
  code_execution_count  INT DEFAULT 0,
  router_latency_ms     INT,
  llm_first_token_ms    INT,
  llm_total_ms          INT,
  total_request_ms      INT,
  status                TEXT DEFAULT 'success',
  error_code            TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Rate Limit Events (audit)
rate_limit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  event_type  TEXT NOT NULL,                    -- hit | cooldown | flagged | cleared
  limit_type  TEXT,                             -- hourly | daily | weekly | monthly | feature_websearch_daily | feature_websearch_monthly | feature_codeexec_hourly | feature_codeexec_daily
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- AI Models (admin-managed)
ai_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        TEXT UNIQUE NOT NULL,         -- 'claude-sonnet-4-6'
  display_name    TEXT NOT NULL,
  provider        TEXT NOT NULL,                -- 'anthropic' | 'openai' | 'google'
  tier            TEXT NOT NULL,                -- 'nano' | 'standard' | 'premium' | 'frontier' | 'reasoning'
  credit_rate     NUMERIC NOT NULL,             -- credits per 1K tokens
  is_active       BOOLEAN DEFAULT true,
  health_status   TEXT DEFAULT 'healthy',       -- healthy | degraded | down
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Agents (admin-managed)
agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  display_name    TEXT NOT NULL,
  description     TEXT,
  system_prompt   TEXT NOT NULL,               -- editable from admin panel
  default_model_id TEXT,
  agent_multiplier NUMERIC DEFAULT 1.0,
  allowed_features TEXT[],
  is_active       BOOLEAN DEFAULT true,
  updated_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## 16. Folder Structure

```
src/
├── index.ts                           ← Express app entry
│
├── config/
│   ├── env.ts                         ← Zod-validated env vars
│   ├── models.ts                      ← Model map per provider + tier
│   ├── plans.ts                       ← Default capability matrix (overridden by DB)
│   └── features.ts                    ← Feature flag definitions + defaults
│
├── gateway/                           ← Middleware pipeline (runs in order)
│   ├── auth.middleware.ts             ← JWT verify, user load
│   ├── admin.middleware.ts            ← requireAdmin / requireSuperadmin
│   ├── plan.middleware.ts             ← Plan load + capability attach
│   ├── featureFlag.middleware.ts      ← Feature gate check
│   ├── featureLimit.middleware.ts     ← Per-feature usage quota check (webSearch · codeExecution)
│   ├── rateLimit.middleware.ts        ← 4-window sliding rate limit
│   ├── creditBudget.middleware.ts     ← Wallet balance check + hold
│   └── sanitiser.middleware.ts        ← Input validation, injection strip
│
├── router/
│   ├── classifier.ts                  ← Intent + complexity classification
│   ├── modelSelector.ts               ← Complexity → model tier mapping
│   ├── agentDispatcher.ts             ← Intent → agent (plan-gated)
│   └── queryRewriter.ts               ← Search query expansion
│
├── agents/
│   ├── base.agent.ts                  ← Abstract agent class + loop
│   ├── chat.agent.ts
│   ├── writer.agent.ts
│   ├── research.agent.ts
│   ├── code.agent.ts
│   ├── document.agent.ts
│   ├── analyst.agent.ts
│   ├── architect.agent.ts
│   ├── debugger.agent.ts
│   └── ui.agent.ts
│
├── tools/
│   ├── base.tool.ts
│   ├── webSearch.tool.ts
│   ├── webFetch.tool.ts
│   ├── fileRead.tool.ts
│   ├── fileGenerate.tool.ts
│   ├── htmlGenerate.tool.ts
│   ├── codeExecute.tool.ts
│   ├── chartGenerate.tool.ts
│   └── imageAnalyse.tool.ts
│
├── queues/
│   ├── chat.queue.ts                  ← BullMQ queue definition
│   ├── file.queue.ts                  ← File processing queue
│   └── notification.queue.ts         ← Async notification queue
│
├── workers/
│   ├── chat.worker.ts                 ← Processes chat jobs
│   ├── file.worker.ts                 ← Parses + vectorises uploaded files
│   └── notification.worker.ts        ← Sends completion notifications
│
├── services/
│   ├── auth.service.ts
│   ├── token.service.ts
│   ├── password.service.ts
│   ├── oauth.service.ts               ← Google ID-token verify · sign-in / sign-up / link
│   ├── profile.service.ts             ← name / bio / avatar / locale / timezone
│   ├── session.service.ts             ← multi-device refresh-token CRUD
│   ├── audit.service.ts               ← auth_audit append-only writer
│   ├── plan.service.ts
│   ├── subscription.service.ts
│   ├── wallet.service.ts
│   ├── creditCalculator.service.ts
│   ├── conversation.service.ts
│   ├── message.service.ts
│   ├── file.service.ts
│   ├── artifact.service.ts
│   ├── usageTracker.service.ts
│   ├── analytics.service.ts
│   └── notification.service.ts
│
├── models/
│   ├── provider.ts                    ← Unified LLM caller
│   ├── anthropic.ts
│   ├── openai.ts
│   ├── google.ts
│   └── streaming.ts                  ← SSE stream handler
│
├── prompt/
│   ├── assembler.ts
│   ├── cacheManager.ts
│   ├── compactor.ts
│   └── systemPrompts/
│       ├── chat.prompt.ts
│       ├── writer.prompt.ts
│       ├── research.prompt.ts
│       └── ...
│
├── memory/
│   ├── session.memory.ts
│   ├── vector.memory.ts
│   └── semantic.cache.ts
│
├── db/
│   ├── postgres.ts
│   ├── redis.ts
│   ├── qdrant.ts
│   └── migrations/
│
├── routes/
│   ├── user/
│   │   ├── auth.routes.ts
│   │   ├── chat.routes.ts
│   │   ├── conversation.routes.ts
│   │   ├── file.routes.ts
│   │   ├── artifact.routes.ts
│   │   ├── wallet.routes.ts
│   │   └── usage.routes.ts
│   └── admin/
│       ├── users.routes.ts
│       ├── plans.routes.ts
│       ├── subscriptions.routes.ts
│       ├── models.routes.ts
│       ├── agents.routes.ts
│       ├── analytics.routes.ts
│       ├── ratelimits.routes.ts
│       └── system.routes.ts
│
├── execution/
│   └── judge0.service.ts
│
├── costs/
│   ├── tracker.ts
│   └── calculator.ts
│
└── utils/
    ├── errors.ts
    ├── logger.ts
    └── pagination.ts
```

---

## 17. API Endpoint Reference

### User API (`/api/v1/`)

| Method | Path | Auth | Plan Gate | Description |
|---|---|---|---|---|
| POST | /auth/check-email | — | — | Pre-flight: tells the frontend whether to show login / "Continue with Google" / signup |
| POST | /auth/register | — | — | Create account (email + password) |
| POST | /auth/login | — | — | Get tokens (email + password) |
| POST | /auth/google | — | — | Sign in OR sign up via Google ID token (3 outcomes) |
| POST | /auth/google/link | JWT | — | Link Google to current account |
| DELETE | /auth/google/link | JWT | — | Unlink Google (refused if it's the only sign-in method) |
| POST | /auth/refresh | — | — | Rotate access + refresh; family-based reuse detection |
| POST | /auth/logout | JWT | — | Revoke this device's session |
| POST | /auth/logout-all | JWT | — | Revoke every device |
| GET | /auth/me | JWT | — | My profile (incl. linked_providers, has_password) |
| PATCH | /auth/me | JWT | — | Edit name / bio / avatar / locale / timezone |
| POST | /auth/password/change | JWT | — | Change password (revokes all other sessions) |
| POST | /auth/password/forgot | — | — | Send reset email (silent — never leaks existence) |
| POST | /auth/password/reset | — | — | Complete reset with token |
| POST | /auth/email/verify/request | JWT | — | Send verification email |
| POST | /auth/email/verify/confirm | — | — | Confirm email with token |
| GET | /auth/sessions | JWT | — | List signed-in devices (multi-device) |
| DELETE | /auth/sessions/:id | JWT | — | Revoke a specific device |
| GET | /conversations | JWT | — | List conversations |
| POST | /conversations | JWT | — | New conversation |
| GET | /conversations/:id | JWT | — | Conversation + messages |
| PATCH | /conversations/:id | JWT | — | Update title / pin |
| DELETE | /conversations/:id | JWT | — | Archive conversation |
| POST | /chat | JWT | — | Send message → returns jobId |
| GET | /chat/stream/:jobId | JWT | — | SSE stream |
| GET | /chat/job/:jobId | JWT | — | Job status snapshot |
| POST | /chat/:convId/cancel | JWT | — | Cancel running job |
| POST | /files/upload | JWT | fileUpload | Upload file |
| GET | /files/:id/status | JWT | — | Processing status |
| GET | /artifacts | JWT | — | List artifacts |
| GET | /artifacts/:id | JWT | — | Artifact content |
| GET | /artifacts/:id/versions | JWT | artifactVersioning | Version history |
| GET | /wallet | JWT | — | Balance + transactions |
| GET | /wallet/transactions | JWT | — | Transaction history |
| GET | /wallet/transactions/:id | JWT | — | Transaction detail |
| POST | /wallet/topup | JWT | — | Buy credits |
| GET | /subscription | JWT | — | Current subscription |
| POST | /subscription/upgrade | JWT | — | Upgrade plan |
| GET | /plans | — | — | Public plan list |
| GET | /usage/summary | JWT | — | Current period usage |

### Admin API (`/api/v1/admin/`)

| Method | Path | Role | Description |
|---|---|---|---|
| GET | /admin/auth/users | admin | List all users (search, filter by role / status / created-at) |
| GET | /admin/auth/users/:id | admin | Identity record + active sessions + recent audit |
| PATCH | /admin/auth/users/:id | admin | Edit name / bio / avatar / status (role change → superadmin) |
| POST | /admin/auth/users/:id/ban | admin | Ban user (cascades: revoke sessions + blacklist JTIs) |
| POST | /admin/auth/users/:id/unban | admin | Unban (sessions are NOT restored) |
| POST | /admin/auth/users/:id/force-logout | admin | Revoke every session of a user |
| POST | /admin/auth/users/:id/reset-password | admin | Admin-initiated password reset |
| POST | /admin/auth/users/:id/impersonate | superadmin | Issue a 5-min impersonation JWT (audited per request) |
| GET | /admin/auth/audit | admin | Paginated audit log (filter by user / actor / event / date) |
| GET | /admin/auth/sessions | admin | System-wide active sessions (filter by user / platform / IP) |
| DELETE | /admin/auth/sessions/:id | admin | Revoke any session by id |
| GET | /admin/users/:id | admin | (legacy alias — use /admin/auth/users/:id) |
| POST | /admin/users/:id/wallet | admin | Adjust credits manually |
| GET | /admin/wallets | admin | List wallets with filters |
| GET | /admin/plans | admin | All plans (incl. archived) |
| POST | /admin/plans | admin | Create plan |
| PATCH | /admin/plans/:id | admin | Update plan fields |
| POST | /admin/plans/:id/archive | admin | Archive plan |
| GET | /admin/models | admin | Model registry |
| PATCH | /admin/models/:id | admin | Update rate / toggle |
| GET | /admin/agents | admin | Agent list |
| PATCH | /admin/agents/:id | superadmin | Edit system prompt |
| GET | /admin/analytics/overview | admin | System dashboard |
| GET | /admin/analytics/costs | admin | Cost vs revenue |
| GET | /admin/system/health | admin | All services health |
| GET | /admin/ratelimits/events | admin | Rate-limit events audit |
| POST | /admin/ratelimits/:userId/clear | admin | Clear user limits |
| POST | /admin/ratelimits/:userId/cooldown | admin | Apply or remove cooldown |
| GET | /admin/ratelimits/flagged | admin | List flagged users |
| PATCH | /admin/ratelimits/flagged/:userId | admin | Resolve a flagged user |

---

*This document is the single source of truth for Layer 2. Update it when modules change.*
