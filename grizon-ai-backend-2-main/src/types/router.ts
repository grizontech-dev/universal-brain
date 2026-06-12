/** Module 10 — Smart Router type contracts */

export type ProviderId = "anthropic" | "openai" | "google" | "xai" | "deepseek";

export type Intent =
  | "search"
  | "code"
  | "write"
  | "analyse"
  | "design"
  | "debug"
  | "ui"
  | "chat"
  | "document"
  | "math"
  | "fact";

export type Complexity = "simple" | "medium" | "complex" | "reasoning";

export type ToolId =
  | "web_search"
  | "web_fetch"
  | "code_execution"
  | "file_read"
  | "file_gen"
  | "html_generate"
  | "chart_generate"
  | "image_analyse"
  | "stock_data"
  | "get_weather";

export type ToolBudgets = Partial<Record<ToolId, number>>;

export type FileGenKind = "excel" | "docx" | "markdown" | "pdf" | "txt" | "csv" | "image";

export interface ClassificationResult {
  intent: Intent;
  complexity: Complexity;
  needsWebSearch: boolean;
  needsCodeExecution: boolean;
  needsFileRead: boolean;
  needsFileGen: FileGenKind[];
  searchContextSize: "low" | "medium" | "high";
  suggestedAgent: string;
  confidence: number;
  classifierSource: "heuristic" | "llm";
}

export interface ModelDescriptor {
  id: string;
  provider: ProviderId;
  tier: "nano" | "standard" | "premium" | "frontier" | "reasoning";
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsPromptCache: boolean;
  supportsVision: boolean;
  active: boolean;
}

export interface PreflightContext {
  userId: string;
  planSlug: string;
  messageCount: number;
}

export interface PreflightResult {
  ok: boolean;
  reason?: string;
}

export interface PostProcessCitation {
  index: number;
  title?: string;
  url?: string;
  snippet?: string;
}

export interface PostProcessContext {
  agentSlug: string;
  citations: PostProcessCitation[];
  toolCallCount: number;
}

export interface AgentHooks {
  preflight?: (query: string, ctx: PreflightContext) => PreflightResult;
  postProcess?: (content: string, ctx: PostProcessContext) => string;
}

export interface AgentDescriptor {
  slug: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  /**
   * Feature-flag camelCase keys for tools this agent may use
   * (e.g. "webSearch", "imageAnalyse").
   * Maps to ToolId via featureFlagKeyForTool() in router/tools.ts.
   */
  allowedTools: string[];
  /**
   * Ordered model IDs from agent_model_priorities join table.
   * [0] = primary model, [1] = first fallback, etc.
   * Empty → selectModel falls back to tier-based selection.
   */
  modelPriority: string[];
  fallbackAgent: string | null;
  /** From agents.cost_multiplier (replaces multiplierKey). */
  costMultiplier: number;
  /** Maximum tool-use iterations per LLM turn (default 10). */
  maxToolRounds: number;
  /** Optional per-tool invocation caps for a single assistant turn. */
  toolBudgets?: ToolBudgets;
  /** Maximum output tokens per LLM call (null = model default). */
  maxTokensPerMessage: number | null;
  /** Maximum messages kept in the context window (null = plan default). */
  maxContextMessages: number | null;
  /** True for internal routing agents; false for user-facing catalogue agents. */
  isSystem: boolean;
  /** "Include in Auto" tag — Auto Mode may route to this agent only when true. */
  isAutoEligible: boolean;
  // Non-DB: attached by agentLoader from the hooks registry.
  preflight?: (query: string, ctx: PreflightContext) => PreflightResult;
  postProcess?: (content: string, ctx: PostProcessContext) => string;
}

export interface ProviderHealth {
  provider: ProviderId;
  state: "closed" | "open" | "half_open" | "disabled";
  openedAt: string | null;
  failuresInWindow: number;
  lastErrorCode: string | null;
}

export interface RoutingDecision {
  classification: ClassificationResult;
  agentSlug: string;
  modelId: string;
  modelProvider: ProviderId;
  fallbackChain: Array<{ modelId: string; provider: ProviderId }>;
  rewrittenQuery: string | null;
  systemPrompt: string;
  allowedTools: ToolId[];
  toolBudgets: ToolBudgets;
  source: "agent" | "auto";
  routerLatencyMs: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** Pre-executed web searches from the search planner (optional). */
  searchPlan?: {
    queries: string[];
    urlsToFetch: string[];
    results: import("../tools/webSearch.tool.js").WebSearchResult[];
    plannerLatencyMs: number;
    plannerSource: "heuristic" | "llm" | "skipped";
  };
}

export type ProviderEvent =
  | { type: "chunk"; delta: string; phase?: "preamble" | "answer" }
  | { type: "tool_call"; toolId: ToolId; arguments: unknown; callId: string }
  | { type: "tool_result"; callId: string; toolId: ToolId; output: unknown; durationMs: number }
  | {
      type: "usage";
      inputTokensFresh: number;
      inputTokensCached: number;
      outputTokens: number;
      cacheWriteTokens: number;
    }
  | {
      type: "finish";
      reason: "stop" | "length" | "content_filter" | "tool_use" | "error";
      modelUsed: string;
      provider: ProviderId;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

export type ProviderMessageRole = "system" | "user" | "assistant" | "tool";

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
  toolCallId?: string;
  toolName?: ToolId | string;
  /** When replaying assistant turns that invoked tools (OpenAI / compatible APIs). */
  assistantToolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamContext {
  userId: string;
  conversationId: string;
  jobId?: string;
  messageId?: string;
  attachedFileIds: string[];
  maxArtifactVersions: number;
  /** Set by chat worker for tool priority / routing hints */
  agentSlug?: string;
  queryComplexity?: Complexity;
  /** LLM that requested any tool calls in this turn (set by chat worker after router decision). */
  modelId?: string;
  /** Optional Message Journey tracer; tools emit `tool.started` / `tool.completed` events when present. */
  tracer?: import("../services/messageJourney.service.js").JourneyTracer;
}
