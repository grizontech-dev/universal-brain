# Public Agents & Auto Mode — Restructuring Plan

> **Status:** Exploration / proposal only. **No code or seed changes are made by this document.**
> **Scope:** Agents + the **cost model** (§4.3). The LLM roster itself is out of scope, but how cost is computed from it is now in scope.
> **Date:** 2026-06-02
> **Inputs:** `docs` skill-routing matrix ("Strategic Alignment of LLMs"), current [`src/db/seed.ts`](../src/db/seed.ts), router internals ([`src/router/agentDispatcher.ts`](../src/router/agentDispatcher.ts), [`src/router/classifier.ts`](../src/router/classifier.ts)).

---

## 1. Objectives (from the brief)

1. Define the **public-facing agent list**, informed by the strategy doc **and** the current setup.
2. **Break agents down by Plan** (Free / Basic / Pro / Elite).
3. **Redesign Auto Mode** so it routes to **all available public agents (plan-gated)** instead of a separate set of hidden internal agents.
4. Add an explicit **"include in Auto" tag** per agent so we can opt an agent in/out of Auto Mode without deleting it.
5. The **core / Auto catalogue is usage-based** (organised by task/skill). **In addition, ship exactly five Direct Model agents — one per provider — each pinned to that provider's latest model** (Anthropic, OpenAI, xAI, Google/Gemini, DeepSeek). These are for power users who want to talk to a specific model; they are **not** part of Auto.
6. Constraint: only the LLMs already in `seed.ts` exist. **Kimi, Opus 4.7, Llama 4 Scout, o3-mini, Mistral, GPT-5.5, Gemini 3.x are NOT available** and must be mapped to the closest model we actually have.

---

## 2. Available LLMs (ground truth — `seed.ts`)

These ten models are the **only** ones we can route to. Everything below maps onto this set.

| Model ID | Tier | Provider | Ctx | Notable capabilities | Latest per provider |
|---|---|---|---|---|:--:|
| `claude-haiku-4-5-20251001` | light | Anthropic | 200K | text, vision, tools | |
| `claude-sonnet-4-6` | high | Anthropic | 1M | text, vision, tools — our top quality model | ✅ |
| `gpt-4o-mini` | light | OpenAI | 128K | text, vision, tools | |
| `gpt-4o` | medium | OpenAI | 128K | text, vision, tools | ✅ |
| `gemini-2.5-flash-lite` | light | Google | 1M | text, vision, tools | |
| `gemini-2.5-flash` | medium | Google | 1M | text, vision, tools | |
| `gemini-2.5-pro` | high | Google | 1M | text, vision, tools, **reasoning** | ✅ |
| `deepseek-v4-flash` | light | DeepSeek | 1M | text, tools — cheapest | |
| `deepseek-v4-pro` | medium | DeepSeek | 1M | text, tools, **reasoning** | ✅ |
| `grok-4.3` | medium | xAI | 1M | text, vision, tools | ✅ |

> **Latest model per provider** (used by the Direct Model agents in §4.2): Anthropic → `claude-sonnet-4-6`, OpenAI → `gpt-4o`, Google → `gemini-2.5-pro`, DeepSeek → `deepseek-v4-pro`, xAI → `grok-4.3`.

### 2.1 Strategy-doc model → our model mapping

The doc prescribes models we don't host. This is the substitution table used throughout the plan:

| Doc model (skill matrix) | Closest available model | Rationale |
|---|---|---|
| Claude Opus 4.7 | `claude-sonnet-4-6` | Our highest-quality Anthropic model |
| DeepSeek-V4-Pro | `deepseek-v4-pro` | **Exact match** (reasoning, 1M, cheap) |
| DeepSeek-V4-Flash | `deepseek-v4-flash` | **Exact match** (baseline router) |
| Gemini 3.5 Flash | `gemini-2.5-flash` | Office/finance workhorse, 1M ctx |
| Gemini 3.1 Pro | `gemini-2.5-pro` | Reasoning + 1M ctx + vision |
| GPT-5.5 | `gpt-4o` | Our flagship OpenAI multimodal |
| o3-mini (math) | `deepseek-v4-pro` → `gemini-2.5-pro` | Reasoning-capable substitutes |
| Grok 4.20 | `grok-4.3` | **Closest match** |
| Llama 4 Scout (10M ctx legal RAG) | `gemini-2.5-pro` → `deepseek-v4-pro` | Best long-context (1M) we have |
| Kimi K2 (support) | `gemini-2.5-flash` | Fast, reliable multi-turn |
| Kimi k0-math (visual finance) | `gemini-2.5-pro` | Strong vision + reasoning |
| Mistral Large 3 (air-gapped HR) | **— none —** | No open-weights / self-host model available; **drop this agent for now** |

