import { getPool } from "../db/pool.js";
import { messageService } from "../services/message.service.js";
import { usageTracker } from "../services/usageTracker.service.js";
import { walletService } from "../services/wallet.service.js";
import { logger } from "../utils/logger.js";

/** Align with Module 4 wallet janitor and Module 8 message janitor (30 minutes). */
const STALE_CHAT_JOB_MINUTES = 30;

/**
 * Recovers `chat_jobs` stuck in `processing` / `streaming` after a worker crash,
 * releases wallet holds, finalises assistant messages, and writes a single failed usage row.
 */
export async function runUsageCleanupOnce() {
  const pool = getPool();
  const stale = await pool.query(
    `
    SELECT cj.*, m.id AS assistant_message_id
    FROM chat_jobs cj
    LEFT JOIN LATERAL (
      SELECT id FROM messages
      WHERE job_id = cj.id AND role = 'assistant'
      ORDER BY created_at ASC
      LIMIT 1
    ) m ON true
    WHERE cj.status IN ('processing', 'streaming')
      AND cj.started_at IS NOT NULL
      AND cj.started_at < now() - ($1::text || ' minutes')::interval
    ORDER BY cj.started_at ASC
    LIMIT 50
  `,
    [String(STALE_CHAT_JOB_MINUTES)],
  );

  for (const row of stale.rows) {
    const jobId = String(row.id);
    const userId = String(row.user_id);
    const conversationId = String(row.conversation_id);
    const walletHoldId = String(row.wallet_hold_id);
    const assistantMessageId = row.assistant_message_id ? String(row.assistant_message_id) : null;
    const agentSlug = (row.agent_slug as string | null) ?? "chat";
    const modelId = (row.model_id as string | null) ?? "unknown_model";
    try {
      await walletService.releaseHold(walletHoldId, "janitor_timeout");
      if (assistantMessageId) {
        await messageService.finalise({
          messageId: assistantMessageId,
          status: "error",
          finalContent: "",
          inputTokens: 0,
          outputTokens: 0,
          creditsDeducted: 0,
          agentSlug,
          modelId,
          modelProvider: null,
          latencyMs: null,
          errorMessage: "worker_lost",
        });
      }
      await usageTracker.record({
        userId,
        conversationId,
        messageId: assistantMessageId,
        requestId: jobId,
        modelId,
        agentSlug,
        modelProvider: "unknown",
        platform: "web",
        status: "failed",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        creditsDeducted: 0,
        estimatedCredits: null,
        errorCode: "WORKER_LOST",
        finishReason: "error",
        metadata: { source: "usage_cleanup_worker" },
      });
      await pool.query(
        `
        UPDATE chat_jobs
        SET status = 'failed',
            completed_at = now(),
            error_code = 'WORKER_LOST',
            error_message = 'worker_lost',
            result_message_id = COALESCE(result_message_id, $2::uuid),
            updated_at = now()
        WHERE id = $1
      `,
        [jobId, assistantMessageId],
      );
      logger.warn({ jobId, userId }, "usage_cleanup_recovered_stale_chat_job");
    } catch (err) {
      logger.error({ err, jobId }, "usage_cleanup_stale_job_failed");
    }
  }
}
