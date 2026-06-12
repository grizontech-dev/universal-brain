import { randomUUID } from "node:crypto";

import { getPool } from "../db/pool.js";
import { getRedisClient } from "../infra/redis.js";
import { logger } from "../utils/logger.js";
import { recordCostItem, type CostItemType } from "./messageCostItems.service.js";

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — same as promptCapture
const INDEX_TTL = TTL_SECONDS + 60 * 60 * 24;
const MAX_INDEX_ENTRIES = 500;

export type RouterComponent = "classifier" | "rewriter" | "search_planner" | "stream_round";
export type RouterCaptureStatus = "completed" | "skipped" | "error" | "timeout";

export interface RouterCaptureInput {
  component: RouterComponent;
  source: string;
  userId?: string | null;
  conversationId?: string | null;
  jobId?: string | null;
  messageId?: string | null;
  model?: string;
  modelProvider?: string | null;
  agentSlug?: string | null;
  promptSystem?: string | null;
  promptUser?: string | null;
  responseText?: string | null;
  responseJson?: unknown;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  inputTokensFresh?: number | null;
  inputTokensCached?: number | null;
  cacheWriteTokens?: number | null;
  costUsd?: number | null;
  creditsUsed?: number | null;
  roundNumber?: number | null;
  status: RouterCaptureStatus;
  errorMessage?: string | null;
  /** Extra context stored in message_cost_items.metadata */
  costMetadata?: Record<string, unknown>;
}

export interface RouterCaptureRecord extends RouterCaptureInput {
  id: string;
  createdAt: number;
}

export interface RouterCaptureSummary {
  id: string;
  component: RouterComponent;
  source: string;
  userId: string | null;
  conversationId: string | null;
  jobId: string | null;
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  status: RouterCaptureStatus;
  errorMessage: string | null;
  createdAt: string;
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

function redisKey(id: string) { return `router_capture:${id}`; }
function globalIndexKey() { return `router_capture:index:global`; }
function userIndexKey(userId: string) { return `router_capture:index:user:${userId}`; }
function componentIndexKey(component: RouterComponent) { return `router_capture:index:component:${component}`; }

async function writeToRedis(record: RouterCaptureRecord): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.set(redisKey(record.id), JSON.stringify(record), { EX: TTL_SECONDS });
    const indexes = [globalIndexKey(), componentIndexKey(record.component)];
    if (record.userId) indexes.push(userIndexKey(record.userId));
    for (const k of indexes) {
      await redis.lPush(k, record.id);
      await redis.lTrim(k, 0, MAX_INDEX_ENTRIES - 1);
      await redis.expire(k, INDEX_TTL);
    }
  } catch (err) {
    logger.debug({ err, id: record.id }, "router_capture_redis_write_failed");
  }
}

