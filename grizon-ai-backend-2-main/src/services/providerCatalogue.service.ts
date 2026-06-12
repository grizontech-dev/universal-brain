// Fetch the list of available models directly from an LLM provider's public API.
// Used by the admin "Sync Models" flow to surface models the operator hasn't
// imported into ai_models yet.

import { AppError } from "../utils/errors.js";

export type ProviderModelInfo = {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: string[];
};

type ProviderSlug = "anthropic" | "openai" | "google" | "deepseek" | "xai";

function badGateway(slug: string, status: number, body: string): AppError {
  return new AppError({
    status: 502,
    code: "PROVIDER_FETCH_FAILED",
    message: `Failed to fetch models from ${slug} (HTTP ${status}).`,
    details: { providerSlug: slug, status, body: body.slice(0, 500) },
  });
}

function unsupportedProvider(slug: string): AppError {
  return new AppError({
    status: 400,
    code: "PROVIDER_NOT_SUPPORTED",
    message: `Provider "${slug}" does not support model sync yet.`,
  });
}

function inferCapabilitiesFromId(id: string): string[] {
  const caps = new Set<string>(["text"]);
  const lower = id.toLowerCase();
  if (
    lower.includes("vision") ||
    lower.includes("4o") ||
    lower.includes("gpt-4") ||
    lower.includes("claude") ||
    lower.includes("gemini")
  ) {
    caps.add("vision");
  }
  if (
    lower.includes("gpt") ||
    lower.includes("claude") ||
    lower.includes("gemini") ||
    lower.includes("deepseek-chat")
  ) {
    caps.add("tools");
  }
  if (lower.includes("reasoner") || lower.includes("o1") || lower.includes("o3")) {
    caps.add("reasoning");
  }
  return Array.from(caps);
}

async function fetchAnthropic(apiKey: string, baseUrl: string): Promise<ProviderModelInfo[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw badGateway("anthropic", res.status, await res.text());
  const json = (await res.json()) as { data?: Array<{ id?: string; display_name?: string }> };
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .filter((m) => typeof m.id === "string")
    .map<ProviderModelInfo>((m) => ({
      modelId: m.id as string,
      displayName: m.display_name?.trim() || (m.id as string),
      contextWindow: null,
      maxOutputTokens: null,
      capabilities: inferCapabilitiesFromId(m.id as string),
    }));
}

async function fetchOpenAI(apiKey: string, baseUrl: string): Promise<ProviderModelInfo[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw badGateway("openai", res.status, await res.text());
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .filter((m) => typeof m.id === "string")
    .map<ProviderModelInfo>((m) => ({
      modelId: m.id as string,
      displayName: m.id as string,
      contextWindow: null,
      maxOutputTokens: null,
      capabilities: inferCapabilitiesFromId(m.id as string),
    }));
}

async function fetchGoogle(apiKey: string, baseUrl: string): Promise<ProviderModelInfo[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw badGateway("google", res.status, await res.text());
  const json = (await res.json()) as {
    models?: Array<{
      name?: string;
      displayName?: string;
      inputTokenLimit?: number;
      outputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }>;
  };
  const rows = Array.isArray(json.models) ? json.models : [];
  return rows
    .filter((m) => typeof m.name === "string")
    .map<ProviderModelInfo>((m) => {
      // name comes as "models/gemini-1.5-flash" — strip the prefix for modelId.
      const fullName = m.name as string;
      const modelId = fullName.replace(/^models\//, "");
      const supports = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      const caps = new Set<string>(["text"]);
      if (supports.includes("generateContent") || supports.includes("streamGenerateContent")) {
        caps.add("tools");
      }
      if (modelId.toLowerCase().includes("vision") || modelId.toLowerCase().includes("gemini")) {
        caps.add("vision");
      }
      return {
        modelId,
        displayName: m.displayName?.trim() || modelId,
        contextWindow: typeof m.inputTokenLimit === "number" ? m.inputTokenLimit : null,
        maxOutputTokens: typeof m.outputTokenLimit === "number" ? m.outputTokenLimit : null,
        capabilities: Array.from(caps),
      };
    });
}

async function fetchOpenAICompatible(
  slug: string,
  apiKey: string,
  baseUrl: string,
): Promise<ProviderModelInfo[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw badGateway(slug, res.status, await res.text());
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .filter((m) => typeof m.id === "string")
    .map<ProviderModelInfo>((m) => ({
      modelId: m.id as string,
      displayName: m.id as string,
      contextWindow: null,
      maxOutputTokens: null,
      capabilities: inferCapabilitiesFromId(m.id as string),
    }));
}

export const providerCatalogueService = {
  async listProviderModels(
    providerSlug: string,
    apiKey: string,
    baseUrl: string,
  ): Promise<ProviderModelInfo[]> {
    const slug = providerSlug as ProviderSlug;
    switch (slug) {
      case "anthropic":
        return fetchAnthropic(apiKey, baseUrl);
      case "openai":
        return fetchOpenAI(apiKey, baseUrl);
      case "google":
        return fetchGoogle(apiKey, baseUrl);
      case "deepseek":
        return fetchOpenAICompatible("deepseek", apiKey, baseUrl);
      case "xai":
        return fetchOpenAICompatible("xai", apiKey, baseUrl);
      default:
        throw unsupportedProvider(providerSlug);
    }
  },
};
