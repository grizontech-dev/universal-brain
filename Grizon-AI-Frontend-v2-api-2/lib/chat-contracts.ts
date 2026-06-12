/** Backend-aligned types for chat / conversations / catalogue (see grizon-ai-backend-2 `src/types`). */

export type ConversationStatus = 'active' | 'archived';

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export type FileProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'vectorising';

export interface ApiCitation {
  title?: string;
  url?: string;
  snippet?: string;
}

export interface ApiConversation {
  id: string;
  userId: string;
  title: string;
  titleGeneratedAt: string | null;
  defaultAgentSlug: string | null;
  defaultModelId: string | null;
  totalTokensUsed: number;
  messageCount: number;
  summarisedUpToMsgId: string | null;
  summaryText: string | null;
  status: ConversationStatus;
  pinnedAt: string | null;
  tags: string[];
  platform: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

/** File metadata embedded on messages from GET /conversations/:id */
export interface ApiMessageAttachedFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  processingStatus: FileProcessingStatus;
  uploadedAt: string;
}

/** Slim artifact metadata on messages (GET /conversations/:id enrichment). */
export interface ApiMessageArtifact {
  id: string;
  title: string;
  /** spreadsheet | document | pdf | markdown | csv | image */
  type: string;
  filename: string;
  extension: string;
  mimeType: string;
  versionNumber: number;
  isLatest: boolean;
  /** Byte length when known; null/omitted for legacy artifacts. */
  fileSize?: number | null;
  createdAt: string;
}

/** Full artifact from GET /artifacts/:id */
export interface ApiArtifact {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string | null;
  title: string;
  type: string;
  parentId: string | null;
  versionNumber: number;
  contentHash: string | null;
  storagePath: string | null;
  contentText: string | null;
  createdByAgent: string;
  isLatest: boolean;
  previewHtml?: string | null;
  previewGeneratedAt?: string | null;
  /** Byte length when known; null for legacy artifacts. */
  fileSize?: number | null;
  createdAt: string;
}

export interface ApiMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: MessageRole;
  content: string;
  attachedFileIds: string[];
  attachedFiles?: ApiMessageAttachedFile[];
  /** Generated files (file_gen, etc.) — enriched on conversation load. */
  artifacts?: ApiMessageArtifact[];
  inputTokens: number;
  outputTokens: number;
  creditsDeducted: number;
  agentSlug: string | null;
  modelId: string | null;
  modelProvider: string | null;
  webSearchUsed: boolean;
  codeExecutionUsed: boolean;
  fileAnalysisUsed: boolean;
  voiceModeUsed: boolean;
  citations: ApiCitation[];
  latencyMs: number | null;
  llmFirstTokenMs: number | null;
  llmTotalMs: number | null;
  status: MessageStatus;
  jobId: string | null;
  errorMessage: string | null;
  isIncludedInSummary: boolean;
  promptBreakdown?: PromptBreakdown | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptBreakdown {
  system_tokens?: number;
  context_tokens?: number;
  message_tokens?: number;
  response_tokens?: number;
  tool_result_tokens?: number;
  total_input_actual?: number;
}

export interface ChatEnqueueResponse {
  jobId: string;
  status: string;
  streamUrl: string;
}

export interface ChatJobStatusResponse {
  jobId: string;
  status: string;
  agentSlug: string | null;
  modelId: string | null;
  resultMessageId: string | null;
  artifactIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ChatCancelResponse {
  jobId: string;
  status: string;
}

/** User catalogue agents; API may send camelCase or snake_case. */
export interface CatalogueAgent {
  slug: string;
  agentType?: 'specialized' | 'direct';
  agent_type?: string;
  displayName?: string;
  display_name?: string;
  iconUrl?: string | null;
  icon_url?: string | null;
  shortDescription?: string;
  short_description?: string;
  longDescription?: string;
  long_description?: string;
  tags?: string[];
  examplePrompts?: unknown;
  example_prompts?: unknown;
  isAutoEligible?: boolean;
  is_auto_eligible?: boolean;
  maxContextTokens?: number;
  max_context_tokens?: number;
  costMultiplier?: number;
  cost_multiplier?: string | number;
  sort_order?: number;
  primaryModel?: {
    modelId: string;
    displayName: string;
    provider: string;
    iconUrl: string | null;
    healthStatus: 'healthy';
  } | null;
  isDirect?: boolean;
}

export interface CatalogueCategory {
  id?: string;
  slug: string;
  name: string;
  description?: string;
  iconUrl?: string | null;
  sortOrder?: number;
  sort_order?: number;
  agents: CatalogueAgent[];
}

export interface CatalogueResponse {
  modes: { auto: { available: boolean }; agent: { available: boolean } };
  categories: CatalogueCategory[];
}

/** Resolved labels for UI (handles snake_case from GET /api/v1/catalogue). */
export function catalogueAgentDisplayName(a: CatalogueAgent): string {
  return (a.displayName ?? a.display_name ?? a.slug).trim() || a.slug;
}

export function catalogueAgentShortDescription(a: CatalogueAgent): string {
  return (a.shortDescription ?? a.short_description ?? '').trim();
}

export interface CatalogueExamplePrompt {
  title: string;
  prompt: string;
}

/** Normalise example_prompts / examplePrompts from catalogue API. */
export function catalogueAgentExamplePrompts(a: CatalogueAgent): CatalogueExamplePrompt[] {
  const raw = a.examplePrompts ?? a.example_prompts;
  if (!Array.isArray(raw)) return [];
  const out: CatalogueExamplePrompt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : '';
    if (!prompt) continue;
    const title =
      typeof o.title === 'string' && o.title.trim()
        ? o.title.trim()
        : prompt.length > 48
          ? `${prompt.slice(0, 48)}…`
          : prompt;
    out.push({ title, prompt });
  }
  return out;
}