---

## 3. Current state & the problem

The current `seed.ts` runs **two parallel agent populations**:

### 3.1 Hidden "system" agents (`is_system = true`, `is_visible = false`)
`chat`, `research`, `deep_research`, `code`, `writer`, `analyst`, `architect`, `debugger`, `ui`, `document`.
These are the **only targets Auto Mode can reach today**. See [`agentDispatcher.ts`](../src/router/agentDispatcher.ts):

```ts
const AGENT_FOR_INTENT: Record<Intent, string> = {
  search: "research",  code: "code",      write: "writer",
  analyse: "analyst",  design: "architect", debug: "debugger",
  ui: "ui",            document: "document", chat: "chat",
};
```

### 3.2 Public agents (`is_visible = true`)
- **Specialized (usage-based):** `general`, `deep-research`, `coding-expert`
- **Direct model (model-based):** `claude-haiku`, `gemini-flash`, `gemini-pro`, `deepseek`, `grok`

### 3.3 Problems this creates
1. **Duplication & drift.** `code`/`coding-expert`, `research`+`deep_research`/`deep-research`, `chat`/`general` are near-duplicates with separate prompts, tools, and model priorities that must be maintained twice.
2. **Auto ≠ what the user can pick.** Auto routes only to hidden agents; the catalogue the user browses is a different list. Behaviour in Auto is not reproducible by selecting an agent manually.
3. **The current model-based agents are fragmented & stale.** `claude-haiku`, `gemini-flash`, `gemini-pro`, `deepseek`, `grok` mix tiers inconsistently (two Gemini agents, Anthropic pinned to *Haiku* not the flagship, no OpenAI agent at all) and aren't aligned to "latest model per provider." The fix (§4.2) is **exactly one Direct Model agent per provider, pinned to that provider's latest model** — kept deliberately separate from the usage-based Auto catalogue.
4. **`is_auto_eligible` is already a column** (`seed.ts`, `catalogue.service.ts:12`, migration `041`) but every agent is seeded `true` and it is never consulted by `pickAgent`. The control we want **already exists in the schema and is simply unused.**

---

## 4. Proposed model: usage-based core + one Direct Model agent per provider

Two clearly separated populations, all `is_visible = true`:

- **Usage-based core (§4.1)** — the task/skill agents (`general`, `research`, `code`, …). These power **Auto Mode** and carry the `is_auto_eligible` flag. Auto and manual selection draw from the **same** list. Each has an internal, plan-aware **model fallback chain** (`agent_model_priorities`) — the platform picks the model.
- **Direct Model agents (§4.2)** — exactly **five** agents, one per provider, each pinned to that provider's **latest model**. For users who explicitly want "just talk to Claude/GPT/Gemini/DeepSeek/Grok." `agent_type = 'direct'`, **`is_auto_eligible = false`** (never selected by Auto), category `ai-models`.

Hidden `is_system` agents are retired (the `chat` agent is kept only as a static safety fallback, see §7). The previous *fragmented* model-branded agents are **replaced** by the clean one-per-provider set in §4.2 (not removed — consolidated).

### 4.1 The public agent catalogue (usage-based)

Skill domains taken from the strategy doc's Table 1/3, merged with existing agents, mapped to our models.

**Auto-eligibility rule:** Auto routes only to the everyday core agents. **Expensive and specialist agents are excluded from Auto** (per brief: "exclude expensive and special agents like deep search") — they remain fully usable via manual selection. `cost_multiplier` is the credit multiplier applied on top of model cost.

