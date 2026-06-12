import { env } from "../config/env.js";
import { getRedisClient } from "../infra/redis.js";
import { logger } from "../utils/logger.js";

export type JourneyStage =
  | "job.received"
  | "cache.checked"
  | "router.classified"
  | "router.decided"
  | "preflight.validated"
  | "preflight.failed"
  | "llm.stream.started"
  | "llm.tool_call_requested"
  | "tool.started"
  | "tool.completed"
  | "llm.stream.finished"
  | "post_process.applied"
  | "job.completed"
  | "job.failed"
  | "job.cancelled"
  | "job.timeout";

export interface JourneyHeader {
  userId: string;
  conversationId: string;
  agentSlug?: string;
  modelId?: string;
  startedAt: number;
}

export interface JourneySummary {
  status: "completed" | "failed" | "cancelled" | "timeout";
  finishedAt: number;
  totalDurationMs: number;
  modelId?: string;
  modelProvider?: string;
  cacheLayer?: "semantic" | "prompt" | "none";
  inputTokens?: number;
  outputTokens?: number;
  toolCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface JourneyTracer {
  start(header: JourneyHeader): Promise<void>;
  event(stage: JourneyStage, actor: string, data?: unknown): Promise<void>;
  finish(summary: JourneySummary): Promise<void>;
  readonly traceId: string;
}

const TTL_SECONDS = 60 * 60 * 24 * 7;        // 7 days for trace data
const INDEX_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days for index lists
const MAX_INDEX_ENTRIES = 200;

const NOOP_TRACER = (traceId: string): JourneyTracer => ({
  traceId,
  async start() { /* no-op */ },
  async event() { /* no-op */ },
  async finish() { /* no-op */ },
});

function headerKey(traceId: string)  { return `journey:${traceId}`; }
function eventsKey(traceId: string)  { return `journey:${traceId}:events`; }
function summaryKey(traceId: string) { return `journey:${traceId}:meta`; }
function userIndexKey(userId: string)         { return `journey:user:${userId}`; }
function conversationIndexKey(conversationId: string) { return `journey:conversation:${conversationId}`; }
function globalIndexKey()                     { return `journey:global`; }

export function createJourneyTracer(traceId: string): JourneyTracer {
  if (!env.ANALYTICS_JOURNEY_TRACER_ENABLED) return NOOP_TRACER(traceId);

  let seq = 0;

  return {
    traceId,

    async start(header) {
      try {
        const redis = await getRedisClient();
        if (!redis) return;
        const k = headerKey(traceId);
        await redis.hSet(k, {
          user_id: header.userId,
          conversation_id: header.conversationId,
          agent_slug: header.agentSlug ?? "",
          model_id: header.modelId ?? "",
          started_at: String(header.startedAt),
          status: "running",
        });
        await redis.expire(k, TTL_SECONDS);
        await redis.expire(eventsKey(traceId), TTL_SECONDS);

        const userIdx = userIndexKey(header.userId);
        await redis.lPush(userIdx, traceId);
        await redis.lTrim(userIdx, 0, MAX_INDEX_ENTRIES - 1);
        await redis.expire(userIdx, INDEX_TTL_SECONDS);

        const convIdx = conversationIndexKey(header.conversationId);
        await redis.lPush(convIdx, traceId);
        await redis.lTrim(convIdx, 0, MAX_INDEX_ENTRIES - 1);
        await redis.expire(convIdx, INDEX_TTL_SECONDS);

        const globalIdx = globalIndexKey();
        await redis.lPush(globalIdx, traceId);
        await redis.lTrim(globalIdx, 0, MAX_INDEX_ENTRIES - 1);
        await redis.expire(globalIdx, INDEX_TTL_SECONDS);
      } catch (err) {
        logger.debug({ err, traceId }, "journey_start_failed");
      }
    },

    async event(stage, actor, data) {
      try {
        const redis = await getRedisClient();
        if (!redis) return;
        const entry = JSON.stringify({
          ts: Date.now(),
          seq: ++seq,
          stage,
          actor,
          data: data ?? null,
        });
        await redis.rPush(eventsKey(traceId), entry);
        await redis.expire(eventsKey(traceId), TTL_SECONDS);
        await redis.expire(headerKey(traceId), TTL_SECONDS);
      } catch (err) {
        logger.debug({ err, traceId, stage }, "journey_event_failed");
      }
    },

    async finish(summary) {
      try {
        const redis = await getRedisClient();
        if (!redis) return;
        const k = summaryKey(traceId);
        await redis.hSet(k, {
          status: summary.status,
          finished_at: String(summary.finishedAt),
          total_duration_ms: String(summary.totalDurationMs),
          model_id: summary.modelId ?? "",
          model_provider: summary.modelProvider ?? "",
          cache_layer: summary.cacheLayer ?? "",
          input_tokens: String(summary.inputTokens ?? 0),
          output_tokens: String(summary.outputTokens ?? 0),
          tool_count: String(summary.toolCount ?? 0),
          error_code: summary.errorCode ?? "",
          error_message: summary.errorMessage ?? "",
        });
        await redis.expire(k, TTL_SECONDS);

        const headerK = headerKey(traceId);
        await redis.hSet(headerK, {
          status: summary.status,
          finished_at: String(summary.finishedAt),
          total_duration_ms: String(summary.totalDurationMs),
        });
        await redis.expire(headerK, TTL_SECONDS);
      } catch (err) {
        logger.debug({ err, traceId }, "journey_finish_failed");
      }
    },
  };
}

export interface JourneyEvent {
  ts: number;
  seq: number;
  stage: JourneyStage;
  actor: string;
  data: unknown;
}

export interface JourneyView {
  header: Record<string, string>;
  events: JourneyEvent[];
  summary: Record<string, string> | null;
}

export async function getJourney(traceId: string): Promise<JourneyView | null> {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const header = await redis.hGetAll(headerKey(traceId));
    if (!header || Object.keys(header).length === 0) return null;
    const rawEvents: string[] = await redis.lRange(eventsKey(traceId), 0, -1);
    const events = rawEvents
      .map((s) => {
        try { return JSON.parse(s) as JourneyEvent; } catch { return null; }
      })
      .filter((e): e is JourneyEvent => e !== null);
    const summary = await redis.hGetAll(summaryKey(traceId));
    return {
      header,
      events,
      summary: summary && Object.keys(summary).length > 0 ? summary : null,
    };
  } catch (err) {
    logger.debug({ err, traceId }, "journey_read_failed");
    return null;
  }
}

