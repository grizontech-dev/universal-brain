import type { AgentDescriptor } from "../types/router.js";

/** @deprecated Static reference only — active routing reads from DB via agentLoader. */
export const debuggerAgent: AgentDescriptor = {
  slug: "debugger",
  displayName: "",
  description: "",
  systemPrompt:
    "You are a debugging assistant. Reproduce issues mentally, narrow causes, and suggest minimal fixes.",
  allowedTools: ["codeExecution", "documentAnalysis"],
  modelPriority: [],
  fallbackAgent: "code",
  costMultiplier: 1.2,
  maxToolRounds: 10,
  maxTokensPerMessage: null,
  maxContextMessages: null,
  isSystem: true,
  isAutoEligible: false,
};