| # | Agent (slug) | Skill domain (doc) | Primary → fallback models | Cost× | Auto-eligible | Notes |
|---|---|---|---|:--:|:--:|---|
| 1 | **General Assistant** (`general`) | Everyday Q&A / traffic router | `deepseek-v4-flash` → `gemini-2.5-flash-lite` → `gpt-4o-mini` → `claude-haiku-4-5` | 1.0 | ✅ (default) | The "baseline router" of the doc. Auto's fallback intent. |
| 2 | **Research** (`research`) | Web research w/ citations | `gemini-2.5-flash` → `deepseek-v4-flash` → `gpt-4o-mini` | 1.5 | ✅ | Standard `search` intent target. |
| 3 | **Coding & Engineering** (`code`) | Software engineering | `deepseek-v4-pro` → `claude-sonnet-4-6` → `gpt-4o` | 1.2 | ✅ | Doc: Opus 4.7 / V4-Pro. Merges `code` + `coding-expert`. |
| 4 | **Debugger** (`debugger`) | Bug hunting & root-cause | `deepseek-v4-flash` → `gpt-4o` → `claude-haiku-4-5` | 1.2 | ✅ | `debug` intent. |
| 5 | **Writer / Documentation** (`writer`) | Documentation, planning & office work | `gemini-2.5-flash` → `claude-sonnet-4-6` → `deepseek-v4-flash` | 1.0 | ✅ | Doc: Gemini 3.5 Flash / Sonnet (GDPval office work). |
| 6 | **Data & Financial Analyst** (`analyst`) | Financial analysis & auditing | `gemini-2.5-flash` → `gpt-4o` → `deepseek-v4-pro` | 1.3 | ✅ | Doc: Gemini 3.5 Flash / GPT-5.5 (Finance Agent v2). |
| 7 | **Document Intelligence** (`document`) | Legal contract review & massive-doc RAG | `gemini-2.5-pro` → `deepseek-v4-pro` → `gemini-2.5-flash` | 1.4 | ✅ | Doc: Llama 4 Scout / Gemini 3.1 Pro → use our 1M-ctx models. |
| 8 | **Architect** (`architect`) | System design & architecture | `deepseek-v4-pro` → `gemini-2.5-pro` → `claude-sonnet-4-6` | 1.5 | ❌ | `design` intent → falls back to `code` in Auto. Specialist. |
| 9 | **Deep Research** (`deep-research`) | Scientific synthesis & graduate research | `gemini-2.5-pro` → `deepseek-v4-pro` → `claude-sonnet-4-6` | 3.0 | ❌ | **Expensive — excluded from Auto.** Manual-only (Pro+). |
| 10 | **UI Generator** (`ui`) | Agentic UI / interface generation | `gpt-4o` → `claude-sonnet-4-6` → `deepseek-v4-flash` | 1.3 | ❌ | Specialist, Pro+. Manual-only. |
| 11 | **Math & Logic** (`math`) — *new* | Pure mathematics & logistics | `deepseek-v4-pro` → `gemini-2.5-pro` | 2.0 | ❌ | Doc: o3-mini / DeepSeek-R1. Specialist, reasoning-heavy. |
| 12 | **Fact-Check & Risk** (`fact-check`) — *new* | Factual fact-checking & market risk | `grok-4.3` → `gpt-4o` → `gemini-2.5-flash` | 1.5 | ❌ | Doc: Grok 4.20. Specialist; needs `web_search`. |
| — | ~~Customer Support~~ | Customer support automation | `gemini-2.5-flash` → `claude-haiku-4-5` | — | — | Doc: Kimi K2. **Enterprise/B2B only — exclude from public consumer catalogue for now.** |
| — | ~~Air-Gapped HR / Privacy~~ | Data-resident / on-prem | — | — | — | Doc: Mistral Large 3. **No self-host model available → drop.** |

**Auto Mode pool (7 core agents):** `general`, `research`, `code`, `debugger`, `writer`, `analyst`, `document`.
**Manual-only (5 specialist/expensive):** `architect`, `deep-research`, `ui`, `math`, `fact-check`.

> **"Usage-based" payoff:** in the core catalogue users pick a *job* and the platform picks the *model* via the fallback chains above. Users who instead want to pick a *specific model* use the Direct Model agents in §4.2.

### 4.2 Direct Model agents (one per provider, latest model)

Five agents, `agent_type = 'direct'`, category `ai-models`, **`is_auto_eligible = false`** (never used by Auto). Each is pinned to its provider's **latest model** (§2). No fallback chain — a direct agent *is* that model (if the model is unhealthy, it surfaces an error rather than silently switching providers).

