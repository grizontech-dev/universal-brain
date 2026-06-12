import { getPool } from "../db/pool.js";
import { logger } from "../utils/logger.js";

export type CostItemType =
  | "router_classify"
  | "router_rewrite"
  | "router_search_plan"
  | "stream_round"
  | "tool_web_search"
  | "tool_web_fetch"
  | "tool_code_exec"
  | "tool_image_analyse"
  | "tool_other"
  | "subagent"
  | "semantic_cache";

export interface MessageCostItemArgs {
  messageId: string;
  jobId: string;
  userId: string;
  conversationId?: string | null;
  agentSlug?: string | null;
  itemType: CostItemType;
  component?: string | null;
  modelId?: string | null;
  modelProvider?: string | null;
  roundNumber?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  inputTokensFresh?: number | null;
  inputTokensCached?: number | null;
  cacheWriteTokens?: number | null;
  costUsd?: number | null;
  creditsUsed?: number;
  refTable?: string | null;
  refId?: string | null;
  latencyMs?: number | null;
  status?: "success" | "error" | "timeout" | "skipped" | "cache_hit";
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget insert — never throws, never blocks the caller. */
export function recordCostItem(args: MessageCostItemArgs): void {
  void _insert(args).catch((err: unknown) => {
    logger.debug({ err, messageId: args.messageId, itemType: args.itemType }, "message_cost_item_insert_failed");
  });
}

async function _insert(args: MessageCostItemArgs): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO message_cost_items (
      message_id, job_id, user_id, conversation_id, agent_slug,
      item_type, component,
      model_id, model_provider,
      round_number,
      input_tokens, output_tokens,
      input_tokens_fresh, input_tokens_cached, cache_write_tokens,
      cost_usd, credits_used,
      ref_table, ref_id,
      latency_ms, status, metadata
    ) VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,
      $8,$9,
      $10,
      $11,$12,
      $13,$14,$15,
      $16,$17,
      $18,$19,
      $20,$21,$22
    )
    `,
    [
      args.messageId,
      args.jobId,
      args.userId,
      args.conversationId ?? null,
      args.agentSlug ?? null,
      args.itemType,
      args.component ?? null,
      args.modelId ?? null,
      args.modelProvider ?? null,
      args.roundNumber ?? null,
      args.inputTokens ?? 0,
      args.outputTokens ?? 0,
      args.inputTokensFresh ?? null,
      args.inputTokensCached ?? null,
      args.cacheWriteTokens ?? null,
      args.costUsd ?? null,
      args.creditsUsed ?? 0,
      args.refTable ?? null,
      args.refId ?? null,
      args.latencyMs ?? null,
      args.status ?? "success",
      JSON.stringify(args.metadata ?? {}),
    ],
  );
}

/** Map a tool name to the appropriate item_type. */
export function toolNameToItemType(toolName: string): CostItemType {
  if (toolName === "web_search") return "tool_web_search";
  if (toolName === "web_fetch") return "tool_web_fetch";
  if (toolName === "code_execution" || toolName === "code_execute") return "tool_code_exec";
  if (toolName === "image_analyse" || toolName === "image_analysis") return "tool_image_analyse";
  return "tool_other";
}
