import { randomUUID } from "crypto";

import { getPool } from "../db/pool.js";
import { JOB_OPTS } from "../config/queue.js";
import { conversationEvents } from "../events/conversation.events.js";
import { chatQueue } from "../queues/chat.queue.js";
import { messageService } from "./message.service.js";
import { Errors } from "../utils/errors.js";
import type { ChatJobPayload, ChatJobRecord } from "../types/chatJob.js";
import type { Message } from "../types/conversation.js";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release: () => void;
};

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

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = (await pool.connect()) as DbClient;
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const chatJobService = {
  async enqueueChat(payload: ChatJobPayload): Promise<{ job: ChatJobRecord; replayed: boolean }> {
    const out = await withTx(async (client) => {
      const existing = await client.query(
        `
        SELECT * FROM chat_jobs
        WHERE user_id = $1
          AND conversation_id = $2
          AND client_message_id = $3
          AND created_at > now() - interval '24 hours'
        LIMIT 1
      `,
        [payload.userId, payload.conversationId, payload.clientMessageId],
      );

      if (existing.rowCount) {
        return {
          job: mapChatJob(existing.rows[0] as Record<string, unknown>),
          replayed: true,
          userMessage: null as Message | null,
        };
      }

      const userMessage = await messageService.createUserMessageWithClient(client, {
        conversationId: payload.conversationId,
        userId: payload.userId,
        content: payload.content,
        attachedFileIds: payload.attachedFileIds,
        agentSlug: payload.agentSlug ?? "auto",
      });

      const id = randomUUID();
      const inserted = await client.query(
        `
        INSERT INTO chat_jobs (
          id, user_id, conversation_id, client_message_id, wallet_hold_id, status,
          attempts, max_attempts, agent_slug, model_id
        ) VALUES ($1,$2,$3,$4,$5,'queued',0,$6,$7,$8)
        RETURNING *
      `,
        [
          id,
          payload.userId,
          payload.conversationId,
          payload.clientMessageId,
          payload.walletHoldId,
          JOB_OPTS.chat.attempts,
          payload.agentSlug,
          payload.modelId,
        ],
      );

      try {
        await chatQueue.add("process", payload, { jobId: id, ...JOB_OPTS.chat });
      } catch (error) {
        throw Errors.jobEnqueueFailed(error);
      }

      return {
        job: mapChatJob(inserted.rows[0] as Record<string, unknown>),
        replayed: false,
        userMessage,
      };
    });

    if (out.userMessage) {
      conversationEvents.emit("message.finalised", {
        messageId: out.userMessage.id,
        conversationId: out.userMessage.conversationId,
        userId: out.userMessage.userId,
        role: "user",
      });
    }

    return { job: out.job, replayed: out.replayed };
  },

  /**
   * Cooperative cancel: queued jobs are marked terminal immediately; active jobs set `cancel_requested`
   * and expect the worker to abort, release the hold, and write usage.
   */
  async beginCancelForUser(
    jobId: string,
    userId: string,
  ): Promise<{ mode: "queued_cancelled" | "inflight"; walletHoldId: string }> {
    return withTx(async (client) => {
      const sel = await client.query(`SELECT * FROM chat_jobs WHERE id = $1 FOR UPDATE`, [jobId]);
      if (!sel.rowCount) throw Errors.jobNotFound();
      const row = sel.rows[0] as Record<string, unknown>;
      if (String(row.user_id) !== userId) throw Errors.jobNotOwned();
      const st = String(row.status);
      if (!["queued", "processing", "streaming"].includes(st)) throw Errors.noActiveJob();
      const walletHoldId = String(row.wallet_hold_id);
      if (st === "queued") {
        await client.query(
          `
          UPDATE chat_jobs
          SET status = 'cancelled', cancel_requested = false, completed_at = now(), updated_at = now()
          WHERE id = $1
        `,
          [jobId],
        );
        return { mode: "queued_cancelled", walletHoldId };
      }
      await client.query(
        `
        UPDATE chat_jobs SET cancel_requested = true, updated_at = now() WHERE id = $1
      `,
        [jobId],
      );
      return { mode: "inflight", walletHoldId };
    });
  },
};
