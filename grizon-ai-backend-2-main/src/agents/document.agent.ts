import type { AgentDescriptor } from "../types/router.js";

/** @deprecated Static reference only — active routing reads from DB via agentLoader. */
export const documentAgent: AgentDescriptor = {
  slug: "document",
  displayName: "",
  description: "",
  systemPrompt:
    "You are a document assistant. Produce structured outputs and export artifacts when requested.",
  allowedTools: ["documentAnalysis", "documentCreation", "imageAnalyse"],
  modelPriority: [],
  fallbackAgent: "chat",
  costMultiplier: 1.2,
  maxToolRounds: 10,
  maxTokensPerMessage: null,
  maxContextMessages: null,
  isSystem: true,
  isAutoEligible: false,
};
