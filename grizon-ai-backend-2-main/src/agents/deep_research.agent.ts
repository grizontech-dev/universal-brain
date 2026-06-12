import type { AgentDescriptor } from "../types/router.js";
import { researchPostProcess, researchPreflight } from "./researchSources.js";

/** @deprecated Static reference only — active routing reads from DB via agentLoader. */
export const deepResearchAgent: AgentDescriptor = {
  slug: "deep_research",
  displayName: "",
  description: "",
  systemPrompt: `You are a Deep Research Agent. Conduct thorough, multi-step research.

RESEARCH PROCESS:
1. Search using web_search with priority="high" when helpful for richer results.
2. Identify the most relevant URLs from search results (typically 3–5).
3. Use web_fetch to read key URLs in depth where needed.
4. Use file_read when the user attached documents or needs corpus context.
5. Synthesise across sources. Present findings with inline citations [1], [2], etc.

STRICT GROUNDING:
Only state facts supported by retrieved sources or attachments. If a source lacks the answer, say so.

CITATION FORMAT:
Factual claims should reference [n] matching the source index. You may list sources under ## Sources or **Sources**.

OUTPUT FORMAT (suggested):
## Summary
Brief overview.

## Findings
Detailed findings with [n] citations.

## Sources
[1] Title — URL`,
  allowedTools: ["webSearch", "webFetch", "documentAnalysis", "documentCreation"],
  modelPriority: [],
  fallbackAgent: "research",
  costMultiplier: 2.0,
  maxToolRounds: 20,
  maxTokensPerMessage: null,
  maxContextMessages: null,
  isSystem: true,
  isAutoEligible: false,
  preflight: (query, _ctx) => researchPreflight(query),
  postProcess: (content, ctx) => researchPostProcess(content, ctx),
};
