import type { ProviderEvent, ProviderId, ProviderMessage, ToolSpec } from "../../types/router.js";

export interface ProviderStreamParams {
  modelId: string;
  agentSlug?: string;
  messages: ProviderMessage[];
  tools: ToolSpec[];
  systemPrompt: string | object[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal: AbortSignal;
  /** One stream/job — scopes Anthropic prompt-cache keepalive timers per Bull job. */
  jobId?: string;
}

export interface Provider {
  id: ProviderId;
  streamCompletion(params: ProviderStreamParams): AsyncIterable<ProviderEvent>;
}