export async function listUserJourneys(userId: string, limit = 50): Promise<string[]> {
  const redis = await getRedisClient();
  if (!redis) return [];
  try {
    return await redis.lRange(userIndexKey(userId), 0, Math.max(0, limit - 1));
  } catch (err) {
    logger.debug({ err, userId }, "journey_list_user_failed");
    return [];
  }
}

export async function listConversationJourneys(conversationId: string, limit = 50): Promise<string[]> {
  const redis = await getRedisClient();
  if (!redis) return [];
  try {
    return await redis.lRange(conversationIndexKey(conversationId), 0, Math.max(0, limit - 1));
  } catch (err) {
    logger.debug({ err, conversationId }, "journey_list_conversation_failed");
    return [];
  }
}

export interface JourneySummaryItem {
  traceId: string;
  userId: string;
  conversationId: string;
  agentSlug: string;
  modelId: string;
  startedAt: number;
  status: string;
}

export async function listAllJourneys(limit = 50): Promise<JourneySummaryItem[]> {
  const redis = await getRedisClient();
  if (!redis) return [];
  try {
    const traceIds = await redis.lRange(globalIndexKey(), 0, Math.max(0, limit - 1));
    if (!traceIds.length) return [];
    const headers = await Promise.all(traceIds.map((id: string) => redis.hGetAll(headerKey(id))));
    return traceIds
      .map((id: string, i: number): JourneySummaryItem | null => {
        const h = headers[i];
        if (!h || Object.keys(h).length === 0) return null;
        return {
          traceId:        id,
          userId:         h.user_id         ?? "",
          conversationId: h.conversation_id ?? "",
          agentSlug:      h.agent_slug      ?? "",
          modelId:        h.model_id        ?? "",
          startedAt:      Number(h.started_at ?? 0),
          status:         h.status          ?? "running",
        };
      })
      .filter((item: JourneySummaryItem | null): item is JourneySummaryItem => item !== null);
  } catch (err) {
    logger.debug({ err }, "journey_list_all_failed");
    return [];
  }
}
