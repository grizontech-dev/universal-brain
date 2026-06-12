export type ConversationStatus = "active" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "pending" | "streaming" | "complete" | "error";
export type FileProcessingStatus = "pending" | "processing" | "ready" | "failed";

export interface Conversation {
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

export interface Citation {
  title?: string;
  url?: string;
  snippet?: string;
}

export interface PromptBreakdown {
  /** Conversation history tokens (estimated, scaled to actual total) */
  context_tokens: number;
  /** Current user query tokens (estimated, scaled) */
  message_tokens: number;
  /** System prompt + tool definitions tokens (estimated, scaled) */
  system_tokens: number;
  /** Tool result tokens fed back into LLM (estimated, scaled) */
  tool_result_tokens: number;
  /** LLM output tokens (exact from API) */
  response_tokens: number;
  /** Exact total input from API used to scale the estimates above */
  total_input_actual: number;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: MessageRole;
  content: string;
  attachedFileIds: string[];
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
  citations: Citation[];
  latencyMs: number | null;
  status: MessageStatus;
  jobId: string | null;
  errorMessage: string | null;
  isIncludedInSummary: boolean;
  /** Token breakdown per prompt section. Populated for assistant messages after completion. */
  promptBreakdown: PromptBreakdown | null;
  todoList: Record<string, unknown> | null;
  sandboxJob: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Artifacts generated during this message (e.g. via file_gen tool).
   * Injected by the conversation controller enrichment layer — not stored on the messages table.
   */
  artifacts?: ArtifactMeta[];
}

export interface MessageFile {
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

export interface Artifact {
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
  /** Byte length of stored payload; null for legacy rows. */
  fileSize: number | null;
  createdAt: string;
}

/**
 * Slim artifact shape attached to message responses.
 * Full artifact (with content) is fetched on demand via GET /artifacts/:id.
 */
export interface ArtifactMeta {
  id: string;
  title: string;
  /** "spreadsheet" | "document" | "pdf" | "markdown" | "csv" | "image" */
  type: string;
  /** User-facing filename, including extension. Derived from title + type. */
  filename: string;
  /** File extension including the leading dot, e.g. ".xlsx". Empty if unknown. */
  extension: string;
  /** MIME type the download endpoint will serve. */
  mimeType: string;
  versionNumber: number;
  isLatest: boolean;
  /** Byte length when known; omitted/null for legacy artifacts. */
  fileSize?: number | null;
  createdAt: string;
}