| # | Agent (slug) | Provider | Pinned model (latest) | Cost× | Auto-eligible | Notes |
|---|---|---|---|:--:|:--:|---|
| 13 | **Claude** (`claude`) | Anthropic | `claude-sonnet-4-6` | 1.0¹ | ❌ | Flagship Anthropic. Replaces the old Haiku-pinned `claude-haiku`. |
| 14 | **GPT** (`gpt`) | OpenAI | `gpt-4o` | 1.0¹ | ❌ | New — there was no OpenAI direct agent before. |
| 15 | **Gemini** (`gemini`) | Google | `gemini-2.5-pro` | 1.0¹ | ❌ | Replaces the old `gemini-flash` + `gemini-pro` pair with one flagship agent. |
| 16 | **DeepSeek** (`deepseek`) | DeepSeek | `deepseek-v4-pro` | 1.0¹ | ❌ | Upgraded from `deepseek-v4-flash` to the Pro flagship. |
| 17 | **Grok** (`grok`) | xAI | `grok-4.3` | 1.0¹ | ❌ | Unchanged provider, latest model. |

¹ `cost_multiplier` left at 1.0 — credit cost is driven by the underlying model's per-token rate (a Sonnet/Gemini-Pro call is already expensive without a multiplier). Confirm in the pricing pass (§8).

Tools: same broad tool set the old direct agents had (`webSearch`, `webFetch`, `codeExecution`, `documentAnalysis`, `documentCreation`, `htmlPreview`, `chartGenerate`, `imageAnalyse`, `stockData`, `weatherData`), subject to plan feature flags.

### 4.3 Cost model — one multiplier, one pricing source

**Single formula. `agents.cost_multiplier` is the only multiplier. No other multiplier may be applied.**

```
# per-token rates come from ai_models — all values are PER 1,000 TOKENS
rawCost =  (inputFreshTokens  / 1000) × ai_models.input_cost_per_1k
        +  (inputCachedTokens / 1000) × ai_models.input_cached_cost_per_1k
        +  (outputTokens      / 1000) × ai_models.output_cost_per_1k

billedCost = rawCost × agents.cost_multiplier      # <-- the ONLY multiplier
```

**Rules:**
- **Pricing source of truth = `ai_models`** (`input_cost_per_1k`, `input_cached_cost_per_1k`, `output_cost_per_1k`), per 1,000 tokens, for the **actual model used on the turn** (which, for usage-based agents, is whichever model the fallback chain resolved to).
- **`agents.cost_multiplier` is the single, only multiplier.** It is applied once, on top of `rawCost`. Values are in §4.1 / §4.2.
- **No other multiplier is permitted** — specifically **remove** the `planDiscount` factor currently in [`creditCalculator.calculateCost`](../src/services/creditCalculator.service.ts) and do **not** introduce tier/plan/feature multipliers.

**Cleanup this implies (today there are 3 disagreeing pricing sources):**
1. [`creditCalculator.calculateCost`](../src/services/creditCalculator.service.ts) currently does `ceil((inTok+outTok)/1000 × costMultiplier × planDiscount)` — it **ignores the model's per-1k rate** (flat tokens), treats input == output, and applies a second `planDiscount` multiplier. Replace with the formula above (rate-aware, multiplier-only).
2. The hardcoded `MODEL_CREDIT_RATES` map in [`config/credits.ts`](../src/config/credits.ts) is **stale** (lists `claude-opus-4-7`, `grok-2`, `deepseek-chat`, `gemini-flash` — none of which are seeded model IDs) and must be **retired** in favour of the live `ai_models` rates.
3. The `ai_models.credit_rate` tier column (1/2/3 in `seed.ts`) is a *third* notion of cost and is **not** part of this formula — either drop it or keep it for display only; it must not enter `billedCost`.
4. Result: exactly **two inputs** to billing — `ai_models.*_cost_per_1k` × `agents.cost_multiplier`. Nothing else.

### 4.4 Pricing data must be fetched & kept up to date

`ai_models` per-1k rates must reflect **current provider list prices**, not seed placeholders.

