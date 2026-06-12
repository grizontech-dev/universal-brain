import { getPool } from "../db/pool.js";
import { Errors } from "../utils/errors.js";
import type { ChatJobRecord } from "../types/chatJob.js";

function toIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapChatJob(row: Record<string, unknown>): ChatJobRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    conversationId: String(row.conversation_id),
    clientMessageId: String(row.client_message_id),
    walletHoldId: String(row.wallet_hold_id),
    status: String(row.status) as ChatJobRecord["status"],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    resultMessageId: (row.result_message_id as string | null) ?? null,
    artifactIds: Array.isArray(row.artifact_ids) ? (row.artifact_ids as string[]) : [],
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    agentSlug: (row.agent_slug as string | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    createdAt: toIso(row.created_at),
    startedAt: row.started_at ? toIso(row.started_at) : null,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

export const jobStatusService = {
  async getJobSnapshot(jobId: string, requestingUserId: string): Promise<ChatJobRecord> {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM chat_jobs WHERE id = $1 LIMIT 1`, [jobId]);
    if (!res.rowCount) throw Errors.jobNotFound();
    const row = res.rows[0] as Record<string, unknown>;
    if (String(row.user_id) !== requestingUserId) throw Errors.jobNotOwned();
    return mapChatJob(row);
  },

  async getMostRecentActiveJobForConversation(conversationId: string, userId: string): Promise<ChatJobRecord | null> {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT * FROM chat_jobs
      WHERE conversation_id = $1
        AND user_id = $2
        AND status IN ('queued', 'processing', 'streaming')
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [conversationId, userId],
    );
    if (!res.rowCount) return null;
    return mapChatJob(res.rows[0] as Record<string, unknown>);
  },
};
