# Layer 3 Runtime/Provider/Prompt Reference
## Modules 13, 15, 16, 22 — Implementation Companion

> **Status:** Active Reference  
> **Scope:** Implementation guide aligned to current code and catalogue amendments  
> **Last Updated:** 2026-05-07

---

## 1. Purpose and Source Priority

This document is the implementation companion for Layer 3 behavior where current code, `LAYER3_AGENT_EXECUTION.md`, and `AGENT_LLM_CATALOGUE.md` intersect.

Source priority for Modules 13/15/16/22:
1. `docs/AGENT_LLM_CATALOGUE.md` (amendments and supersession rules)
2. `docs/LAYER3_AGENT_EXECUTION.md` (base Layer 3 contracts)
3. `docs/PROJECT_ARCHITECTURE.md` (cross-layer constraints)

---

## 2. Supersession Map

| Module | Base Behavior | Superseded / Added Behavior |
|---|---|---|
| Module 13 (Runtime) | Shared agent loop and worker-driven execution | Runtime must branch by `agent_type`: specialized uses priority list, direct uses `direct_model_id` hard-fail path |
| Module 15 (Provider) | Provider fallback chain by health and availability | Specialized iterates `agent_model_priorities`; direct does not retry across models |
| Module 16 (Prompt) | Prompt assembly with cache-aware structure | Tool definitions must be filtered to plan-allowed set; enforce agent context caps |
| Module 22 (Subagents) | Isolated subagent execution pattern | Hard-coded model ids must be replaced by `systemModelConfig.resolve('high')` |

---

## 3. As-Built Layer 3 Mapping

Current implementation loci:
- Runtime orchestration: `src/workers/chat.worker.ts`
- Router + stream loop: `src/router/index.ts`
- Model selection and provider health: `src/router/modelSelector.ts`, `src/router/providerHealth.ts`
- Provider adapters: `src/models/providers/*.ts`
- Tool spec filtering and resolution: `src/router/tools.ts`
- Summarisation pathway: `src/services/summariser.service.ts`

Target modularized shape (design target):
- `src/runtime/*` (loop and control plane)
- `src/provider/*` (provider abstraction, fallback policy)
- `src/prompt/*` (assembly, cache boundaries, context compaction)
- `src/subagents/*` (isolated subagent runtime and synthesis)

---

## 4. Module 13 Runtime Contract

Execution invariants:
- Worker remains the entrypoint (`chat.worker`), not HTTP routes.
- Runtime must honor request interaction mode (`auto` vs `agent`) from Layer 2 payload.
- `mode=agent` bypasses classifier-driven agent selection; the selected agent must be plan-allowed and active.
- Runtime emits deterministic terminal states: `completed`, `failed`, `cancelled`, `timeout`.

Agent-type runtime branches:
- `specialized`: resolve model via active priority list (`agent_model_priorities`) and health filtering.
- `direct`: resolve only `direct_model_id`; if unavailable/down, return `NO_MODEL_AVAILABLE`/provider equivalent hard-fail without model-chain retry.

---

## 5. Module 15 Provider Selection and Streaming

Specialized selection:
1. Read active priority entries ordered by ascending `priority`.
2. Prefer `healthy`; defer `degraded` until no healthy option exists.
3. Skip `down`.
4. If none usable, fail with no-model-available error.

Direct selection:
1. Use configured `direct_model_id`.
2. If model/provider is unavailable, fail immediately.
3. Do not walk fallback model list.

Streaming requirements:
- Preserve chunk/tool_call/tool_result/usage/finish/error event semantics.
- Keep provider health integration (`providerHealth`) for circuit behavior.
- Keep usage accounting for fresh/cached input tokens and cache-write tokens.

---

## 6. Module 16 Prompt Assembly Rules

Prompt assembly must enforce:
- Plan-filtered tool definitions only (hidden tools are never sent to model).
- `agent.max_context_tokens` cap at full assembled prompt level.
- `agent.max_context_messages` cap on history inclusion.
- Cache-safe ordering: static prefix first, dynamic suffix last.
- No dynamic identifiers/timestamps in cacheable prefix.

Operational note:
- Current code composes prompt/tool payload in router + worker paths.
- Refactor target is a dedicated prompt assembly module with explicit contract tests.

---

## 7. Module 22 Subagent Policy

Subagent constraints:
- Subagents run in isolated context windows; parent context receives summaries only.
- Subagent model selection for synthesis/high-complexity tasks should resolve via `systemModelConfig.resolve('high')`.
- Parent usage/cost attribution must include subagent-induced spend in final telemetry.

---

## 8. Errors and Observability

Core errors to preserve:
- `AGENT_NOT_ALLOWED`, `TOOL_NOT_ON_PLAN`, `PROVIDER_EXHAUSTED`, `STREAM_TIMEOUT`, `INTERNAL_ERROR`
- Add/normalize `NO_MODEL_AVAILABLE` where model-priority/direct resolution fails pre-stream.

Telemetry minimums:
- `interaction_mode`, selected agent, selected model/provider
- router latency, first token latency, total stream latency
- tool call counts, web/code feature usage, cache-layer attribution

---

## 9. Migration Checklist

- Add/validate Layer 2 mode propagation through chat payload and usage rows.
- Introduce DB-backed provider/model/category/priority/system-model config surfaces.
- Replace runtime model resolution for specialized/direct branching.
- Centralize prompt assembly and enforce agent context caps.
- Wire subagent high-tier resolution through system model config.
- Run compatibility checks against existing worker stream and SSE contracts.

---

This document is intentionally implementation-focused and should be updated alongside runtime/provider/prompt code changes.
