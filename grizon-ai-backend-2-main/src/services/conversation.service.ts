import { getPool } from "../db/pool.js";
import { conversationEvents } from "../events/conversation.events.js";
import { chatQueue } from "../queues/chat.queue.js";
import type { SummariseJobPayload } from "../types/chatJob.js";
import { Errors } from "../utils/errors.js";
import type { Conversation } from "../types/conversation.js";

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapConversation(row: Row): Conversation {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    titleGeneratedAt: row.title_generated_at ? toIso(row.title_generated_at) : null,
    defaultAgentSlug: (row.default_agent_slug as string | null) ?? null,
    defaultModelId: (row.default_model_id as string | null) ?? null,
    totalTokensUsed: Number(row.total_tokens_used ?? 0),
    messageCount: Number(row.message_count ?? 0),
    summarisedUpToMsgId: (row.summarised_up_to_msg_id as string | null) ?? null,
    summaryText: (row.summary_text as string | null) ?? null,
    status: row.status as Conversation["status"],
    pinnedAt: row.pinned_at ? toIso(row.pinned_at) : null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    platform: String(row.platform),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    lastMessageAt: toIso(row.last_message_at),
  };
}

function parseCursor(cursor?: string): { lastMessageAt: string; id: string } | null {
  if (!cursor) return null;
  const [lastMessageAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!lastMessageAt || !id) return null;
  return { lastMessageAt, id };
}

function encodeCursor(lastMessageAt: string, id: string): string {
  return Buffer.from(`${lastMessageAt}|${id}`, "utf8").toString("base64url");
}

export const conversationService = {
  async create(args: {
    userId: string;
    platform: string;
    defaultAgentSlug?: string | null;
    defaultModelId?: string | null;
    tags?: string[];
  }): Promise<Conversation> {
    const pool = getPool();
    const res = await pool.query(
      `
      INSERT INTO conversations (user_id, platform, default_agent_slug, default_model_id, tags)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `,
      [args.userId, args.platform, args.defaultAgentSlug ?? null, args.defaultModelId ?? null, args.tags ?? []],
    );
    const conversation = mapConversation(res.rows[0] as Row);
    conversationEvents.emit("conversation.created", {
      conversationId: conversation.id,
      userId: conversation.userId,
    });
    return conversation;
  },

  async getById(userId: string, id: string): Promise<Conversation> {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1`, [
      id,
      userId,
    ]);
    if (!res.rowCount) throw Errors.conversationNotFound();
    return mapConversation(res.rows[0] as Row);
  },

  async list(args: { userId: string; status?: Conversation["status"]; cursor?: string; limit: number }) {
    const pool = getPool();
    const parsed = parseCursor(args.cursor);
    const filters: string[] = ["c.user_id = $1"];
    const params: unknown[] = [args.userId];
    let idx = 2;

    if (args.status) {
      filters.push(`c.status = $${idx++}`);
      params.push(args.status);
    }
    if (parsed) {
      filters.push(`(c.last_message_at, c.id) < ($${idx++}::timestamptz, $${idx++}::uuid)`);
      params.push(parsed.lastMessageAt, parsed.id);
    }

    params.push(args.limit + 1);
    const limitIdx = idx;
    const where = filters.join(" AND ");
    const res = await pool.query(
      `
      SELECT c.*
      FROM conversations c
      WHERE ${where}
      ORDER BY c.last_message_at DESC, c.id DESC
      LIMIT $${limitIdx}
    `,
      params,
    );

    const rows = res.rows as Row[];
    const hasMore = rows.length > args.limit;
    const pageRows = hasMore ? rows.slice(0, args.limit) : rows;
    const items = pageRows.map(mapConversation);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.lastMessageAt, last.id) : null,
      hasMore,
    };
  },

  async patch(
    userId: string,
    id: string,
    patch: { title?: string; pinned?: boolean; status?: "active" | "archived"; tags?: string[] },
  ): Promise<Conversation> {
    const pool = getPool();
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.title !== undefined) {
      updates.push(`title = $${i++}`);
      values.push(patch.title);
    }
    if (patch.pinned !== undefined) {
      updates.push(`pinned_at = ${patch.pinned ? "now()" : "NULL"}`);
    }
    if (patch.status !== undefined) {
      updates.push(`status = $${i++}`);
      values.push(patch.status);
    }
    if (patch.tags !== undefined) {
      updates.push(`tags = $${i++}`);
      values.push(patch.tags);
    }
    if (!updates.length) return this.getById(userId, id);
    updates.push(`updated_at = now()`);

    values.push(id, userId);
    const idIdx = i++;
    const userIdx = i;
    const res = await pool.query(
      `UPDATE conversations SET ${updates.join(", ")} WHERE id = $${idIdx} AND user_id = $${userIdx} RETURNING *`,
      values,
    );
    if (!res.rowCount) throw Errors.conversationNotFound();
    const conversation = mapConversation(res.rows[0] as Row);
    if (patch.status === "archived") {
      conversationEvents.emit("conversation.archived", { conversationId: conversation.id, userId });
    }
    return conversation;
  },

  async archive(userId: string, id: string): Promise<void> {
    await this.patch(userId, id, { status: "archived" });
  },

  async enqueueSummarise(userId: string, conversationId: string): Promise<{ jobId: string; queuePosition: number }> {
    await this.getById(userId, conversationId);
    const jobId = `summarise:${conversationId}`;
    const job = await chatQueue.add(
      "summarise",
      { userId, conversationId } satisfies SummariseJobPayload,
      { jobId, removeOnComplete: true },
    );
    const counts = await chatQueue.getJobCounts("waiting");
    return { jobId: String(job.id), queuePosition: Number(counts.waiting ?? 0) };
  },

  async listForAdmin(args: {
    targetUserId: string;
    status?: Conversation["status"];
    cursor?: string;
    limit: number;
  }) {
    return this.list({ userId: args.targetUserId, status: args.status, cursor: args.cursor, limit: args.limit });
  },

  async listAllForAdmin(args: {
    userId?: string;
    status?: Conversation["status"];
    page: number;
    pageSize: number;
  }) {
    const pool = getPool();
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (args.userId) { conditions.push(`user_id = $${idx++}`); values.push(args.userId); }
    if (args.status) { conditions.push(`status = $${idx++}`); values.push(args.status); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (args.page - 1) * args.pageSize;

    const [rowsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, user_id, title, status, updated_at, created_at
         FROM conversations ${where}
         ORDER BY updated_at DESC, id DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, args.pageSize, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM conversations ${where}`,
        values,
      ),
    ]);

    const total = Number((countRes.rows[0] as { total: number }).total);
    return {
      items: rowsRes.rows as Array<{
        id: string; user_id: string; title: string | null;
        status: string | null; updated_at: string; created_at: string;
      }>,
      pagination: { page: args.page, page_size: args.pageSize, total, total_pages: Math.ceil(total / args.pageSize) },
    };
  },
};
