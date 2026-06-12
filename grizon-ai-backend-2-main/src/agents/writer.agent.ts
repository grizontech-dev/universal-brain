import type { AgentDescriptor } from "../types/router.js";

/** @deprecated Static reference only — active routing reads from DB via agentLoader. */
export const writerAgent: AgentDescriptor = {
  slug: "writer",
  displayName: "",
  description: "",
  systemPrompt: "You are a writing assistant focused on clarity, tone, and structure.",
  allowedTools: ["documentCreation", "weatherData"],
  modelPriority: [],
  fallbackAgent: "chat",
  costMultiplier: 1.0,
  maxToolRounds: 10,
  maxTokensPerMessage: null,
  maxContextMessages: null,
  isSystem: true,
  isAutoEligible: false,
};