function categorySortKey(c: CatalogueCategory): number {
  return c.sortOrder ?? c.sort_order ?? 0;
}

/** Flatten all catalogue agents in category + agent sort order. */
export function flattenCatalogueAgents(
  catalogue: CatalogueResponse | null | undefined,
): Array<{ agent: CatalogueAgent; categoryName: string; categorySlug: string }> {
  if (!catalogue?.categories?.length) return [];
  const sortedCats = [...catalogue.categories].sort(
    (a, b) => categorySortKey(a) - categorySortKey(b),
  );
  const result: Array<{ agent: CatalogueAgent; categoryName: string; categorySlug: string }> = [];
  for (const cat of sortedCats) {
    const agents = [...(cat.agents ?? [])]
      .filter((a) => a?.slug)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    for (const agent of agents) {
      result.push({
        agent,
        categoryName: cat.name,
        categorySlug: cat.slug,
      });
    }
  }
  return result;
}

export interface TopupPackage {
  id?: string;
  credits: number;
  price: number;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  status: string;
  isPublic: boolean;
  isIntroductory: boolean;
  pricing: { monthly: number; annual: number; currency: 'inr' };
  credits: {
    included: number;
    rollover: boolean;
    topupEnabled: boolean;
    topupPackages: TopupPackage[];
  };
  featureFlags: Record<string, boolean>;
  createdAt: string;
}

export interface PlanSnapshot {
  id: string;
  name: string;
  slug: string;
  modelAccess?: string[];
  agentAccess: string[];
  featureFlags: Record<string, boolean>;
  credits?: {
    included: number;
    rollover: boolean;
    topupEnabled: boolean;
    topupPackages: TopupPackage[];
  };
  limits: {
    maxFileSize: number;
    maxFilesPerChat: number;
    maxContextMessages: number;
    [key: string]: unknown;
  };
}

export interface SubscriptionResponse {
  id: string;
  planId: string;
  planSnapshot: PlanSnapshot;
  billingCycle: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  creditsGranted: number;
  creditsRolledOver: number;
  createdAt: string;
}

export interface WalletResponse {
  balance: number;
  pending: number;
  spendable: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  currency: string;
  updatedAt: string;
}

export interface ApiMessageFile {
  id: string;
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  processingStatus: FileProcessingStatus;
  extractedText: string | null;
  vectorised: boolean;
  errorMessage: string | null;
  uploadedAt: string;
}

export type ChatSseEventName =
  | 'queued'
  | 'processing'
  | 'status'
  | 'chunk'
  | 'tool_call'
  | 'tool_result'
  | 'artifact'
  | 'usage'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'heartbeat';

export interface ChatSseHandlers {
  onQueued?: (data: { position?: number }) => void;
  onProcessing?: (data: { agentSlug?: string | null; modelId?: string | null; modelProvider?: string | null }) => void;
  onStatus?: (data: { content?: string; phase?: string; message?: string }) => void;
  onChunk?: (data: { content: string }) => void;
  onToolCall?: (data: { toolId?: string; name?: string; arguments?: unknown; callId: string }) => void;
  onToolResult?: (data: { callId: string; output?: unknown; durationMs?: number; summary?: string }) => void;
  onArtifact?: (data: { artifactId: string; type?: string; title?: string; latest?: boolean }) => void;
  onUsage?: (data: {
    tokensUsed?: { inputFresh: number; inputCached: number; output: number; cacheWrite: number };
    creditsDeducted?: number;
    walletBalanceAfter?: number;
    promptBreakdown?: PromptBreakdown;
    prompt_breakdown?: PromptBreakdown;
  }) => void;
  onDone?: (data: {
    messageId: string;
    conversationId: string;
    status: 'completed';
    durationMs?: number;
    llmFirstTokenMs?: number | null;
    llmTotalMs?: number | null;
    tokensUsed?: {
      input: number;
      inputCached: number;
      output: number;
      cacheWrite: number;
    };
    creditsDeducted?: number;
  }) => void;
  onError?: (data: { code?: string; message?: string; retryable?: boolean }) => void;
  onCancelled?: (data: { reason?: string }) => void;
  onHeartbeat?: () => void;
  /** Fired for SSE `event` names not in {@link ChatSseEventName} (e.g. future server events or `message` when omitted). */
  onUnknownEvent?: (event: string, data: Record<string, unknown>) => void;
}
