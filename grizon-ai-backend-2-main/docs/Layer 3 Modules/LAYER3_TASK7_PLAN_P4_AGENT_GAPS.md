# Layer 3 Task 7 — P4: Agent Runtime Gaps
## Implementation Plan

> **Priority:** P4 — Improves agent quality; depends on P1 (tools) being complete  
> **Depends on:** P1 (web_fetch, tool registry), P3 (health monitor)  
> **Last Updated:** 2026-05-09

---

## Table of Contents
1. [Overview](#1-overview)
2. [4.1 deep_research Agent Descriptor](#2-41-deep_research-agent-descriptor)
3. [4.2 Research Agent Citation PostProcess](#3-42-research-agent-citation-postprocess)
4. [4.3 Agent Tool Enforcement in Loop](#4-43-agent-tool-enforcement-in-loop)
5. [4.4 Agent Hook Architecture (preflight + postProcess)](#5-44-agent-hook-architecture-preflight--postprocess)
6. [Files Changed / Created](#6-files-changed--created)

---

## 1. Overview

Three gaps confirmed by the audit:

| Gap | Impact |
|---|---|
| `deep_research` agent: no descriptor file | `agentDispatcher.ts` routes to it but it doesn't exist → runtime error |
| Research citation insertion: not happening | Research agent returns text without `[1][2]` citations even though sources are retrieved |
| Agent tool enforcement: not enforced | LLM can call any tool regardless of `allowedTools` in agent descriptor |

Additionally, the agent system is pure config (no hooks), meaning there's no structured way to add pre-flight checks or post-processing. This task adds a lightweight hook pattern without restructuring the working pipeline.

---

## 2. 4.1 deep_research Agent Descriptor

**File:** `src/agents/deep_research.agent.ts` (new)

### Agent spec
- Slug: `deep_research`
- Intent mapping: routes from `search` intent when complexity = `complex` (set in `agentDispatcher.ts`)
- Tools: `web_search` (priority high), `web_fetch`, `file_read`
- Model tier: `premium`
- Plan: `pro`
- Max iterations: 10 (highest — does multi-step research)
- Agent multiplier: `2.0×` (as per credit formula in Layer 2)
- Subagent usage: yes — spawns `summarise_pages` subagent per fetched URL (handled by research loop in worker)

```typescript
import { AgentDescriptor } from './types';

export const deepResearchAgent: AgentDescriptor = {
  slug: 'deep_research',
  displayName: 'Deep Research',
  description:
    'Multi-step research agent that searches, fetches, and synthesises information from multiple sources. Use for complex research questions requiring depth.',
  defaultModelTier: 'premium',
  allowedTools: ['web_search', 'web_fetch', 'file_read', 'file_gen'],
  planRequired: 'pro',
  agentMultiplierKey: 'deep_research',    // 2.0× from credit table
  maxIterations: 10,
  systemPrompt: `You are a Deep Research Agent. Your job is to conduct thorough, multi-step research.

RESEARCH PROCESS:
1. First, search for the topic using web_search with priority="high"
2. Identify the 3-5 most relevant URLs from search results
3. Use web_fetch to read each relevant URL in full
4. Synthesise information across all sources
5. Present findings with inline citations [1], [2], etc.

STRICT GROUNDING RULE:
Only state facts that appear in the retrieved sources. Do not use training knowledge to fill gaps.
If a source does not contain the answer, say so explicitly.

CITATION FORMAT:
Every factual claim must end with [n] where n is the source number.
List all sources at the end under ## Sources.

OUTPUT FORMAT:
## Summary
[2-3 sentence overview]

## Findings
[Detailed findings with citations]

## Sources
[1] URL — Title
[2] URL — Title`,

  fallbackAgent: 'research',
};
```

### Update `src/agents/index.ts`
```typescript
import { deepResearchAgent } from './deep_research.agent';

export const AGENT_CATALOGUE: Record<string, AgentDescriptor> = {
  // ...existing...
  deep_research: deepResearchAgent,
};
```

### Update `src/router/agentDispatcher.ts`
```typescript
// Route complex search queries to deep_research
if (intent === 'search' && complexity === 'complex' && planAllows('deep_research')) {
  return 'deep_research';
}
// Previously just returned 'research' for all search intents
```

---

## 3. 4.2 Research Agent Citation PostProcess

### Problem
The research agent retrieves web search results (URLs, snippets, titles). These are passed to the LLM as `RETRIEVED CONTEXT`. The LLM is instructed to cite `[1][2]` but:
1. The system prompt instructs citation but there's no enforcement
2. The source list (URL → number mapping) is not being assembled and appended
3. No postProcess hook exists to inject a formatted source list

### Solution: Add postProcess citation assembly

**Approach:**  
After the LLM stream completes (in `chat.worker.ts`), check if `agentSlug === 'research' || agentSlug === 'deep_research'`. If so, extract the tool call results (web_search results stored on the job), build a source list, and append it to the response.

**Step 1: Store search results on the job context**

In `chat.worker.ts`, when `web_search` tool result is received, accumulate citations:
```typescript
// In the tool result handling block:
const citations: Citation[] = [];

if (toolName === 'web_search' && result.ok && result.data?.results) {
  const newCitations = result.data.results.map((r: any, i: number) => ({
    index: citations.length + i + 1,
    url: r.url,
    title: r.title,
    source: r.source,
  }));
  citations.push(...newCitations);
}
```

**Step 2: PostProcess — append source list**
```typescript
// After stream completion, before finalising message content:
function applyResearchPostProcess(
  content: string,
  citations: Citation[],
  agentSlug: string
): string {
  if (!['research', 'deep_research'].includes(agentSlug)) return content;
  if (citations.length === 0) return content;

  // Don't duplicate if LLM already appended sources
  if (content.includes('## Sources') || content.includes('**Sources**')) return content;

  const sourceList = citations
    .map(c => `[${c.index}] [${c.title}](${c.url})`)
    .join('\n');

  return `${content}\n\n---\n**Sources**\n${sourceList}`;
}
```

**Step 3: Store citations on message record**
```typescript
// In message finalisation:
await messageService.update(messageId, {
  content: postProcessedContent,
  citations: JSON.stringify(citations),   // already a JSONB column
});
```

---

## 4. 4.3 Agent Tool Enforcement in Loop

### Problem
`chat.worker.ts` calls `executeTool(toolName, params, ctx)` but does not check whether `toolName` is in `agentDescriptor.allowedTools`. A hallucinating LLM could call `code_execution` from the `chat` agent (which has no tools at all).

### Fix in `src/workers/chat.worker.ts`

After P1 adds `executeTool(name, params, ctx, allowedTools)` to the executor, pass the current agent's allowed tools:

```typescript
// Fetch agent descriptor early in job processing:
const agentDescriptor = getAgent(routingDecision.agentSlug);
const allowedTools: ToolName[] = agentDescriptor?.allowedTools ?? [];

// In tool call handling block:
const toolResult = await executeTool(
  toolCallEvent.toolId as ToolName,
  toolCallEvent.arguments,
  toolCtx,
  allowedTools     // ← new parameter
);

// executor.ts already returns an error ToolResult if not in allowedTools
// The error is sent back to LLM as tool_result with ok: false
// LLM then responds without the tool
```

This is a non-fatal enforcement — the LLM receives the error and can continue the conversation. It will not throw or crash the job.

---

## 5. 4.4 Agent Hook Architecture (preflight + postProcess)

### Design
Rather than restructuring agents into classes, add two optional hook fields to `AgentDescriptor`:

```typescript
export interface AgentDescriptor {
  slug: string;
  displayName: string;
  description: string;
  defaultModelTier: ModelTier;
  allowedTools: ToolName[];
  planRequired: PlanSlug;
  agentMultiplierKey: string;
  maxIterations?: number;
  systemPrompt: string;
  fallbackAgent?: string;

  // Optional hooks
  preflight?: (query: string, ctx: PreflightContext) => PreflightResult;
  postProcess?: (content: string, ctx: PostProcessContext) => string;
}

interface PreflightContext {
  userId: string;
  planSlug: string;
  messageCount: number;
}

interface PreflightResult {
  ok: boolean;
  reason?: string;    // shown to user if ok: false
}

interface PostProcessContext {
  agentSlug: string;
  citations: Citation[];
  toolCallCount: number;
}
```

### Usage in `chat.worker.ts`

```typescript
// Before assembling prompt:
if (agentDescriptor.preflight) {
  const preflightResult = agentDescriptor.preflight(userQuery, {
    userId: job.data.userId,
    planSlug: plan.slug,
    messageCount: conversation.messageCount,
  });
  if (!preflightResult.ok) {
    // Return immediately with preflightResult.reason as response
    // No LLM call, no credit deduction
    await publishSSE(jobId, { event: 'error', data: { code: 'PREFLIGHT_FAILED', message: preflightResult.reason } });
    return;
  }
}

// After stream completion:
let finalContent = accumulatedContent;
if (agentDescriptor.postProcess) {
  finalContent = agentDescriptor.postProcess(finalContent, {
    agentSlug: routingDecision.agentSlug,
    citations,
    toolCallCount,
  });
}
```

### Example: research.agent.ts preflight
```typescript
preflight: (query, ctx) => {
  if (query.trim().length < 10) {
    return { ok: false, reason: 'Search query too short. Please provide more detail.' };
  }
  return { ok: true };
},
```

### Example: research.agent.ts postProcess
```typescript
postProcess: (content, ctx) => applyResearchPostProcess(content, ctx.citations, ctx.agentSlug),
```

This keeps agents as config objects while adding extensibility for the two most needed hooks.

---

## 6. Files Changed / Created

| File | Action |
|---|---|
| `src/agents/deep_research.agent.ts` | **Create** — full descriptor with system prompt |
| `src/agents/index.ts` | **Modify** — register deep_research agent |
| `src/agents/types.ts` | **Modify** — add preflight, postProcess, maxIterations fields to AgentDescriptor |
| `src/agents/research.agent.ts` | **Modify** — add preflight + postProcess hooks |
| `src/agents/deep_research.agent.ts` | **Create** — includes postProcess for citations |
| `src/router/agentDispatcher.ts` | **Modify** — route complex search to deep_research |
| `src/workers/chat.worker.ts` | **Modify** — tool enforcement, citation accumulation, preflight + postProcess calls |
