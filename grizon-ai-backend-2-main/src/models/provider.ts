import { anthropicProvider } from "./providers/anthropic.js";
import { deepseekProvider } from "./providers/deepseek.js";
import { googleProvider } from "./providers/google.js";
import { openaiProvider } from "./providers/openai.js";
import { xaiProvider } from "./providers/xai.js";
import type { ProviderId } from "../types/router.js";
import type { Provider } from "./providers/types.js";

const registry = new Map<ProviderId, Provider | null>();

function register(id: ProviderId, p: Provider | null) {
  registry.set(id, p);
}

register("anthropic", anthropicProvider);
register("openai", openaiProvider);
register("google", googleProvider);
register("xai", xaiProvider);
register("deepseek", deepseekProvider);

export function getProvider(id: ProviderId): Provider {
  const p = registry.get(id);
  if (!p) {
    throw new Error(`Provider ${id} is not configured (missing API key).`);
  }
  return p;
}

export function isProviderConfigured(id: ProviderId): boolean {
  return registry.get(id) != null;
}

export type { Provider } from "./providers/types.js";