- **Refresh step (implementation):** when adding a model or on a periodic schedule, fetch the latest published per-1k input / cached-input / output prices from each provider (Anthropic, OpenAI, Google, DeepSeek, xAI) and write them to `ai_models.{input,input_cached,output}_cost_per_1k`. Seed values are placeholders only.
- **⚠️ Stale-cache bug to fix:** [`chat.worker.ts`](../src/workers/chat.worker.ts) caches rates in `modelRateCache` with **no TTL** ("restart workers after pricing changes in `ai_models`"). For "always up-to-date pricing," add a TTL or bust the cache on `ai_models` update (e.g. pub/sub on price change) so refreshed prices take effect without a worker restart.
- **Cached-input pricing:** `seed.ts` sets `input_cached_cost_per_1k = input_cost_per_1k × 0.1` as a placeholder. Replace with each provider's real cached-input price during the refresh.

---

## 5. Plan-based breakdown

Tiers reuse the existing `plans.agent_access` array (`seed.ts` `PLAN_SEEDS`). Proposed new `agentAccess` per plan, using **only the unified usage-based slugs**:

| Agent | Free | Basic | Pro | Elite |
|---|:--:|:--:|:--:|:--:|
| `general` | ✅ | ✅ | ✅ | ✅ |
| `research` | ✅ | ✅ | ✅ | ✅ |
| `writer` | ✅ | ✅ | ✅ | ✅ |
| `code` | — | ✅ | ✅ | ✅ |
| `document` | — | ✅ | ✅ | ✅ |
| `analyst` | — | ✅ | ✅ | ✅ |
| `debugger` | — | — | ✅ | ✅ |
| `deep-research` | — | — | ✅ | ✅ |
| `fact-check` | — | — | ✅ | ✅ |
| `ui` | — | — | ✅ | ✅ |
| `architect` | — | — | — | ✅ |
| `math` | — | — | — | ✅ |
| **Usage-based count** | **3** | **6** | **10** | **12** |

**Direct Model agents (§4.2)** — gated by the pinned model's tier (don't hand Free/Basic a high-tier flagship):

| Direct agent (model) | Free | Basic | Pro | Elite |
|---|:--:|:--:|:--:|:--:|
| `deepseek` (`deepseek-v4-pro`, medium) | — | ✅ | ✅ | ✅ |
| `grok` (`grok-4.3`, medium) | — | ✅ | ✅ | ✅ |
| `gpt` (`gpt-4o`, medium) | — | ✅ | ✅ | ✅ |
| `gemini` (`gemini-2.5-pro`, high) | — | — | ✅ | ✅ |
| `claude` (`claude-sonnet-4-6`, high) | — | — | ✅ | ✅ |
| **Direct count** | **0** | **3** | **5** | **5** |

Mapping to current plans (`seed.ts`):
- **Free** (₹0, 50 cr): `['general','research','writer']` — 3 everyday core agents, no direct models. *(Currently also lists `claude-haiku`, `chat` — both removed under the unified model.)*
- **Basic** (₹999, 200 cr): `['general','research','writer','code','document','analyst', 'deepseek','grok','gpt']`
- **Pro** (₹1999, 500 cr): `['general','research','writer','code','document','analyst','debugger','deep-research','fact-check','ui', 'deepseek','grok','gpt','gemini','claude']`
- **Elite** (₹2999, 1000 cr): all 12 usage-based + all 5 direct (adds `architect`, `math`).

Feature-flag gating (`featureFlags`/`featureLimits`) is unchanged in spirit — e.g. `deepResearch` flag still guards manual access to `deep-research`; `codeExecution` still guards `code`/`debugger`/`analyst` tools.

---

## 6. Auto Mode redesign

### 6.1 Today
`classify()` → `Intent` → `AGENT_FOR_INTENT` → **hidden system slug** → `pickAgent()` walks `fallbackAgent` until one is in `plan.agentAccess`.

