# Agent & LLM Catalogue
## Providers · LLM Registry · Agents · System Models · Catalogue API

> **Status:** Active Design — extends Layer 2 (Modules 10, 11, 12) and informs Layer 3 (Modules 13, 15, 16)
> **Stack:** Express / TypeScript · PostgreSQL · Redis
> **Last Updated:** 2026-05-07

---

## Table of Contents

1. [What This Document Covers](#1-what-this-document-covers)
2. [Providers](#2-providers)
3. [LLM Registry](#3-llm-registry)
4. [Model Auto-Fetch](#4-model-auto-fetch)
5. [Agent Categories](#5-agent-categories)
6. [Agents — Unified Schema](#6-agents--unified-schema)
7. [Tool Access — Plan Controlled](#7-tool-access--plan-controlled)
8. [System Model Configuration](#8-system-model-configuration)
9. [Interaction Modes](#9-interaction-modes)
10. [Plan Integration](#10-plan-integration)
11. [User Catalogue API](#11-user-catalogue-api)
12. [Admin Management API](#12-admin-management-api)
13. [Redis Caching Strategy](#13-redis-caching-strategy)
14. [Database Schema](#14-database-schema)
15. [Folder Structure](#15-folder-structure)
16. [Layer Integration Summary](#16-layer-integration-summary)

---

## 1. What This Document Covers

This document fills the following gaps in the existing Layer 2 and Layer 3 specs:

| Gap | Resolution |
|---|---|
| No provider registry | New `providers` table, auto-populated from ENV keys on startup |
| No model auto-fetch from provider APIs | New admin-triggered fetch flow per provider |
| Plans control raw `modelAccess` | Removed — plans only reference agents via `agentAccess` |
| No agent categories | New `agent_categories` table, admin-managed, no fixed enum |
| Specialized vs. direct agents are separate pipelines | Unified schema — single `agent_type` flag drives behaviour in Layer 3 |
| Tool access on agents | Removed — tool access is entirely plan-controlled (Module 3) |
| No internal system model pool | New `system_model_config` with Light / Medium / High tiers |
| No per-agent context limit | `max_context_tokens` and `max_context_messages` on agents |
| No unified user catalogue endpoint | New `GET /catalogue` returns agents grouped by category, filtered to plan |

---

## 2. Providers

Providers are auto-detected at server startup by checking which API keys are present in ENV. No manual provider creation is required — the supported list is fixed; the active list is ENV-driven.

### Supported Providers

| Provider | ENV Key | Model List Endpoint |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `GET https://api.anthropic.com/v1/models` |
| OpenAI | `OPENAI_API_KEY` | `GET https://api.openai.com/v1/models` |
| Google Gemini | `GEMINI_API_KEY` | `GET https://generativelanguage.googleapis.com/v1beta/models` |
| DeepSeek | `DEEPSEEK_API_KEY` | `GET https://api.deepseek.com/v1/models` |
| xAI (Grok) | `XAI_API_KEY` | `GET https://api.x.ai/v1/models` |

### Provider Object

```typescript
interface Provider {
  id: string;
  slug: string;           // 'anthropic' | 'openai' | 'google' | 'deepseek' | 'xai'
  displayName: string;    // 'Anthropic' | 'OpenAI' | 'Google' | 'DeepSeek' | 'xAI'
  iconUrl: string | null;
  apiBaseUrl: string;
  envKeyName: string;     // name of the ENV var (not the value), e.g. 'ANTHROPIC_API_KEY'
  isKeyPresent: boolean;  // resolved at runtime: !!process.env[envKeyName]
  isActive: boolean;      // admin can disable a provider even if key is present
  modelCount: number;     // count of active models from this provider in registry
}
```

### Startup Sync

On every server start, `src/startup/providerSync.ts` runs:

```
for each SUPPORTED_PROVIDER:
  if process.env[provider.envKeyName] exists:
    UPSERT providers SET is_key_present = true, updated_at = now()
  else:
    UPSERT providers SET is_key_present = false, updated_at = now()
```

This keeps the `providers` table in sync with the deployed environment without any admin action. A provider with `is_key_present = false` cannot have models fetched or used.

---

## 3. LLM Registry

The LLM registry (`ai_models` table) is the single source of truth for every model the platform knows about. Models are added via admin selection after an auto-fetch (§4) or entered manually.

### Model Object

```typescript
interface LLMModel {
  id: string;
  modelId: string;              // provider's identifier, e.g. 'claude-sonnet-4-6'
  providerId: string;           // FK to providers
  displayName: string;          // 'Claude Sonnet 4.6'
  tier: 'nano' | 'standard' | 'premium' | 'frontier' | 'reasoning';

  // Pricing
  creditRate: number;           // credits per 1K tokens (base rate, before agent cost multiplier)

  // Technical specs (pre-filled from provider API where available)
  contextWindow: number | null; // max input tokens
  maxOutputTokens: number | null;
  capabilities: string[];       // ['vision', 'tool-use', 'streaming', 'thinking', 'json-mode']

  // Display
  iconUrl: string | null;
  shortDescription: string;     // ≤120 chars
  longDescription: string;
  tags: string[];               // ['long-context', 'reasoning', 'multimodal']

  // Status
  isActive: boolean;
  healthStatus: 'healthy' | 'degraded' | 'down';
  sortOrder: number;

  createdAt: Date;
  updatedAt: Date;
}
```

### `capabilities` Values

| Value | Meaning |
|---|---|
| `vision` | Accepts image inputs |
| `tool-use` | Supports native function / tool calling |
| `streaming` | Supports token streaming |
| `thinking` | Extended reasoning / chain-of-thought (o1, Gemini 2.5 Pro) |
| `json-mode` | Guaranteed structured JSON output |
| `audio` | Accepts audio inputs |
| `embeddings` | Can produce vector embeddings |

---

## 4. Model Auto-Fetch

Auto-fetch is a convenience flow for importing models. It is independent of the registry — the registry only contains models an admin explicitly imported.

### Flow

```
Admin clicks "Fetch Models" for a provider in the admin panel
  │
  ▼
POST /admin/providers/:providerId/fetch-models
  │
  ▼
Server calls provider's model list endpoint using the ENV key
  │
  ▼
Returns FetchedModel[] :
  - Pre-filled: modelId, contextWindow, maxOutputTokens, capabilities (from provider API)
  - Requires admin input: displayName, tier, creditRate, shortDescription
  │
  ▼
Admin reviews the list:
  - Already-imported models marked as "Already in registry" (greyed out)
  - New models shown with pre-filled + editable fields
  │
  ▼
Admin selects models, fills in required fields, clicks "Import"
  │
  ▼
POST /admin/models/import  { models: ImportModelBody[] }
  │
  ▼
Models inserted into ai_models table
```

### `FetchedModel` Shape

```typescript
interface FetchedModel {
  modelId: string;                // from provider API
  isAlreadyImported: boolean;     // true if modelId already exists in ai_models
  prefilled: {
    contextWindow:   number | null;
    maxOutputTokens: number | null;
    capabilities:    string[];
  };
  requiresAdmin: {                // admin must fill these before import
    displayName:     string;
    tier:            string;
    creditRate:      number;
    shortDescription: string;
  };
}
```

### `ImportModelBody`

```typescript
interface ImportModelBody {
  modelId:           string;
  displayName:       string;
  tier:              string;
  creditRate:        number;
  contextWindow?:    number;
  maxOutputTokens?:  number;
  capabilities?:     string[];
  iconUrl?:          string;
  shortDescription:  string;
  longDescription?:  string;
  tags?:             string[];
}
```

---

## 5. Agent Categories

Categories are admin-created and stored in the DB. There is no hard-coded enum. The frontend agent picker uses categories for visual grouping and section headers.

### Category Object

```typescript
interface AgentCategory {
  id: string;
  name: string;           // e.g. 'Research', 'Writing', 'Code', 'Data', 'Direct Models'
  slug: string;           // e.g. 'research', 'writing', 'code', 'data', 'direct-models'
  description: string;    // shown to admin in dropdown when creating/editing an agent
  iconUrl: string | null;
  sortOrder: number;      // controls section order in the frontend picker
  isActive: boolean;
  createdAt: Date;
}
```

Agents select a category via dropdown in the admin panel (populated from the `agent_categories` table).

When a category is deactivated, agents in it are **not deleted** — they become hidden from the user catalogue (`isVisible` treated as `false`) until reassigned to another category.

---

## 6. Agents — Unified Schema

There is **one** agent schema and **one** agent pipeline. The `agent_type` field is the only flag that changes routing behaviour in Layer 3.

### Agent Types

| Type | System Prompt | Tool Access | Model Source | Fallback |
|---|---|---|---|---|
| `specialized` | Crafted domain prompt | Via plan feature flags | Priority list (`agent_model_priorities`) | Yes — iterates list |
| `direct` | Minimal / none | Via plan feature flags | Single `direct_model_id` on agent | No — hard-fail |

Both types share:
- `cost_multiplier` (default `1.0`)
- `max_context_tokens` and `max_context_messages`
- Plan-gating via `agentAccess`
- Appearance in the user catalogue
- The same Layer 3 agent loop

### Agent Object

```typescript
interface Agent {
  id: string;
  slug: string;                 // unique, kebab-case, stable identifier
  agentType: 'specialized' | 'direct';
  categoryId: string;           // FK to agent_categories

  // Display
  displayName: string;
  iconUrl: string | null;
  shortDescription: string;     // ≤120 chars, shown in picker card
  longDescription: string;      // shown in agent detail / info view
  tags: string[];               // e.g. ['web-search', 'citations', 'reasoning']
  examplePrompts: string[];     // 3–5 starter prompts shown in the UI
  sortOrder: number;

  // Prompt
  systemPrompt: string;         // crafted domain prompt for specialized; empty for direct

  // Context limits (per-agent, independent of model hardware limit)
  maxContextTokens: number;     // max tokens in the assembled prompt (incl. history)
  maxContextMessages: number;   // max message turns to include from history

  // Cost
  costMultiplier: number;       // default 1.0; multiplied on top of model credit rate

  // Model source
  // specialized → resolved from agent_model_priorities table (ordered fallback list)
  // direct      → resolved from directModelId (no fallback)
  directModelId: string | null; // non-null only when agentType = 'direct'

  // Visibility & status
  isAutoEligible: boolean;      // can Auto mode select this agent?
  isVisible: boolean;           // show in user catalogue picker
  isActive: boolean;            // hard on/off; inactive = unreachable by any means

  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Agent Model Priority List (specialized agents only)

For `specialized` agents, the ordered fallback list lives in the `agent_model_priorities` table:

```typescript
interface AgentModelPriority {
  id: string;
  agentId: string;
  modelId: string;          // references ai_models.model_id
  model: {                  // joined for display
    displayName: string;
    provider: string;
    tier: string;
    healthStatus: string;
  };
  priority: number;         // 1 = first choice; lower = higher priority
  isActive: boolean;        // disable entry without deleting it
  notes: string | null;     // admin annotation, e.g. 'fallback for outages'
}
```

**Layer 3 selection logic (Module 15):**

```
Load agent_model_priorities WHERE agent_id = X AND is_active = true ORDER BY priority ASC

For each entry:
  if model.healthStatus = 'down'   → skip
  if model.healthStatus = 'degraded' → use only if no 'healthy' option remains
  else → select and proceed

If no model passes → emit error 'NO_MODEL_AVAILABLE' (503)
```

`direct` agents skip this table entirely — `directModelId` is the only model used, and if it is down the request hard-fails.

---

## 7. Tool Access — Plan Controlled

Tool access lives **entirely on the plan** via Module 3 feature flags and usage quotas. Agents have no `allowedTools` field and do not gate tools themselves.

### How It Works

An agent's system prompt describes its capabilities, including which tools it may invoke. At prompt assembly time (Module 16), the tool definitions sent to the LLM are **filtered to only those tools the user's plan allows**. The LLM never sees — and therefore never calls — a tool the plan does not permit.

```
Tool definition sent to LLM iff:
  plan.featureFlags[tool.featureFlag] === true

Tool executes iff:
  plan.featureFlags[tool.featureFlag] === true   ← Module 3 gate (final check)
  AND plan.toolQuotas[tool] not exceeded          ← Module 3 usage quota
```

### Tool Registry (Layer 3 Module 14 — unchanged)

| Tool Slug | Feature Flag (on plan) | External Service |
|---|---|---|
| `web_search` | `webSearch` | Tavily → Brave fallback |
| `web_fetch` | `webSearch` | Internal scraper |
| `file_read` | `fileUpload` | Unstructured.io |
| `file_generate` | `documentCreation` | Native libs (xlsx / docx / csv / md) |
| `html_generate` | `htmlPreview` | Native template + sanitiser |
| `code_execute` | `codeExecution` | Judge0 |
| `chart_generate` | `codeExecution` | Code execution → image artifact |
| `image_analyse` | `fileUpload` | Vision-capable provider call |

### Error Response When Tool Is Not on Plan

When a tool call is attempted but the plan flag is off, Module 14 returns a structured error to the agent. The agent is instructed via its system prompt to relay this naturally to the user:

```json
{
  "ok": false,
  "error": "TOOL_NOT_ON_PLAN",
  "tool": "web_search",
  "message": "Web search is not available on your current plan.",
  "upgradeUrl": "/pricing"
}
```

---

## 8. System Model Configuration

A global, admin-managed configuration that defines which models are used for **internal platform operations** — query classification, summarisation, embeddings, keepalive pings, query rewriting, etc.

This is entirely separate from agent model selection and plan-based access.

### Three Tiers

| Tier | Typical Internal Uses |
|---|---|
| `light` | Query classification, conversation title generation, keepalive pings, short summarisation |
| `medium` | Rolling context summarisation, semantic cache embedding, query rewriting, memory fact extraction |
| `high` | Full conversation compaction, deep summarisation, subagent synthesis |

Each tier holds a **priority-ordered list of model IDs**. The system picks the first model in the list whose `healthStatus != 'down'`, falling back to the next entry if unavailable.

### System Model Config Object

```typescript
interface SystemModelConfig {
  light:  SystemModelEntry[];
  medium: SystemModelEntry[];
  high:   SystemModelEntry[];
}

interface SystemModelEntry {
  priority: number;         // 1 = first choice, ascending
  modelId: string;
  model: {                  // joined at read time
    displayName: string;
    provider: string;
    healthStatus: string;
  };
  isActive: boolean;
  notes: string | null;
}
```

### Usage in Code

Internal services call `systemModelResolver.resolve(tier)` — it reads from Redis, applies the health filter live, and returns the winning model:

```typescript
// Query classifier (Module 10)
const model = await systemModelResolver.resolve('light');

// Rolling summarisation (Module 16)
const model = await systemModelResolver.resolve('medium');

// Full conversation compaction (Module 16)
const model = await systemModelResolver.resolve('high');
```

### Internal Use Site Reference

| Use Site | Tier |
|---|---|
| Query classifier (Module 10) | `light` |
| Conversation title generator | `light` |
| Keepalive ping (Module 15) | `light` |
| Query rewriter (Module 10) | `medium` |
| Rolling summarisation (Module 16) | `medium` |
| Semantic cache embedding (Module 17) | `medium` |
| Memory fact extractor (Module 18) | `medium` |
| Full conversation compaction (Module 16) | `high` |
| Subagent synthesis (Module 22) | `high` |

---

## 9. Interaction Modes

Every `POST /chat` request carries a `mode` field. Defaults to `'auto'` if omitted.

```typescript
type InteractionMode = 'auto' | 'agent';
```

| Mode | Behaviour |
|---|---|
| `auto` | Smart Router (Module 10) classifies intent and selects the best eligible agent. Only agents with `isAutoEligible = true`, `isActive = true`, and slug in `plan.agentAccess` are candidates. Model is resolved from the selected agent's priority list. |
| `agent` | User supplies `agentSlug`. Router is bypassed. The agent's `agentType` determines model resolution in Layer 3. A `direct`-type agent slug is how users get a "talk directly to this LLM" experience — there is no separate `direct` mode. |

> **Note:** There is no `mode: 'direct'`. Direct LLM access is achieved by creating a `direct`-type agent (e.g. `"claude-opus-direct"`) and including it in a plan. The user selects it as any other agent via `mode: 'agent'`.

### Updated `POST /chat` Body

```typescript
// Additions to the existing ChatRequestBody schema
interface ChatRequestBody {
  conversationId: string;
  content: string;
  attachedFileIds?: string[];

  mode?: 'auto' | 'agent';  // default: 'auto'
  agentSlug?: string;        // required when mode = 'agent'

  // Power-user overrides (existing feature flags on plan still gate these)
  options?: {
    temperature?: number;                        // temperatureControl flag
    customSystemPrompt?: string;                 // customSystemPrompt flag
    searchContextSize?: 'low' | 'medium' | 'high';
  };
}
```

**Sanitiser middleware (Module 9) rejects:**
- `mode = 'agent'` with no `agentSlug`
- `agentSlug` not in `plan.agentAccess`
- `agentSlug` where `agent.isActive = false`

---

## 10. Plan Integration

Plans reference only agents. The `modelAccess` array is **deprecated and removed** from plans. Which models a user can reach is determined entirely by which agents their plan includes and those agents' model priority lists.

```typescript
// Plan — only access control field for agents/models
agentAccess: string[]   // array of agent slugs
// model_access: DEPRECATED — no longer read by the application
```

### Example Plan → Agent Matrix

| Agent | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| `chat` | ✓ | ✓ | ✓ | ✓ |
| `writer` | ✓ | ✓ | ✓ | ✓ |
| `research` | ✗ | ✓ | ✓ | ✓ |
| `code` | ✗ | ✓ | ✓ | ✓ |
| `document` | ✗ | ✓ | ✓ | ✓ |
| `analyst` | ✗ | ✗ | ✓ | ✓ |
| `architect` | ✗ | ✗ | ✓ | ✓ |
| `debugger` | ✗ | ✗ | ✓ | ✓ |
| `ui` | ✗ | ✗ | ✓ | ✓ |
| `deep_research` | ✗ | ✗ | ✓ | ✓ |
| `claude-opus-direct` | ✗ | ✗ | ✓ | ✓ |
| `gpt-4o-direct` | ✗ | ✗ | ✓ | ✓ |
| All agents | ✗ | ✗ | ✗ | ✓ |

`direct`-type agents (`claude-opus-direct`, `gpt-4o-direct`) sit in the `"Direct Models"` category and are added to plans like any other agent. The `modelPicker` feature flag is **retired** — plan access to a direct agent is the sole control.

---

## 11. User Catalogue API

### `GET /api/v1/catalogue`

Returns everything the frontend needs to render the agent picker and mode selector, filtered to the current user's plan.

**Auth:** JWT required
**Cache:** `catalogue:{userId}:{planId}` in Redis, TTL 5 minutes

```typescript
interface CatalogueResponse {
  modes: {
    auto:  { available: true };
    agent: { available: true };
  };

  // Agents grouped by category, ordered by category.sortOrder then agent.sortOrder
  // Filtered to: plan.agentAccess ∩ agent.isVisible = true ∩ agent.isActive = true
  categories: CatalogueCategory[];
}

interface CatalogueCategory {
  slug:      string;
  name:      string;
  iconUrl:   string | null;
  sortOrder: number;
  agents:    CatalogueAgent[];
}

interface CatalogueAgent {
  slug:             string;
  agentType:        'specialized' | 'direct';
  displayName:      string;
  iconUrl:          string | null;
  shortDescription: string;
  longDescription:  string;
  tags:             string[];
  examplePrompts:   string[];
  isAutoEligible:   boolean;
  maxContextTokens: number;
  costMultiplier:   number;

  // Primary model shown in the UI (first healthy in priority list; or directModelId for direct)
  primaryModel: {
    modelId:      string;
    displayName:  string;
    provider:     string;
    iconUrl:      string | null;
    healthStatus: 'healthy' | 'degraded' | 'down';
  };

  isDirect: boolean;  // true when agentType = 'direct' — frontend can adjust UI accordingly
}
```

### Example Response (condensed)

```json
{
  "modes": {
    "auto":  { "available": true },
    "agent": { "available": true }
  },
  "categories": [
    {
      "slug": "research",
      "name": "Research",
      "iconUrl": null,
      "sortOrder": 1,
      "agents": [
        {
          "slug": "research",
          "agentType": "specialized",
          "displayName": "Research Agent",
          "iconUrl": "https://cdn.example.com/agents/research.svg",
          "shortDescription": "Deep web research with source citations",
          "longDescription": "Searches the web across multiple sources, synthesises findings, and cites every claim inline.",
          "tags": ["web-search", "citations"],
          "examplePrompts": [
            "What are the latest advances in quantum computing?",
            "Compare GPT-4o and Claude Sonnet 4.6 for coding tasks"
          ],
          "isAutoEligible": true,
          "maxContextTokens": 80000,
          "costMultiplier": 1.5,
          "isDirect": false,
          "primaryModel": {
            "modelId": "claude-sonnet-4-6",
            "displayName": "Claude Sonnet 4.6",
            "provider": "anthropic",
            "iconUrl": "https://cdn.example.com/providers/anthropic.svg",
            "healthStatus": "healthy"
          }
        }
      ]
    },
    {
      "slug": "direct-models",
      "name": "Direct Models",
      "iconUrl": null,
      "sortOrder": 99,
      "agents": [
        {
          "slug": "claude-opus-direct",
          "agentType": "direct",
          "displayName": "Claude Opus 4.7",
          "iconUrl": "https://cdn.example.com/providers/anthropic.svg",
          "shortDescription": "Talk directly to Claude Opus 4.7",
          "longDescription": "Frontier-class reasoning and instruction following. No agent wrapper — raw model access.",
          "tags": ["frontier", "reasoning"],
          "examplePrompts": [
            "Explain the trade-offs between microservices and monoliths",
            "Write a detailed technical spec for a payment system"
          ],
          "isAutoEligible": false,
          "maxContextTokens": 200000,
          "costMultiplier": 1.0,
          "isDirect": true,
          "primaryModel": {
            "modelId": "claude-opus-4-7",
            "displayName": "Claude Opus 4.7",
            "provider": "anthropic",
            "iconUrl": "https://cdn.example.com/providers/anthropic.svg",
            "healthStatus": "healthy"
          }
        }
      ]
    }
  ]
}
```

### Additional User Endpoints

```
GET /api/v1/catalogue/agents/:slug    → single agent detail (slug must be in user's plan)
```

---

## 12. Admin Management API

### 12.1 Providers

```
GET    /admin/providers                                → list all providers with ENV key status + model counts
PATCH  /admin/providers/:id                            → toggle isActive (is_key_present is read-only)
POST   /admin/providers/:id/fetch-models               → trigger model fetch from provider API
GET    /admin/providers/:id/fetched-models             → paginated results of last fetch
```

### 12.2 LLM Registry

```
GET    /admin/models                                   → list all models (filter: provider, tier, status)
POST   /admin/models/import                            → import selected models from a fetch result
POST   /admin/models                                   → manually create a model record
PATCH  /admin/models/:id                               → update any field (rate, tier, icon, status, etc.)
DELETE /admin/models/:id                               → soft-delete (sets isActive = false)
```

### 12.3 Agent Categories

```
GET    /admin/agent-categories                         → list all categories
POST   /admin/agent-categories                         → create category
PATCH  /admin/agent-categories/:id                     → update name, icon, sortOrder, description
DELETE /admin/agent-categories/:id                     → soft-delete (hides agents; does not delete them)
```

### 12.4 Agents

```
GET    /admin/agents                                   → list all agents (filter: type, category, status)
POST   /admin/agents                                   → create agent (specialized or direct)
PATCH  /admin/agents/:id                               → update any agent field
DELETE /admin/agents/:id                               → soft-delete (sets isActive = false)
POST   /admin/agents/:id/test                          → send a test query through the agent

-- Model priority list (specialized agents only)
GET    /admin/agents/:id/model-priorities              → list priority entries
POST   /admin/agents/:id/model-priorities              → add a model to the list
PATCH  /admin/agents/:id/model-priorities/:pid         → update priority, toggle isActive, update notes
DELETE /admin/agents/:id/model-priorities/:pid         → remove entry
POST   /admin/agents/:id/model-priorities/reorder      → bulk reorder via [{ id, priority }]
```

### 12.5 System Model Configuration

```
GET    /admin/system/model-config                      → all three tier configs (light, medium, high)
PATCH  /admin/system/model-config/:tier                → replace ordered list for a tier
POST   /admin/system/model-config/:tier/reorder        → reorder entries via [{ modelId, priority }]
```

### `POST /admin/agents` Body

```typescript
interface CreateAgentBody {
  agentType:          'specialized' | 'direct';
  categoryId:         string;
  slug:               string;               // unique, kebab-case
  displayName:        string;
  iconUrl?:           string;
  shortDescription:   string;
  longDescription?:   string;
  tags?:              string[];
  examplePrompts?:    string[];
  systemPrompt?:      string;               // empty string acceptable for direct type
  maxContextTokens:   number;
  maxContextMessages: number;
  costMultiplier?:    number;               // default 1.0
  isAutoEligible?:    boolean;              // default: true for specialized, false for direct
  isVisible?:         boolean;              // default: true
  sortOrder?:         number;

  // Required when agentType = 'direct'
  directModelId?:     string;

  // Required when agentType = 'specialized' (at least 1 entry)
  modelPriorities?:   Array<{
    modelId:    string;
    priority:   number;
    isActive?:  boolean;
    notes?:     string;
  }>;
}
```

---

## 13. Redis Caching Strategy

```
catalogue:{userId}:{planId}               → CatalogueResponse (plan-filtered, per user)
  TTL: 5 minutes
  Invalidated by: plan change, any agent write, any model health change, category change

catalogue:agents:all                      → all active agents, unfiltered (admin list)
  TTL: 5 minutes
  Invalidated by: any agent write

catalogue:agent:priorities:{agentSlug}   → AgentModelPriority[] ordered by priority ASC
  TTL: 5 minutes
  Invalidated by: priority list change for this agent, model health/status change

catalogue:auto:eligible-agents            → agents where isAutoEligible=true, isActive=true
  TTL: 5 minutes
  Invalidated by: any change to agent.isAutoEligible or agent.isActive

system:model-config                       → SystemModelConfig (all three tiers)
  TTL: 5 minutes
  Invalidated by: any PATCH to /admin/system/model-config

providers:all                             → Provider[] with isKeyPresent resolved
  TTL: 60 minutes (ENV keys only change on restart)
```

### Cache Invalidation on Admin Writes

| Action | Keys Invalidated |
|---|---|
| Create / update / delete agent | `catalogue:agents:all`, `catalogue:auto:eligible-agents`, `catalogue:{userId}:*` (all users) |
| Update agent priority list | `catalogue:agent:priorities:{slug}`, `catalogue:{userId}:*` |
| Update model `isActive` or `healthStatus` | `catalogue:agent:priorities:*`, `system:model-config`, `catalogue:{userId}:*` |
| Update system model config tier | `system:model-config` |
| Toggle provider `isActive` | `providers:all`, `catalogue:{userId}:*` |
| Create / update agent category | `catalogue:agents:all`, `catalogue:{userId}:*` |

---

## 14. Database Schema

### New Tables

```sql
-- Providers (seeded by migration, updated by providerSync on startup)
CREATE TABLE providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,       -- 'anthropic' | 'openai' | 'google' | 'deepseek' | 'xai'
  display_name    TEXT NOT NULL,
  icon_url        TEXT,
  api_base_url    TEXT NOT NULL,
  env_key_name    TEXT NOT NULL,              -- e.g. 'ANTHROPIC_API_KEY'
  is_key_present  BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed all supported providers
INSERT INTO providers (slug, display_name, api_base_url, env_key_name) VALUES
  ('anthropic', 'Anthropic', 'https://api.anthropic.com',                         'ANTHROPIC_API_KEY'),
  ('openai',    'OpenAI',    'https://api.openai.com',                             'OPENAI_API_KEY'),
  ('google',    'Google',    'https://generativelanguage.googleapis.com',           'GEMINI_API_KEY'),
  ('deepseek',  'DeepSeek',  'https://api.deepseek.com',                           'DEEPSEEK_API_KEY'),
  ('xai',       'xAI',       'https://api.x.ai',                                   'XAI_API_KEY')
ON CONFLICT (slug) DO NOTHING;


-- Agent categories (admin-managed, no fixed enum)
CREATE TABLE agent_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  icon_url    TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Agent model priority list (specialized agents only)
CREATE TABLE agent_model_priorities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL,                -- references ai_models.model_id
  priority    INT NOT NULL CHECK (priority >= 1),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, priority),
  UNIQUE (agent_id, model_id)
);

CREATE INDEX idx_amp_agent_priority ON agent_model_priorities (agent_id, priority)
  WHERE is_active = true;


-- System model configuration (one row per tier, seeded below)
CREATE TABLE system_model_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier        TEXT NOT NULL UNIQUE,         -- 'light' | 'medium' | 'high'
  models      JSONB NOT NULL DEFAULT '[]',  -- [{ modelId, priority, isActive, notes }]
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_model_config (tier, models) VALUES
  ('light',  '[]'),
  ('medium', '[]'),
  ('high',   '[]')
ON CONFLICT (tier) DO NOTHING;
```

### Modified Tables

```sql
-- ai_models: add provider FK and display / metadata columns
ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS provider_id      UUID REFERENCES providers(id),
  ADD COLUMN IF NOT EXISTS icon_url         TEXT,
  ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS long_description  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tags              TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS context_window    INT,
  ADD COLUMN IF NOT EXISTS max_output_tokens INT,
  ADD COLUMN IF NOT EXISTS capabilities      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_order        INT NOT NULL DEFAULT 0;
-- Note: existing ai_models.provider (TEXT) is superseded by provider_id FK.
-- Keep for backward compat during migration; drop after backfill is complete.


-- agents: add type, category, display, context, cost fields
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS agent_type           TEXT NOT NULL DEFAULT 'specialized',
  ADD COLUMN IF NOT EXISTS category_id          UUID REFERENCES agent_categories(id),
  ADD COLUMN IF NOT EXISTS icon_url             TEXT,
  ADD COLUMN IF NOT EXISTS short_description    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS long_description     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS example_prompts      JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS tags                 TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_order           INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_visible           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_auto_eligible     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cost_multiplier      NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS max_context_tokens   INT NOT NULL DEFAULT 80000,
  ADD COLUMN IF NOT EXISTS max_context_messages INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS direct_model_id      TEXT;
  -- direct_model_id: non-null only when agent_type = 'direct'
  -- allowed_tools is NOT on agents — tool access is entirely plan-controlled (Module 3)


-- plans: deprecate model_access (plans only reference agentAccess now)
ALTER TABLE plans
  ALTER COLUMN model_access SET DEFAULT NULL;
-- model_access is no longer read by the application; retained for historical data only.


-- usage_records: track which interaction mode was used
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS interaction_mode TEXT DEFAULT 'auto';
  -- 'auto' | 'agent'


-- Backfill: seed agent_model_priorities from existing agents.default_model_id
INSERT INTO agent_model_priorities (agent_id, model_id, priority)
  SELECT id, default_model_id, 1
  FROM agents
  WHERE default_model_id IS NOT NULL
ON CONFLICT DO NOTHING;
```

---

## 15. Folder Structure

```
src/
├── startup/
│   └── providerSync.ts                  ← runs on boot; updates providers.is_key_present from ENV
│
├── services/
│   ├── provider.service.ts              ← provider CRUD + isActive toggle
│   ├── modelFetch.service.ts            ← calls provider model list APIs → FetchedModel[]
│   ├── agentCategory.service.ts         ← CRUD for agent_categories
│   ├── agentModelPriority.service.ts    ← CRUD for agent_model_priorities
│   ├── catalogue.service.ts             ← builds CatalogueResponse, applies plan filter, caches
│   └── systemModelConfig.service.ts     ← reads/writes system_model_config; exposes resolve(tier)
│
├── routes/
│   ├── user/
│   │   └── catalogue.routes.ts          ← GET /catalogue, GET /catalogue/agents/:slug
│   └── admin/
│       ├── providers.routes.ts          ← provider list, isActive toggle, fetch-models trigger
│       ├── models.routes.ts             ← extended: import, manual create, full update, delete
│       ├── agentCategories.routes.ts    ← category CRUD
│       ├── agents.routes.ts             ← extended: create, full update, priority sub-routes
│       └── systemModelConfig.routes.ts  ← tier config management
│
└── cache/
    └── catalogueCache.ts                ← invalidation helpers used by all admin write services
```

---

## 16. Layer Integration Summary

### Changes to Layer 2

| Module | Change |
|---|---|
| Module 2 (Plan) | `model_access` deprecated; `agent_access` is the only access control for agents and models |
| Module 3 (Feature Flags) | `modelPicker` flag retired; direct-type agent on plan replaces it. Tool feature flags unchanged — they remain the sole tool gate |
| Module 9 (Sanitiser) | Validate `mode` field; validate `agentSlug` exists in `plan.agentAccess`; reject `agentSlug` where `agent.isActive = false` |
| Module 10 (Smart Router) | `mode='auto'`: pick from `catalogue:auto:eligible-agents` filtered to plan; `mode='agent'`: bypass router entirely |
| Module 11 (User API) | Add `GET /catalogue`, `GET /catalogue/agents/:slug` |
| Module 12 (Admin API) | Add providers, agent categories, model import flow, agent priority sub-routes, system model config endpoints |
| Module 6 (Usage Tracking) | Add `interaction_mode` column to `usage_records` |

### Changes to Layer 3

| Module | Change |
|---|---|
| Module 13 (Agent Runtime) | Check `agent.agentType`: specialized iterates priority list; direct uses `directModelId` with hard-fail on down |
| Module 15 (Provider Layer) | Specialized: iterate `agent_model_priorities` in priority order with health filter. Direct: single model, no retry |
| Module 16 (Prompt Assembly) | Filter tool definitions to plan-allowed tools before sending to LLM; enforce `agent.maxContextTokens` and `agent.maxContextMessages` |
| Module 22 (Subagents) | Replace any hard-coded model references with `systemModelConfig.resolve('high')` |

### No Change Required

| Module | Reason |
|---|---|
| Module 3 (Feature Flags) | Tool feature flags and usage quotas remain exactly as designed — they are now the **only** tool gate |
| Module 4 (Credit Wallet) | Credit formula unchanged: `ceil((tokens / 1000) × model.creditRate × agent.costMultiplier × plan.discount)` |
| Module 7 (Queue) | `ChatJob.payload.agentSlug` and `modelId` fields already exist; `interaction_mode` added to payload |
| Module 14 (Tool System) | Tool executor already checks plan flags; adds `TOOL_NOT_ON_PLAN` error code for filtered calls |

---

*This document amends `LAYER2_API_GATEWAY.md` (Modules 2, 3, 9, 10, 11, 12) and `LAYER3_AGENT_EXECUTION.md` (Modules 13, 15, 16, 22). The `modelPicker` feature flag and `plan.modelAccess` are retired. All references to them in those documents should be treated as superseded by this spec.*