async function readFromRedis(id: string): Promise<RouterCaptureRecord | null> {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(redisKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as RouterCaptureRecord;
  } catch {
    return null;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function writeToDb(record: RouterCaptureRecord): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO router_llm_calls
        (id, component, source, user_id, conversation_id, job_id, message_id,
         model, model_provider, agent_slug,
         prompt_system, prompt_user, response_text, response_json,
         latency_ms, input_tokens, output_tokens, cost_usd, credits_used, status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        record.component,
        record.source,
        record.userId ?? null,
        record.conversationId ?? null,
        record.jobId ?? null,
        record.messageId ?? null,
        record.model ?? "gpt-4o-mini",
        record.modelProvider ?? null,
        record.agentSlug ?? null,
        record.promptSystem ?? null,
        record.promptUser ?? null,
        record.responseText ?? null,
        record.responseJson != null ? JSON.stringify(record.responseJson) : null,
        record.latencyMs ?? null,
        record.inputTokens ?? null,
        record.outputTokens ?? null,
        record.costUsd ?? null,
        record.creditsUsed ?? null,
        record.status,
        record.errorMessage ?? null,
      ],
    );
  } catch (err) {
    logger.debug({ err, id: record.id }, "router_capture_db_write_failed");
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const COMPONENT_TO_ITEM_TYPE: Record<RouterComponent, CostItemType> = {
  classifier: "router_classify",
  rewriter: "router_rewrite",
  search_planner: "router_search_plan",
  stream_round: "stream_round",
};

export function captureRouterCall(input: RouterCaptureInput): void {
  const record: RouterCaptureRecord = {
    ...input,
    id: randomUUID(),
    model: input.model ?? "gpt-4o-mini",
    createdAt: Date.now(),
  };
  void Promise.all([writeToRedis(record), writeToDb(record)]).catch((err) => {
    logger.debug({ err }, "router_capture_failed");
  });

  // Also write a lean cost row when we have a message to link to
  if (input.messageId && input.jobId && input.userId) {
    const itemType = COMPONENT_TO_ITEM_TYPE[input.component];
    const captureStatus =
      input.status === "completed" ? "success"
      : input.status === "skipped" ? "skipped"
      : input.status === "timeout" ? "timeout"
      : "error";

    recordCostItem({
      messageId: input.messageId,
      jobId: input.jobId,
      userId: input.userId,
      conversationId: input.conversationId,
      agentSlug: input.agentSlug,
      itemType,
      component: input.model ?? "gpt-4o-mini",
      modelId: input.model ?? "gpt-4o-mini",
      modelProvider: input.modelProvider,
      roundNumber: input.roundNumber,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      inputTokensFresh: input.inputTokensFresh,
      inputTokensCached: input.inputTokensCached,
      cacheWriteTokens: input.cacheWriteTokens,
      costUsd: input.costUsd,
      creditsUsed: input.creditsUsed ?? 0,
      refTable: "router_llm_calls",
      refId: record.id as unknown as string,
      latencyMs: input.latencyMs,
      status: captureStatus,
      metadata: input.costMetadata,
    });
  }
}

export async function getRouterCapture(id: string): Promise<RouterCaptureRecord | null> {
  return readFromRedis(id);
}

export async function listRouterCaptures(opts: {
  component?: RouterComponent;
  source?: string;
  userId?: string;
  status?: RouterCaptureStatus;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: RouterCaptureSummary[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (opts.component) { conditions.push(`component = $${idx++}`); values.push(opts.component); }
  if (opts.source)    { conditions.push(`source = $${idx++}`);    values.push(opts.source); }
  if (opts.userId)    { conditions.push(`user_id = $${idx++}`);   values.push(opts.userId); }
  if (opts.status)    { conditions.push(`status = $${idx++}`);    values.push(opts.status); }
  if (opts.from)      { conditions.push(`created_at >= $${idx++}::timestamptz`); values.push(opts.from); }
  if (opts.to)        { conditions.push(`created_at <= $${idx++}::timestamptz`); values.push(opts.to); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  try {
    const [rowsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, component, source, user_id, conversation_id, job_id,
                model, latency_ms, input_tokens, output_tokens, status, error_message, created_at
         FROM router_llm_calls
         ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM router_llm_calls ${where}`, values),
    ]);

    type Row = {
      id: string; component: RouterComponent; source: string;
      user_id: string | null; conversation_id: string | null; job_id: string | null;
      model: string; latency_ms: number | null; input_tokens: number | null;
      output_tokens: number | null; status: RouterCaptureStatus;
      error_message: string | null; created_at: string;
    };

    const items: RouterCaptureSummary[] = (rowsRes.rows as Row[]).map((r) => ({
      id: r.id,
      component: r.component,
      source: r.source,
      userId: r.user_id,
      conversationId: r.conversation_id,
      jobId: r.job_id,
      model: r.model,
      latencyMs: r.latency_ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    }));

    const total = Number((countRes.rows[0] as { total: number }).total);
    return { items, total };
  } catch (err) {
    logger.debug({ err }, "router_capture_list_failed");
    return { items: [], total: 0 };
  }
}