### 6.2 Proposed
1. **Repoint `AGENT_FOR_INTENT` to public usage-based slugs** (they're now the same agents, so no hidden targets). Note that two targets (`architect`, `ui`) are **not** auto-eligible, so when the classifier emits those intents in Auto, `pickAgent` falls through to an auto-eligible agent:

   ```ts
   const AGENT_FOR_INTENT: Record<Intent, string> = {
     search:   "research",
     code:     "code",
     write:    "writer",
     analyse:  "analyst",
     design:   "architect",   // not auto-eligible → falls back to "code"
     debug:    "debugger",
     ui:       "ui",          // not auto-eligible → falls back to "code"
     document: "document",
     chat:     "general",     // was "chat"
     // new intents (classifier update): "math", "fact" → both manual-only,
     // so in Auto they resolve to their fallback (general/research)
   };
   ```

2. **Honour `is_auto_eligible` in `pickAgent`.** An agent is a valid Auto target only if **both** `plan.agentAccess.includes(slug)` **and** `descriptor.isAutoEligible`. If the mapped agent is not auto-eligible (or not in plan), walk `fallbackAgent` → ultimately `general`. This makes the "include in Auto" tag the single switch for Auto participation. **`resolveExplicitAgent` ignores `is_auto_eligible`** — manual selection can still reach specialist agents the user's plan allows.

3. **`general` is the universal fallback** (replaces `chat`).

4. **Drop the deep-research auto-escalation.** Today `search + complex` can auto-promote to `deep_research`. Since **Deep Research is now excluded from Auto** (expensive), this escalation is removed — Auto stays on `research`, and Deep Research becomes a deliberate manual choice (Pro+).

5. **Classifier update (planned).** Add `math` and `fact` intents to the `Intent` type and `classifier.ts` so manual routing and analytics recognise them. Because `math`/`fact-check` are not auto-eligible, emitting these intents in Auto still resolves to a core agent via fallback — but the signal is captured for tool selection and metrics.

6. **Manual selection** targets the unified slugs. Crucially: **selecting a core agent manually produces identical behaviour to Auto choosing it**, because there is one definition.

7. **Direct Model agents are invisible to Auto.** They are not in `AGENT_FOR_INTENT` and are seeded `is_auto_eligible = false`, so `pickAgent` can never land on them — they are reachable only by explicit selection (`resolveExplicitAgent`). Auto Mode therefore stays purely usage-based.

### 6.3 The "include in Auto" tag
- **Field:** reuse the existing `agents.is_auto_eligible` boolean (already in schema, surfaced in `catalogue.service.ts`). No migration needed.
- **Seeding:** `is_auto_eligible = true` for the 7 core agents (`general`, `research`, `code`, `debugger`, `writer`, `analyst`, `document`); `false` for the 5 specialist/expensive agents (`architect`, `deep-research`, `ui`, `math`, `fact-check`) **and the 5 Direct Model agents** (`claude`, `gpt`, `gemini`, `deepseek`, `grok`). Today `seedSystemAgents`/`seedAgents` hardcode `true` — this becomes a per-agent property in the seed arrays.
- **Admin:** expose a toggle in the agent admin (the column already flows through `catalogueAdmin.service.ts`), so an agent can be opted in/out of Auto without deleting it.

---

## 7. What changes in `seed.ts` (when we proceed — not now)

- **Remove** `SYSTEM_AGENT_SEEDS` as a *separate hidden* population. Fold its prompts/tool budgets into the unified `AGENT_SEEDS` (all `is_visible = true`, `is_system = false`). **No new agents will be added to the `is_system` population**, and the existing system agents will **not** be part of Auto. Keep only the minimal static `chat`→`general` safety fallback (already exists as `STATIC_CHAT_AGENT` in code, independent of DB).
- **Replace** the five fragmented model-branded agents (`claude-haiku`, `gemini-flash`, `gemini-pro`, `deepseek`, `grok`) with the clean **five Direct Model agents** in §4.2 — one per provider, pinned to the latest model, `agent_type = 'direct'`, `is_auto_eligible = false`, category `ai-models`. (`deepseek`/`grok` slugs are reused but re-pointed to the Pro/latest model; `claude`/`gpt`/`gemini` are new/consolidated.) The `agent_type = 'direct'` code path (loader/dispatcher/schema) is **used**, not just kept.
- **Add** `is_auto_eligible` as an explicit field on each seed entry (core agents `true`; specialist/expensive **and all Direct Model agents** `false` — see §6.3) instead of the hardcoded `true`.
- **Add** `cost_multiplier` per the §4.1 / §4.2 columns (currently many agents seed `1`).
- **Add** two new usage-based agents: `math`, `fact-check` (manual-only).
- **Rewrite** `AGENT_PRIORITY_SEEDS` to the per-agent chains in §4.1 (usage-based only — Direct Model agents have a single pinned model, no priority chain).
- **Update** `PLAN_SEEDS[*].agentAccess` per §5.
- **Repoint** `AGENT_FOR_INTENT`, update `pickAgent` to honour `is_auto_eligible`, drop the deep-research escalation, and add `math`/`fact` intents to `Intent` + `classifier.ts` per §6.
- **Cost model (§4.3):** rewrite [`creditCalculator.calculateCost`](../src/services/creditCalculator.service.ts) to `rawCost(ai_models per-1k rates) × agents.cost_multiplier`; **remove the `planDiscount` multiplier**; retire the stale `MODEL_CREDIT_RATES` map in [`config/credits.ts`](../src/config/credits.ts); keep `ai_models.credit_rate` out of billing.
- **Pricing freshness (§4.4):** add a refresh step that writes current provider per-1k prices into `ai_models`, and fix the no-TTL `modelRateCache` in [`chat.worker.ts`](../src/workers/chat.worker.ts) so price changes take effect without a worker restart.

No schema migration is strictly required: `is_auto_eligible`, `is_visible`, `is_system`, `cost_multiplier`, `tags`, `agent_model_priorities`, `plans.agent_access`, and the `ai_models.*_cost_per_1k` columns all already exist. The classifier and cost-formula changes are code-only.

---

## 8. Open questions (decide before implementing)

1. ~~**Free tier breadth.**~~ ✅ **Resolved** — Free now has `general`, `research`, `writer` (3 agents). No action needed.
2. **Classifier intents for specialists.** `math`/`fact` will be added to the classifier, but since both agents are manual-only, Auto will never select them — the intents only drive tool selection/metrics. Confirm that's the intended behaviour (vs. eventually opting one into Auto).
3. **Customer Support / Air-Gapped** agents — confirm these stay out of the consumer product (B2B/enterprise track only).
4. **Cost-multiplier values** in §4.1 / §4.2 are proposals — confirm before locking. The cost *formula* is now fixed (§4.3): `ai_models` per-1k rates × `agents.cost_multiplier`, no other multiplier.

---

## 9. Summary

- **17 public agents total:** a **usage-based core of 12** (powers Auto) **plus 5 Direct Model agents** — one per provider (`claude`/`gpt`/`gemini`/`deepseek`/`grok`), each pinned to that provider's **latest model**, `is_auto_eligible = false`, never selected by Auto. This replaces the old fragmented system/public/model-branded split.
- **Auto Mode and manual selection share the same usage-based agents**, gated by `plan.agentAccess` + the existing-but-unused **`is_auto_eligible`** flag (the requested "include in Auto" tag — no migration needed). Direct Model agents are manual-only.
- **Auto routes to 7 core agents only**; the 5 expensive/specialist agents (`architect`, `deep-research`, `ui`, `math`, `fact-check`) are **excluded from Auto** and reachable only via manual selection. The deep-research auto-escalation is dropped.
- **No new `is_system` agents**; the existing hidden system agents are retired from Auto (only the static `chat`→`general` fallback remains).
- The **classifier will be updated** (`math`/`fact` intents added) alongside the `AGENT_FOR_INTENT` repoint.
- Agents are **plan-tiered** (Free 3 → Basic 6 → Pro 10 → Elite 12 usage-based; + 0/3/5/5 direct model agents), each with a proposed **`cost_multiplier`** (§4.1) and a **model fallback chain** drawn only from our 10 real models.
- **Cost model (§4.3):** `billedCost = rawCost(ai_models per-1k rates) × agents.cost_multiplier` — **`cost_multiplier` is the only multiplier**; the `planDiscount` factor and the stale `MODEL_CREDIT_RATES` map are removed. **Pricing (§4.4):** `ai_models` per-1k rates must be refreshed from current provider prices, and the no-TTL rate cache fixed so changes apply live.
- Unavailable doc models (Opus 4.7, GPT-5.5, Gemini 3.x, Llama 4 Scout, Kimi, o3-mini, Mistral) are substituted; the Mistral "air-gapped" agent is dropped (no self-host model).
- **No changes applied** — this is the proposal to review.
