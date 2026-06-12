# 02 — Folder Structure

The complete `src/` tree for the backend. Module-specific files (auth, plan, wallet, …) follow the same shape so a new contributor can find anything by analogy.

## Top-Level Tree

```
project-root/
├── src/                          ← all application code
├── test/                         ← mirrors src/ (unit + integration)
├── docs/                         ← these documents
├── secrets/                      ← gitignored: JWT keys, dev certs
├── docker-compose.yml            ← local infra
├── Dockerfile                    ← production image
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── .env.example
└── .eslintrc.cjs
```

## `src/` — Inside

```
src/
├── index.ts                      ← Express bootstrap; mounts middleware + routes; starts listener
│
├── config/
│   ├── env.ts                    ← Zod-validated env vars (single source of truth)
│   ├── auth.ts                   ← JWT keys, TTLs, argon2 params
│   ├── google.ts                 ← Google client IDs allowlist
│   ├── plans.ts                  ← Default plan capability matrix
│   ├── models.ts                 ← LLM model registry per provider/tier
│   └── features.ts               ← Default feature-flag definitions
│
├── gateway/                      ← Express middleware (run in pipeline order)
│   ├── requestId.middleware.ts   ← attach req.id
│   ├── logger.middleware.ts      ← request log line via Pino
│   ├── cors.middleware.ts
│   ├── auth.middleware.ts        ← JWT verify + req.user load           (Module 1)
│   ├── admin.middleware.ts       ← requireAdmin / requireSuperadmin     (Module 1)
│   ├── plan.middleware.ts        ← Plan resolver                        (Module 2)
│   ├── featureFlag.middleware.ts ← Feature gate check                   (Module 3)
│   ├── creditBudget.middleware.ts← Wallet balance check + hold          (Module 4)
│   ├── rateLimit.middleware.ts   ← 4-window sliding rate limit          (Module 5)
│   ├── sanitiser.middleware.ts   ← Zod schema + injection strip         (Module 9)
│   └── errorHandler.middleware.ts← Final error → universal envelope     (this layer)
│
├── routes/
│   ├── user/                     ← /api/v1/*
│   │   ├── auth.routes.ts
│   │   ├── chat.routes.ts
│   │   ├── conversation.routes.ts
│   │   ├── file.routes.ts
│   │   ├── artifact.routes.ts
│   │   ├── wallet.routes.ts
│   │   └── usage.routes.ts
│   └── admin/                    ← /api/v1/admin/*
│       ├── auth.routes.ts
│       ├── users.routes.ts
│       ├── plans.routes.ts
│       ├── subscriptions.routes.ts
│       ├── models.routes.ts
│       ├── agents.routes.ts
│       ├── analytics.routes.ts
│       ├── ratelimits.routes.ts
│       └── system.routes.ts
│
├── services/                     ← Business logic — called from routes; never know about Express
│   ├── auth.service.ts
│   ├── token.service.ts
│   ├── password.service.ts
│   ├── oauth.service.ts
│   ├── profile.service.ts
│   ├── audit.service.ts
│   ├── session.service.ts
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
├── router/                       ← Smart Router (Layer 2 Module 10)
│   ├── classifier.ts
│   ├── modelSelector.ts
│   ├── agentDispatcher.ts
│   └── queryRewriter.ts
│
├── agents/                       ← Per-agent classes (chat, writer, research, …)
│   ├── base.agent.ts
│   └── ...
│
├── tools/                        ← Tool implementations (web_search, code_execute, …)
│   ├── base.tool.ts
│   └── ...
│
├── prompt/
│   ├── assembler.ts
│   ├── cacheManager.ts
│   ├── compactor.ts
│   └── systemPrompts/
│
├── memory/
│   ├── session.memory.ts
│   ├── vector.memory.ts
│   └── semantic.cache.ts
│
├── models/                       ← LLM provider wrappers (NOT data models)
│   ├── provider.ts               ← unified caller (LiteLLM-style)
│   ├── anthropic.ts
│   ├── openai.ts
│   ├── google.ts
│   └── streaming.ts
│
├── queues/                       ← BullMQ queue definitions
│   ├── chat.queue.ts
│   ├── file.queue.ts
│   └── notification.queue.ts
│
├── workers/                      ← BullMQ workers
│   ├── chat.worker.ts
│   ├── file.worker.ts
│   └── notification.worker.ts
│
├── execution/
│   └── judge0.service.ts
│
├── costs/
│   ├── tracker.ts
│   └── calculator.ts
│
├── db/
│   ├── postgres.ts               ← pool + typed query helper
│   ├── redis.ts                  ← ioredis client
│   ├── qdrant.ts                 ← Qdrant SDK wrapper
│   └── migrations/               ← *.sql files, forward-only
│
├── events/
│   ├── auth.events.ts
│   ├── plan.events.ts
│   └── ...
│
├── utils/
│   ├── logger.ts                 ← Pino instance + child loggers
│   ├── errors.ts                 ← AppError class + error codes
│   ├── response.ts               ← ok() / fail() helpers (universal envelope)
│   ├── pagination.ts
│   ├── fingerprint.ts
│   ├── jwt.ts
│   ├── secureRandom.ts
│   └── time.ts
│
└── types/
    ├── auth.d.ts                 ← req.user, req.session, req.platform
    ├── express.d.ts              ← module augmentation for Request/Response
    └── env.d.ts
```

## Naming Rules

| Folder | File pattern | Default export |
|---|---|---|
| `gateway/` | `*.middleware.ts` | a single middleware function |
| `routes/**` | `*.routes.ts` | an Express `Router` |
| `services/` | `*.service.ts` | named functions (no classes unless stateful) |
| `events/` | `*.events.ts` | typed emitter |
| `queues/` | `*.queue.ts` | a BullMQ `Queue` instance |
| `workers/` | `*.worker.ts` | a BullMQ `Worker` instance |
| `agents/` | `*.agent.ts` | class extending `BaseAgent` |
| `tools/` | `*.tool.ts` | class extending `BaseTool` |
| `db/migrations/` | `NNN_short_name.sql` | SQL only, idempotent if practical |

## Dependency Direction (no cycles)

```
routes  →  services  →  db / external
   ↓          ↓
gateway   events
   ↓
utils
```

A `route` may call a `service`. A `service` may call `db` and emit `events`. **Never** the other way around.

## Test Tree (mirrors src)

```
test/
├── unit/
│   ├── services/
│   ├── utils/
│   └── ...
└── integration/
    ├── routes/
    │   ├── user/
    │   └── admin/
    └── flows/                    ← end-to-end flows e.g. login → chat
```
