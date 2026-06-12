import { randomUUID } from "node:crypto";

import { env } from "../config/env.js";
import { getRedisClient } from "../infra/redis.js";
import type { AssembledPrompt } from "../prompt/assembler.js";
import type { ProviderId, ProviderMessage, RoutingDecision, ToolSpec } from "../types/router.js";
import { logger } from "../utils/logger.js";

const TTL = env.ANALYTICS_PROMPT_CAPTURE_TTL_SECONDS;
const INDEX_TTL = TTL + 60 * 60 * 24; // index lives slightly longer so listings don't lose newest items
const MAX_INDEX_ENTRIES = 500;

function captureKey(id: string) { return `prompt_capture:${id}`; }
function globalIndexKey() { return `prompt_capture:index:global`; }
function userIndexKey(userId: string) { return `prompt_capture:index:user:${userId}`; }
function conversationIndexKey(conversationId: string) { return `prompt_capture:index:conversation:${conversationId}`; }

export interface PromptCaptureInput {
  jobId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  planSlug: string;
  decision: RoutingDecision;
  toolDefinitions: ToolSpec[];
  assembledPrompt: AssembledPrompt;
  userQueryRaw: string;
  rewrittenQuery: string | null;
  recalledFacts: string[];
  retrievedContext: string | undefined;
  attachedFileIds: string[];
  conversationHistory: ProviderMessage[];
  startedAt: number;
}

export interface PromptCaptureResponse {
  modelUsed: string;
  providerUsed: ProviderId;
  finishReason: string;
  finalContent: string;
  preambleText?: string;
  inputTokensFresh: number;
  inputTokensCached: number;
  outputTokens: number;
  cacheWriteTokens: number;
  toolCount: number;
  webSearchEngine?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  finishedAt: number;
  durationMs: number;
  status: "completed" | "failed" | "cancelled" | "timeout";
}

export interface PromptCaptureRecord {
  id: string;
  jobId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  planSlug: string;
  agentSlug: string;
  modelId: string;
  modelProvider: ProviderId;
  source: RoutingDecision["source"];
  startedAt: number;
  request: {
    userQueryRaw: string;
    rewrittenQuery: string | null;
    recalledFacts: string[];
    retrievedContext: string | undefined;
    attachedFileIds: string[];
    conversationHistory: ProviderMessage[];
    decision: RoutingDecision;
    toolDefinitions: ToolSpec[];
    assembled: {
      system: AssembledPrompt["system"];
      messages: ProviderMessage[];
      estimatedTokens: number;
      compactionApplied: boolean;
    };
  };
  response?: PromptCaptureResponse;
}

export interface PromptCaptureSummary {
  id: string;
  userId: string;
  conversationId: string;
  agentSlug: string;
  modelId: string;
  modelProvider: ProviderId | "";
  source: string;
  startedAt: number;
  status: string;
  finishedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedTokens?: number;
}

async function writeRecord(record: PromptCaptureRecord): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.set(captureKey(record.id), JSON.stringify(record), { EX: TTL });
  } catch (err) {
    logger.debug({ err, id: record.id }, "prompt_capture_write_failed");
  }
}

async function readRecord(id: string): Promise<PromptCaptureRecord | null> {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(captureKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as PromptCaptureRecord;
  } catch (err) {
    logger.debug({ err, id }, "prompt_capture_read_failed");
    return null;
  }
}

function summarise(record: PromptCaptureRecord): PromptCaptureSummary {
  return {
    id: record.id,
    userId: record.userId,
    conversationId: record.conversationId,
    agentSlug: record.agentSlug,
    modelId: record.modelId,
    modelProvider: record.modelProvider,
    source: record.source,
    startedAt: record.startedAt,
    status: record.response?.status ?? "running",
    finishedAt: record.response?.finishedAt,
    durationMs: record.response?.durationMs,
    inputTokens: record.response
      ? record.response.inputTokensFresh + record.response.inputTokensCached
      : undefined,
    outputTokens: record.response?.outputTokens,
    estimatedTokens: record.request.assembled.estimatedTokens,
  };
}

export async function capturePromptRequest(input: PromptCaptureInput): Promise<string | null> {
  if (!env.ANALYTICS_PROMPT_CAPTURE_ENABLED) return null;
  const redis = await getRedisClient();
  if (!redis) return null;

  const id = randomUUID();
  const record: PromptCaptureRecord = {
    id,
    jobId: input.jobId,
    userId: input.userId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    planSlug: input.planSlug,
    agentSlug: input.decision.agentSlug,
    modelId: input.decision.modelId,
    modelProvider: input.decision.modelProvider,
    source: input.decision.source,
    startedAt: input.startedAt,
    request: {
      userQueryRaw: input.userQueryRaw,
      rewrittenQuery: input.rewrittenQuery,
      recalledFacts: input.recalledFacts,
      retrievedContext: input.retrievedContext,
      attachedFileIds: input.attachedFileIds,
      conversationHistory: input.conversationHistory,
      decision: input.decision,
      toolDefinitions: input.toolDefinitions,
      assembled: {
        system: input.assembledPrompt.system,
        messages: input.assembledPrompt.messages,
        estimatedTokens: input.assembledPrompt.estimatedTokens,
        compactionApplied: input.assembledPrompt.compactionApplied,
      },
    },
  };

  try {
    await writeRecord(record);

    for (const k of [globalIndexKey(), userIndexKey(input.userId), conversationIndexKey(input.conversationId)]) {
      await redis.lPush(k, id);
      await redis.lTrim(k, 0, MAX_INDEX_ENTRIES - 1);
      await redis.expire(k, INDEX_TTL);
    }
  } catch (err) {
    logger.debug({ err, id }, "prompt_capture_index_failed");
  }

  return id;
}

export async function capturePromptResponse(id: string | null, response: PromptCaptureResponse): Promise<void> {
  if (!id) return;
  if (!env.ANALYTICS_PROMPT_CAPTURE_ENABLED) return;
  const existing = await readRecord(id);
  if (!existing) return;
  existing.response = response;
  await writeRecord(existing);
}

export async function getPromptCapture(id: string): Promise<PromptCaptureRecord | null> {
  return readRecord(id);
}

export async function listPromptCaptures(
  opts: { userId?: string; conversationId?: string; limit?: number } = {},
): Promise<PromptCaptureSummary[]> {
  const redis = await getRedisClient();
  if (!redis) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 50, MAX_INDEX_ENTRIES));
  const key = opts.userId
    ? userIndexKey(opts.userId)
    : opts.conversationId
    ? conversationIndexKey(opts.conversationId)
    : globalIndexKey();
  try {
    const ids: string[] = await redis.lRange(key, 0, limit - 1);
    if (!ids.length) return [];
    const records = await Promise.all(ids.map((id) => readRecord(id)));
    return records
      .filter((r): r is PromptCaptureRecord => r !== null)
      .map(summarise);
  } catch (err) {
    logger.debug({ err }, "prompt_capture_list_failed");
    return [];
  }
}
