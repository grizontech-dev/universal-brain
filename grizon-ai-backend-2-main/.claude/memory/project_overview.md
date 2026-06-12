---
name: Project Overview
description: What Grizon AI is, its stack, goals, and current phase
type: project
originSessionId: 0c9d0c8e-5e36-4f0a-89fe-e618574d9cee
---
Grizon AI is a multi-agent AI platform (comparable to Perplexity + Claude + developer tools) being built from scratch. The founder is pre-funding and building lean on a single VPS.

**Why:** Wants a product with Perplexity-quality search, Claude-quality artifact handling, and deep code execution — all in one platform with a clean chat UI.

**Stack:** Express / TypeScript · PostgreSQL · Redis · BullMQ · Qdrant · Judge0 · EasyPanel on Hetzner/DigitalOcean VPS.

**Clients:**
- Web App (Next.js) — chat, agents, artifacts
- Admin App (Next.js) — full platform management

**Current Phase:** Pre-development planning. Architecture is fully documented in `/docs/`. No source code written yet.

**Key docs:**
- `/docs/PROJECT_ARCHITECTURE.md` — full system architecture
- `/docs/LAYER2_API_GATEWAY.md` — backend Layer 2 complete spec
- `/docs/LAYER2_VISUAL.html` — visual module map
- `/docs/ROUTER_FLOW.md` — smart router audit
- `/docs/PROMPT_FLOW.md` — prompt assembly audit

**How to apply:** Always treat this as a greenfield build. When suggesting implementations, default to the documented architecture. Don't suggest adding Kubernetes, microservices, or managed services — the constraint is a single VPS until post-funding.
