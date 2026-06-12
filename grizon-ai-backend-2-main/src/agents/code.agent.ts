import type { AgentDescriptor } from "../types/router.js";

/** @deprecated Static reference only — active routing reads from DB via agentLoader. */
export const codeAgent: AgentDescriptor = {
  slug: "code",
  displayName: "",
  description: "",
  systemPrompt:
    "You are a coding assistant. Prefer readable, idiomatic code and explain trade-offs briefly.",
  allowedTools: ["codeExecution", "documentAnalysis"],
  modelPriority: [],
  fallbackAgent: "chat",
  costMultiplier: 1.2,
  maxToolRounds: 10,
  maxTokensPerMessage: null,
  maxContextMessages: null,
  isSystem: true,
  isAutoEligible: false,
};
