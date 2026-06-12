import { createHash } from "crypto";

import { env } from "../config/env.js";
import { getPool } from "../db/pool.js";
import { getRedisClient } from "../infra/redis.js";
import { usageEvents } from "../events/usage.events.js";
import { logger } from "../utils/logger.js";
import type { RecordUsageArgs } from "../types/usage.js";

async function bumpUserDailyRollups(args: RecordUsageArgs): Promise<void> {
  const redis = await getRedisClient();
  if (!redis || !args.requestId) return;
  try {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const base = `analytics:user:${args.userId}:daily:${day}`;
    await redis.incr(`${base}:requests`);
    if (args.creditsDeducted > 0) {
      await redis.incrBy(`${base}:credits`, args.creditsDeducted);
    }
  } catch (err) {
    logger.debug({ err, userId: args.userId }, "usage_analytics_redis_incr_failed");
  }
}

export const usageTracker = {
  async record(args: RecordUsageArgs): Promise<void> {
    try {
      const pool = getPool();
      const fresh = args.inputTokensFresh ?? null;
      const cached = args.inputTokensCached ?? null;
      const inputTotal =
        fresh !== null || cached !== null
          ? Math.max(0, fresh ?? 0) + Math.max(0, cached ?? 0)
          : Math.max(0, args.inputTokens);
      const totalTokens = inputTotal + Math.max(0, args.outputTokens);
      const ipHash = args.ip
        ? createHash("sha256").update(`${args.ip}:${env.IP_HASH_SALT}`).digest("hex").slice(0, 16)
        : null;

      const hasRequestId = Boolean(args.requestId);

      const sql = hasRequestId
        ? `
        INSERT INTO usage_records (
          user_id, conversation_id, message_id, request_id, model_id, agent_slug, model_provider, platform, status, interaction_mode, error_code,
          latency_ms, input_tokens, output_tokens, total_tokens, credits_deducted, estimated_credits,
          wallet_balance_before, wallet_balance_after, actual_cost_usd, finish_reason, semantic_cache_hit,
          prompt_cache_hit,
          had_files, had_voice, router_latency_ms, cache_hit_layer, web_search_engine, web_search_count, web_fetch_count, tool_count_total,
          web_search_used, code_execution_used, code_execution_count,
          input_tokens_fresh, input_tokens_cached, cache_write_tokens, metadata,
          ip_hash, user_agent,
          llm_first_token_ms, llm_total_ms
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,$23,
          $24,$25,$26,$27,$28,$29,$30,$31,
          $32,$33,$34,
          $35,$36,$37,$38,
          $39,$40,
          $41,$42
        )
        ON CONFLICT (request_id) WHERE (request_id IS NOT NULL) DO NOTHING
        RETURNING id
      `
        : `
        INSERT INTO usage_records (
          user_id, conversation_id, message_id, request_id, model_id, agent_slug, model_provider, platform, status, interaction_mode, error_code,
          latency_ms, input_tokens, output_tokens, total_tokens, credits_deducted, estimated_credits,
          wallet_balance_before, wallet_balance_after, actual_cost_usd, finish_reason, semantic_cache_hit,
          prompt_cache_hit,
          had_files, had_voice, router_latency_ms, cache_hit_layer, web_search_engine, web_search_count, web_fetch_count, tool_count_total,
          web_search_used, code_execution_used, code_execution_count,
          input_tokens_fresh, input_tokens_cached, cache_write_tokens, metadata,
          ip_hash, user_agent,
          llm_first_token_ms, llm_total_ms
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,$23,
          $24,$25,$26,$27,$28,$29,$30,$31,
          $32,$33,$34,
          $35,$36,$37,$38,
          $39,$40,
          $41,$42
        )
        RETURNING id
      `;

      const values = [
        args.userId,
        args.conversationId ?? null,
        args.messageId ?? null,
        args.requestId ?? null,
        args.modelId,
        args.agentSlug,
        args.modelProvider,
        args.platform,
        args.status,
        args.interactionMode ?? "auto",
        args.errorCode ?? null,
        args.latencyMs,
        inputTotal,
        args.outputTokens,
        totalTokens,
        args.creditsDeducted,
        args.estimatedCredits ?? null,
        args.walletBalanceBefore ?? null,
        args.walletBalanceAfter ?? null,
        args.actualCostUsd ?? null,
        args.finishReason ?? null,
        Boolean(args.semanticCacheHit),
        Boolean(args.promptCacheHit ?? false),
        Boolean(args.hadFiles),
        Boolean(args.hadVoice),
        args.routerLatencyMs ?? null,
        args.cacheHitLayer ?? null,
        args.webSearchEngine ?? null,
        args.webSearchCount ?? 0,
        args.webFetchCount ?? 0,
        args.toolCountTotal ?? 0,
        Boolean(args.webSearchUsed),
        Boolean(args.codeExecutionUsed),
        args.codeExecutionCount ?? 0,
        fresh,
        cached,
        args.cacheWriteTokens ?? null,
        JSON.stringify(args.metadata ?? {}),
        ipHash,
        args.userAgent ?? null,
        args.llmFirstTokenMs ?? null,
        args.llmTotalMs ?? null,
      ];

      const res = await pool.query(sql, values);
      const inserted = (res.rowCount ?? 0) > 0;

      if (inserted) {
        usageEvents.emit("usage.recorded", {
          userId: args.userId,
          modelId: args.modelId,
          agentSlug: args.agentSlug,
          creditsDeducted: args.creditsDeducted,
          status: args.status,
        });
        await bumpUserDailyRollups(args);
      }
    } catch (error) {
      logger.warn({ err: error, userId: args.userId, modelId: args.modelId }, "usage_record_insert_failed");
    }
  },
};
