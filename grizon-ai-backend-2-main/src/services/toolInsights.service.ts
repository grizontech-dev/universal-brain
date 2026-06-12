import { env } from "../config/env.js";
import { getPool } from "../db/pool.js";
import { logger } from "../utils/logger.js";
import { recordCostItem, toolNameToItemType } from "./messageCostItems.service.js";

const MAX_OUTPUT_BYTES = 64 * 1024;

export interface ToolInvocationRow {
  traceId: string;
  callId: string;
  userId: string;
  conversationId?: string | null;
  messageId?: string | null;
  agentSlug?: string | null;
  modelId?: string | null;
  toolName: string;
  requestArgs: unknown;
  responseOutput: unknown;
  status: "success" | "error" | "timeout";
  errorMessage?: string | null;
  durationMs: number;
  startedAt: Date;
  /** Tokens consumed by LLM-backed tools (e.g. image_analyse). Zero for API-only tools. */
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
  /** Summary metadata for message_cost_items.metadata */
  costMetadata?: Record<string, unknown>;
}

function truncateForJsonb(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_OUTPUT_BYTES) return value;
    return {
      _truncated: true,
      original_bytes: serialized.length,
      preview: serialized.slice(0, MAX_OUTPUT_BYTES - 1024),
    };
  } catch {
    return { _truncated: true, reason: "not_serializable" };
  }
}

export async function recordToolInvocation(row: ToolInvocationRow): Promise<void> {
  if (!env.ANALYTICS_TOOL_INSIGHTS_ENABLED) return;
  let invocationId: string | null = null;
  try {
    const pool = getPool();
    const res = await pool.query(
      `
      INSERT INTO tool_invocations (
        trace_id, call_id, user_id, conversation_id, message_id,
        agent_slug, model_id, tool_name,
        request_args, response_output,
        status, error_message, duration_ms, started_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id
      `,
      [
        row.traceId,
        row.callId,
        row.userId,
        row.conversationId ?? null,
        row.messageId ?? null,
        row.agentSlug ?? null,
        row.modelId ?? null,
        row.toolName,
        truncateForJsonb(row.requestArgs ?? {}),
        truncateForJsonb(row.responseOutput),
        row.status,
        row.errorMessage ?? null,
        row.durationMs,
        row.startedAt,
      ],
    );
    invocationId = (res.rows[0] as { id: string } | undefined)?.id ?? null;
  } catch (err) {
    logger.error({ err, traceId: row.traceId, toolName: row.toolName }, "tool_invocation_insert_failed");
  }

  // Write lean cost row if we have a message to link to
  if (row.messageId) {
    recordCostItem({
      messageId: row.messageId,
      jobId: row.traceId,
      userId: row.userId,
      conversationId: row.conversationId,
      agentSlug: row.agentSlug,
      itemType: toolNameToItemType(row.toolName),
      component: row.toolName,
      modelId: row.modelId,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      costUsd: row.costUsd,
      refTable: invocationId ? "tool_invocations" : null,
      refId: invocationId as unknown as string | null,
      latencyMs: row.durationMs,
      status: row.status,
      metadata: row.costMetadata,
    });
  }
}
