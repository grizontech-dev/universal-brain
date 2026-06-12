import type { AgentDescriptor } from "../types/router.js";

/** @deprecated Static reference only — active routing reads from DB via agentLoader. */
export const chatAgent: AgentDescriptor = {
  slug: "chat",
  displayName: "General Assistant",
  description: "",
  systemPrompt:
    "You are a helpful assistant. Be concise, accurate, and friendly. Follow the user's instructions.",
  allowedTools: ["weatherData", "stockData"],
  modelPriority: [],
  fallbackAgent: null,
  costMultiplier: 1.0,
  maxToolRounds: 10,
  maxTokensPerMessage: null,
  maxContextMessages: null,
  isSystem: true,
  isAutoEligible: false,
};
