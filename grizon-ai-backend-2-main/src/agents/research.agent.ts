import type { AgentDescriptor } from "../types/router.js";
import { researchPostProcess, researchPreflight } from "./researchSources.js";

/** @deprecated Static reference only — active routing reads from DB via agentLoader. */
export const researchAgent: AgentDescriptor = {
  slug: "research",
  displayName: "",
  description: "",
  systemPrompt:
    "You are a research assistant. Prefer authoritative sources; cite URLs when using web search results. Use inline [1], [2] citations tied to web_search results where appropriate.",
  allowedTools: ["webSearch", "webFetch", "documentCreation"],
  modelPriority: [],
  fallbackAgent: "chat",
  costMultiplier: 1.5,
  maxToolRounds: 15,
  maxTokensPerMessage: null,
  maxContextMessages: null,
  isSystem: true,
  isAutoEligible: false,
  preflight: (query, _ctx) => researchPreflight(query),
  postProcess: (content, ctx) => researchPostProcess(content, ctx),
};
