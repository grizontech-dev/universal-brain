# Layer 3 Task 9 — P6: Phase 4 — New Agents & Power User Features
## Implementation Plan

> **Priority:** P6 — Phase 4 functionality; depends on P1, P4 being complete  
> **Depends on:** P1 (chart_generate, html_generate, stock_data tools), P4 (deep_research, hooks)  
> **Last Updated:** 2026-05-09

---

## Table of Contents
1. [Overview](#1-overview)
2. [6.1 Analyst Agent — CSV→Chart Pipeline](#2-61-analyst-agent--csvchard-pipeline)
3. [6.2 Architect Agent — Web Search + System Design Prompt](#3-62-architect-agent--web-search--system-design-prompt)
4. [6.3 UI Agent — HTML Output Pipeline](#4-63-ui-agent--html-output-pipeline)
5. [6.4 Model Picker — Enterprise Enforcement](#5-64-model-picker--enterprise-enforcement)
6. [6.5 Conversation Summarise Endpoint](#6-65-conversation-summarise-endpoint)
7. [Files Changed / Created](#7-files-changed--created)

---

## 1. Overview

Phase 4 items confirmed as not yet fully working end-to-end:

| Item | Current Gap |
|---|---|
| Analyst agent | Descriptor exists; `chart_generate` and `stock_data` tools missing (blocked by P1) |
| Architect agent | Descriptor exists; `web_search` not in allowedTools; frontier-tier prompt not tuned |
| UI agent | Descriptor exists; `html_generate` tool missing (blocked by P1); uses `file_gen` instead |
| Model picker | `POST /chat` accepts `modelId` but `modelSelector.ts` ignores it — no plan enforcement |
| Conversation summarise | `POST /conversations/:id/summarise` route exists in spec; not confirmed wired |

---

## 2. 6.1 Analyst Agent — CSV→Chart Pipeline

### Current state
`src/agents/analyst.agent.ts` has `allowedTools: ['code_execution', 'file_read', 'file_gen']`.  
`chart_generate` and `stock_data` are not in the list (they don't exist yet — P1 creates them).

### Changes after P1

**`src/agents/analyst.agent.ts`:**
```typescript
export const analystAgent: AgentDescriptor = {
  slug: 'analyst',
  displayName: 'Data Analyst',
  allowedTools: ['file_read', 'code_execution', 'chart_generate', 'stock_data', 'file_gen'],
  defaultModelTier: 'premium',
  planRequired: 'pro',
  agentMultiplierKey: 'analyst',
  maxIterations: 6,
  systemPrompt: `You are a Data Analyst AI. You analyse data, generate charts, and provide insights.

CAPABILITIES:
- Read and analyse uploaded CSV, Excel, or JSON files using file_read
- Write Python/pandas code using code_execution to transform and analyse data
- Generate charts (bar, line, pie, scatter, histogram) using chart_generate
- Fetch live stock market data using stock_data for financial analysis

WORKFLOW:
1. If a file is attached, use file_read to understand its structure
2. Use code_execution to compute statistics, filter, or transform data
3. Use chart_generate to visualise findings — prefer charts over raw tables
4. Always interpret the chart/data for the user, not just present it

OUTPUT FORMAT:
- Present key numbers first (headline stat)
- Follow with chart if applicable
- End with 2-3 actionable insights

IMPORTANT: When working with financial data, always cite the data source and timestamp.`,

  preflight: (query, ctx) => {
    // Analyst needs either file attachment or stock symbol to be useful
    return { ok: true };
  },
};
```

### CSV→Chart end-to-end flow
```
User uploads CSV → file.worker ingests → file ready
User: "Show me a bar chart of sales by region"
  → classifier: intent=analyse, complexity=medium
  → dispatcher: analyst agent
  → assembler: file context injected
  → LLM calls:
      1. file_read({ fileId, sub_query: "columns and sample rows" })
      2. code_execution({ language: "python", code: "import pandas as pd; df = pd.read_csv(...)" })
      3. chart_generate({ chart_type: "bar", data: {...}, title: "Sales by Region" })
  → chart_generate calls code_execution with matplotlib code
  → base64 PNG returned → image artifact created
  → artifact ID streamed back to client as { event: 'artifact', data: { artifactId, type: 'image' } }
  → LLM final response: "Here's the sales breakdown by region. [artifact reference]. Key insight: ..."
```

---

## 3. 6.2 Architect Agent — Web Search + System Design Prompt

### Current state
`src/agents/architect.agent.ts` has `allowedTools: ['file_read']` only. Per spec, it should have `web_search`. Model tier is `premium`; spec says `frontier`.

### Changes

**`src/agents/architect.agent.ts`:**
```typescript
export const architectAgent: AgentDescriptor = {
  slug: 'architect',
  displayName: 'Architecture Builder',
  allowedTools: ['web_search', 'file_read', 'file_gen'],
  defaultModelTier: 'frontier',          // upgraded from premium
  planRequired: 'pro',
  agentMultiplierKey: 'architect',       // 1.5× multiplier
  maxIterations: 6,
  systemPrompt: `You are a System Architecture AI. You design scalable, production-ready systems.

APPROACH:
- Produce concrete, opinionated recommendations — not generic advice
- Use web_search to check current best practices, library versions, benchmarks
- Justify every technology choice with a reason
- Always consider: scalability, cost, operational complexity, team capability

DELIVERABLES (choose based on request):
- Architecture diagrams as ASCII or Mermaid code blocks
- Component breakdowns (what each service does, why it exists)
- Technology stack with specific versions
- Data flow diagrams
- Migration plans (from current to target state)

OUTPUT FORMAT:
## Architecture Overview
[1 paragraph summary]

## Components
[Table or list with component → responsibility → technology]

## Data Flow
[Mermaid diagram or ASCII]

## Key Design Decisions
[Decision | Choice | Reason | Trade-off]

## Risks & Mitigations
[Table]`,
};
```

---

## 4. 6.3 UI Agent — HTML Output Pipeline

### Current state
`src/agents/ui.agent.ts` has `allowedTools: ['file_gen']`. This generates a generic file artifact, not an HTML preview. After P1 adds `html_generate`, the UI agent needs to be rewired.

### Changes after P1

**`src/agents/ui.agent.ts`:**
```typescript
export const uiAgent: AgentDescriptor = {
  slug: 'ui',
  displayName: 'UI Generator',
  allowedTools: ['html_generate'],        // replaced file_gen
  defaultModelTier: 'premium',
  planRequired: 'pro',
  agentMultiplierKey: 'ui',               // 1.3× multiplier
  maxIterations: 4,
  systemPrompt: `You are a UI Generator AI. You create clean, working HTML/CSS/JS interfaces.

RULES:
- Output complete, self-contained HTML (no external CDN dependencies unless explicitly requested)
- Use modern CSS (flexbox/grid) — no Bootstrap or Tailwind by default
- JavaScript should be vanilla or minimal (no React/Vue unless requested)
- The output will be rendered in a sandboxed iframe — no localStorage, cookies, or fetch calls

ALWAYS use html_generate to output the interface. Never output raw HTML in the chat message.

HTML TEMPLATE:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    /* Your styles here */
  </style>
</head>
<body>
  <!-- Your content here -->
  <script>
    // Your scripts here
  </script>
</body>
</html>

After generating, describe what you built in 1-2 sentences.`,

  postProcess: (content, ctx) => {
    // If LLM forgot to use html_generate and put raw HTML in chat, strip it
    if (content.includes('<!DOCTYPE html>')) {
      return content.replace(/<!DOCTYPE html>[\s\S]*?<\/html>/gi, '[HTML moved to artifact]').trim();
    }
    return content;
  },
};
```

### Preview flow (already wired in artifact service)
```
html_generate tool → artifactService.create({ type: 'html', contentText: sanitisedHtml })
  → preview.ts generatePreview('html') → stores previewHtml
  → client receives { event: 'artifact', data: { artifactId, type: 'html', previewHtml } }
  → frontend renders: <iframe sandbox="allow-scripts" srcdoc={previewHtml} />
```

---

## 5. 6.4 Model Picker — Enterprise Enforcement

### Current state
`POST /chat` payload accepts `modelId?: string` but `modelSelector.ts` ignores it — all requests go through auto-routing regardless of plan.

### Design

Only `enterprise` plan users with `featureFlags.modelPicker = true` can override the model.

**`src/router/modelSelector.ts`** — add override path:

```typescript
export async function selectModel(
  classification: ClassificationResult,
  plan: Plan,
  options: { requestedModelId?: string }
): Promise<RouterDecision> {
  // Enterprise model picker override
  if (
    options.requestedModelId &&
    plan.featureFlags?.modelPicker === true
  ) {
    // Validate: is the requested model in plan.modelAccess?
    const allowed = plan.modelAccess ?? [];
    if (!allowed.includes(options.requestedModelId)) {
      throw new AppError(
        403,
        'MODEL_NOT_ALLOWED',
        `Model '${options.requestedModelId}' is not available on your plan`
      );
    }

    // Fetch model from DB to get provider
    const model = await getModelById(options.requestedModelId);
    if (!model || !model.is_active) {
      throw new AppError(404, 'MODEL_NOT_FOUND', 'Requested model not found or inactive');
    }

    return {
      agentSlug: classification.suggestedAgent,
      modelId: model.model_id,
      modelProvider: model.provider as ProviderId,
      modelTier: model.tier as ModelTier,
      fallbacks: [],    // no fallback — user explicitly chose this model
      classificationResult: classification,
    };
  }

  // Normal auto-routing (existing logic)
  return autoSelectModel(classification, plan);
}
```

**`src/workers/chat.worker.ts`** — pass `requestedModelId` from job payload:
```typescript
const routingDecision = await runRouter(classification, plan, {
  requestedModelId: job.data.payload.modelId ?? undefined,
});
```

**`src/router/index.ts`** (`runRouter`) — pass options through to `selectModel`.

### Admin UI note
The model list for the Enterprise plan picker is `GET /api/v1/admin/models` (already exists). The frontend should filter by `plan.modelAccess`.

---

## 6. 6.5 Conversation Summarise Endpoint

### Current state
`POST /conversations/:id/summarise` is in the spec (Module 8) but the route handler may only be stubbed.

**File:** `src/controllers/user/conversation.controller.ts`

### Implementation

```typescript
async manualSummarise(req: Request, res: Response) {
  const { id: conversationId } = req.params;
  const userId = req.user.id;

  // Ownership check
  const conversation = await conversationService.getByIdForUser(conversationId, userId);
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND');

  // Check if there's enough to summarise (at least 10 messages)
  if ((conversation.messageCount ?? 0) < 10) {
    throw new AppError(400, 'TOO_FEW_MESSAGES', 'Need at least 10 messages to summarise');
  }

  // Run summariser (same service used by assembler.ts)
  const result = await summariserService.run(conversationId);

  return ok(res, {
    summarisedMessageCount: result.summarisedCount,
    summaryText: result.summaryText,
    tokensSaved: result.tokensSaved,
  });
}
```

Ensure `src/routes/user/conversation.routes.ts` has:
```typescript
router.post('/:id/summarise', auth, conversationController.manualSummarise);
```

---

## 7. Files Changed / Created

| File | Action |
|---|---|
| `src/agents/analyst.agent.ts` | **Modify** — add chart_generate, stock_data to allowedTools; tune system prompt |
| `src/agents/architect.agent.ts` | **Modify** — add web_search, upgrade to frontier tier, tune system prompt |
| `src/agents/ui.agent.ts` | **Modify** — replace file_gen with html_generate; add postProcess hook |
| `src/router/modelSelector.ts` | **Modify** — add Enterprise model picker override path |
| `src/router/index.ts` | **Modify** — pass requestedModelId option to selectModel |
| `src/workers/chat.worker.ts` | **Modify** — pass job.data.payload.modelId to runRouter |
| `src/controllers/user/conversation.controller.ts` | **Modify** — implement manualSummarise handler |
| `src/routes/user/conversation.routes.ts` | **Verify/Modify** — ensure POST /:id/summarise is registered |
