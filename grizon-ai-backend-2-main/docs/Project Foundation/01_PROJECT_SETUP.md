# 01 — Project Setup

How to run the backend locally, what environment variables it expects, and how it ships to production.

## Stack at a Glance

- **Runtime:** Node.js ≥ 20 (LTS), TypeScript 5.x
- **Framework:** Express 4.x
- **DB:** PostgreSQL 16
- **Cache / queues:** Redis 7
- **Vector store:** Qdrant
- **Job queue:** BullMQ (on Redis)
- **Code execution:** Judge0 (own container)
- **Hosting:** Single VPS, orchestrated via EasyPanel

## Prerequisites

| Tool | Why |
|---|---|
| Node 20+ | Runtime |
| pnpm | Package manager (lockfile is `pnpm-lock.yaml`) |
| Docker + Docker Compose | Local Postgres / Redis / Qdrant |
| `gh` CLI (optional) | PR workflow |

## First-Time Local Setup

```bash
# 1. Install deps
pnpm install

# 2. Copy env
cp .env.example .env
#    fill in DB_URL, REDIS_URL, JWT keys, GOOGLE_CLIENT_IDS, etc.

# 3. Start infra
docker compose up -d postgres redis qdrant

# 4. Run migrations
pnpm migrate

# 5. Seed (optional — admin user, sample plans)
pnpm seed

# 6. Run dev server
pnpm dev
```

The dev server runs on `http://localhost:3000`. Hot reload via `tsx watch`.

## NPM Scripts (package.json)

| Script | Does |
|---|---|
| `pnpm dev` | `tsx watch src/index.ts` — reload on save |
| `pnpm build` | `tsc -p .` → `dist/` |
| `pnpm start` | `node dist/index.js` — production entry |
| `pnpm test` | `vitest run` |
| `pnpm test:watch` | `vitest` |
| `pnpm lint` | `eslint .` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm migrate` | Run pending migrations |
| `pnpm migrate:create <name>` | Scaffold a new SQL migration |
| `pnpm seed` | Seed dev data |

## Environment Variables

Loaded once at boot, validated by **Zod** in `src/config/env.ts`. Missing or malformed values cause the process to exit immediately.

```env
# Server
NODE_ENV=development        # development | test | production
PORT=3000
PUBLIC_URL=http://localhost:3000

# Logging
LOG_LEVEL=info              # trace | debug | info | warn | error | fatal
LOG_PRETTY=true             # set false in production for JSON output

# Database
DATABASE_URL=postgres://app:app@localhost:5432/app
DATABASE_POOL_MAX=20

# Redis
REDIS_URL=redis://localhost:6379

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=

# Auth
JWT_PRIVATE_KEY_PATH=./secrets/jwt-private.pem
JWT_PUBLIC_KEY_PATH=./secrets/jwt-public.pem
JWT_KID=v1
JWT_ISSUER=https://api.example.com
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000

# Google OAuth (one client ID per platform; comma-separated allowlist)
GOOGLE_CLIENT_IDS=xxxx-web.apps.googleusercontent.com,xxxx-ios.apps.googleusercontent.com,xxxx-android.apps.googleusercontent.com

# Captcha (Cloudflare Turnstile)
TURNSTILE_SECRET=

# Mailer
MAIL_PROVIDER=postmark      # postmark | resend | ses
MAIL_API_KEY=
MAIL_FROM=hello@example.com

# LLM providers
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=

# Search
TAVILY_API_KEY=

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://app.example.com
```

`.env.example` is committed; real `.env` files never are.

## Docker Compose (local)

```yaml
# docker-compose.yml — local dev only; mirrors EasyPanel services
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  qdrant:
    image: qdrant/qdrant
    ports: ["6333:6333"]
    volumes: [qdrant:/qdrant/storage]

volumes:
  pgdata:
  qdrant:
```

## Deployment (EasyPanel)

1. Push to `main`.
2. EasyPanel webhook builds a Docker image from the repo `Dockerfile`.
3. Container is replaced with zero downtime; new container runs migrations on start (`pnpm migrate && pnpm start`).
4. Env vars are managed in the EasyPanel UI — never committed to the repo.
5. Health check endpoint: `GET /health` (returns `{ status: 'ok', uptime, version }`).

See [`docs/PROJECT_ARCHITECTURE.md` §4](../PROJECT_ARCHITECTURE.md) for the full infra picture (Postgres / Redis / Qdrant / Judge0 sidecars).

## Boot Sequence (production)

```
1. Load + validate env (Zod). Fail-fast on missing keys.
2. Open Postgres + Redis + Qdrant pools. Fail-fast on unreachable.
3. Load JWT key pair from disk. Fail-fast on missing.
4. Run pending migrations (idempotent).
5. Initialise logger (Pino).
6. Mount middleware: requestId → logger → cors → bodyParser → auth → admin → routes → errorHandler.
7. Start BullMQ workers (chat, file, notification).
8. Open HTTP listener.
9. Register graceful shutdown on SIGTERM (drain BullMQ, close pools, exit 0).
```

## Conventions

- **Module boundaries.** Layer 2 modules ([Module 1](../Layer%202%20Modules/Module%201%20-%20Auth%20and%20Identity/README.md), Module 2, …) live under their own subfolders within `src/`. See [02_FOLDER_STRUCTURE.md](02_FOLDER_STRUCTURE.md).
- **No circular imports.** A module never imports from a module above it in the dependency stack.
- **Tests sit in `test/`**, mirroring the `src/` tree.
- **Never commit secrets**, even in `.env.example`. Use placeholder values.
