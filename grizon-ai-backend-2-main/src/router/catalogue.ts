import { env } from "../config/env.js";
import type { ModelDescriptor, ProviderId } from "../types/router.js";

/** Full catalogue; runtime selection filters by API keys via activeModelCatalogue(). */
export const MODEL_CATALOGUE: ModelDescriptor[] = [
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    tier: "nano",
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    tier: "standard",
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    tier: "frontier",
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    tier: "nano",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "gpt-4o",
    provider: "openai",
    tier: "premium",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "o1",
    provider: "openai",
    tier: "reasoning",
    contextWindow: 128_000,
    supportsTools: false,
    supportsStreaming: true,
    supportsPromptCache: false,
    supportsVision: false,
    active: true,
  },
  {
    id: "gemini-flash-lite",
    provider: "google",
    tier: "nano",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    tier: "standard",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    tier: "premium",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: true,
    supportsVision: true,
    active: true,
  },
  {
    id: "grok-2",
    provider: "xai",
    tier: "premium",
    contextWindow: 131_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: false,
    supportsVision: false,
    active: true,
  },
  {
    id: "grok-2-mini",
    provider: "xai",
    tier: "standard",
    contextWindow: 131_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: false,
    supportsVision: false,
    active: true,
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    tier: "nano",
    contextWindow: 64_000,
    supportsTools: true,
    supportsStreaming: true,
    supportsPromptCache: false,
    supportsVision: false,
    active: true,
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    tier: "reasoning",
    contextWindow: 64_000,
    supportsTools: false,
    supportsStreaming: true,
    supportsPromptCache: false,
    supportsVision: false,
    active: true,
  },
];

function providerHasApiKey(p: ProviderId): boolean {
  switch (p) {
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY);
    case "openai":
      return Boolean(env.OPENAI_API_KEY);
    case "google":
      return Boolean(env.GOOGLE_AI_API_KEY);
    case "xai":
      return Boolean(env.XAI_API_KEY);
    case "deepseek":
      return Boolean(env.DEEPSEEK_API_KEY);
    default:
      return false;
  }
}

/** Models whose provider has a configured API key. */
export function activeModelCatalogue(): ModelDescriptor[] {
  return MODEL_CATALOGUE.filter((m) => m.active && providerHasApiKey(m.provider));
}

// AGENT_CATALOGUE removed — use getAgentDescriptor() from agentLoader.service.ts instead.
