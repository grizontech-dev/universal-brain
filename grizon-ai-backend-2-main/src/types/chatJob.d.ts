import type { Plan } from "./plan.js";

export interface ChatJobPayload {
  userId: string;
  conversationId: string;
  messageId: string;
  clientMessageId: string;
  sessionId: string;
  platform: "web" | "admin" | "mobile-ios" | "mobile-android";
  planSnapshot: Plan;
  walletHoldId: string;
  content: string;
  attachedFileIds: string[];
  interactionMode: "auto" | "agent";
  agentSlug: string | null;
  modelId: string | null;
  options: {
    temperature?: number;
    customSystemPrompt?: string;
    searchContextSize?: "low" | "medium" | "high";
  };
  estimatedTokens: number;
  /** Credits held at enqueue (`placeHold`); persisted for usage `estimated_credits`. */
  estimatedCredits?: number;
}

/** BullMQ job `name: "summarise"` on the chat queue (Module 8 manual trigger). */
export interface SummariseJobPayload {
  userId: string;
  conversationId: string;
}

export type ChatQueueJobData = ChatJobPayload | SummariseJobPayload;

export type ChatJobStatus =
  | "queued"
  | "processing"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export interface ChatJobRecord {
  id: string;
  userId: string;
  conversationId: string;
  clientMessageId: string;
  walletHoldId: string;
  status: ChatJobStatus;
  attempts: number;
  maxAttempts: number;
  resultMessageId: string | null;
  artifactIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
  agentSlug: string | null;
  modelId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
