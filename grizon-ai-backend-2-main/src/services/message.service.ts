import { getPool } from "../db/pool.js";
import { conversationEvents } from "../events/conversation.events.js";
import { Errors } from "../utils/errors.js";
import type { Message, PromptBreakdown } from "../types/conversation.js";

type Row = Record<string, unknown>;

/** Client participating in an outer transaction (caller owns BEGIN/COMMIT). */
export type DbTxClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
};

function toIso(value: unknown): string {
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function mapMessage(row: Row): Message {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    userId: String(row.user_id),
    role: row.role as Message["role"],
    content: String(row.content ?? ""),
    attachedFileIds: Array.isArray(row.attached_file_ids) ? (row.attached_file_ids as string[]) : [],
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    creditsDeducted: Number(row.credits_deducted ?? 0),
    agentSlug: (row.agent_slug as string | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    modelProvider: (row.model_provider as string | null) ?? null,
    webSearchUsed: Boolean(row.web_search_used),
    codeExecutionUsed: Boolean(row.code_execution_used),
    fileAnalysisUsed: Boolean(row.file_analysis_used),
    voiceModeUsed: Boolean(row.voice_mode_used),
    citations: Array.isArray(row.citations) ? (row.citations as Message["citations"]) : [],
    latencyMs: row.latency_ms !== null && row.latency_ms !== undefined ? Number(row.latency_ms) : null,
    status: row.status as Message["status"],
    jobId: (row.job_id as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    isIncludedInSummary: Boolean(row.is_included_in_summary),
    promptBreakdown: (row.prompt_breakdown as PromptBreakdown | null) ?? null,
    todoList: row.todo_list ? (typeof row.todo_list === 'string' ? JSON.parse(row.todo_list as string) : row.todo_list) as Record<string, unknown> | null : null,
    sandboxJob: row.sandbox_job ? (typeof row.sandbox_job === 'string' ? JSON.parse(row.sandbox_job as string) : row.sandbox_job) as Record<string, unknown> | null : null,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata) as Record<string, unknown> | null : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function parseCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!createdAt || !id) return null;
  return { createdAt, id };
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export const messageService = {
  /**
   * Inserts a completed user message and bumps `conversations.message_count`.
   * Does not emit events; caller should emit after COMMIT if needed.
   */
  async createUserMessageWithClient(
    client: DbTxClient,
    args: {
      conversationId: string;
      userId: string;
      content: string;
      attachedFileIds?: string[];
      agentSlug?: string | null;
    },
  ): Promise<Message> {
    const conv = await client.query(
      `SELECT id FROM conversations WHERE id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [args.conversationId, args.userId],
    );
    if (!conv.rowCount) throw Errors.conversationNotFound();
    const inserted = await client.query(
      `
        INSERT INTO messages (conversation_id, user_id, role, content, attached_file_ids, agent_slug, status)
        VALUES ($1,$2,'user',$3,$4,$5,'complete')
        RETURNING *
      `,
      [args.conversationId, args.userId, args.content, args.attachedFileIds ?? [], args.agentSlug ?? null],
    );
    await client.query(
      `
        UPDATE conversations
        SET message_count = message_count + 1, last_message_at = now(), updated_at = now()
        WHERE id = $1
      `,
      [args.conversationId],
    );
    if (args.attachedFileIds && args.attachedFileIds.length > 0) {
      await client.query(
        `UPDATE files SET message_id = $1 WHERE id = ANY($2) AND user_id = $3`,
        [(inserted.rows[0] as Row).id, args.attachedFileIds, args.userId],
      );
    }
    return mapMessage(inserted.rows[0] as Row);
  },

  async createUserMessage(args: {
    conversationId: string;
    userId: string;
    content: string;
    attachedFileIds?: string[];
    agentSlug?: string | null;
  }): Promise<Message> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const message = await messageService.createUserMessageWithClient(client as DbTxClient, args);
      await client.query("COMMIT");
      conversationEvents.emit("message.finalised", {
        messageId: message.id,
        conversationId: message.conversationId,
        userId: message.userId,
        role: "user",
      });
      return message;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async createAssistantPlaceholder(args: {
    conversationId: string;
    userId: string;
    jobId: string;
    agentSlug?: string | null;
    modelId?: string | null;
  }): Promise<Message> {
    const pool = getPool();
    const res = await pool.query(
      `
      INSERT INTO messages (conversation_id, user_id, role, content, status, job_id, agent_slug, model_id)
      VALUES ($1,$2,'assistant','', 'streaming', $3, $4, $5)
      RETURNING *
    `,
      [args.conversationId, args.userId, args.jobId, args.agentSlug ?? null, args.modelId ?? null],
    );
    return mapMessage(res.rows[0] as Row);
  },

  async append(messageId: string, chunk: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE messages SET content = content || $2, updated_at = now() WHERE id = $1 AND status = 'streaming'`,
      [messageId, chunk],
    );
  },

  /**
   * Discard all streamed content accumulated so far for a message that is still
   * in 'streaming' status.  Called by the worker whenever a tool_call event
   * arrives mid-round: any text the LLM emitted before the tool call was
   * pre-tool narration ("Let me search…") and must not appear in the final
   * saved message.
   */
  async resetContent(messageId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE messages SET content = '', updated_at = now() WHERE id = $1 AND status = 'streaming'`,
      [messageId],
    );
  },

  async finalise(args: {
    messageId: string;
    status: "complete" | "error";
    finalContent?: string;
    inputTokens?: number;
    outputTokens?: number;
    creditsDeducted?: number;
    citations?: unknown[];
    agentSlug?: string | null;
    modelId?: string | null;
    modelProvider?: string | null;
    webSearchUsed?: boolean;
    codeExecutionUsed?: boolean;
    fileAnalysisUsed?: boolean;
    voiceModeUsed?: boolean;
    latencyMs?: number | null;
    /** Time from provider call start to first streamed token (ms). */
    llmFirstTokenMs?: number | null;
    /** Time from provider call start to last streamed token (ms). */
    llmTotalMs?: number | null;
    errorMessage?: string | null;
  }): Promise<Message> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(`SELECT * FROM messages WHERE id = $1 FOR UPDATE`, [args.messageId]);
      if (!current.rowCount) throw Errors.messageNotFound();
      const row = current.rows[0] as Row;
      const priorStatus = String(row.status ?? "");
      if (priorStatus === "complete" || priorStatus === "error") {
        await client.query("COMMIT");
        return mapMessage(row);
      }
      const content = args.finalContent ?? String(row.content ?? "");
      const inputTokens = Number(args.inputTokens ?? 0);
      const outputTokens = Number(args.outputTokens ?? 0);
      const creditsDeducted = Number(args.creditsDeducted ?? 0);
      const update = await client.query(
        `
        UPDATE messages
        SET
          content = $2,
          status = $3,
          input_tokens = $4,
          output_tokens = $5,
          credits_deducted = $6,
          citations = $7::jsonb,
          agent_slug = $8,
          model_id = $9,
          model_provider = $10,
          web_search_used = $11,
          code_execution_used = $12,
          file_analysis_used = $13,
          voice_mode_used = $14,
          latency_ms = $15,
          llm_first_token_ms = $16,
          llm_total_ms = $17,
          error_message = $18,
          updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
        [
          args.messageId,
          content,
          args.status,
          inputTokens,
          outputTokens,
          creditsDeducted,
          JSON.stringify(args.citations ?? []),
          args.agentSlug ?? null,
          args.modelId ?? null,
          args.modelProvider ?? null,
          Boolean(args.webSearchUsed),
          Boolean(args.codeExecutionUsed),
          Boolean(args.fileAnalysisUsed),
          Boolean(args.voiceModeUsed),
          args.latencyMs ?? null,
          args.llmFirstTokenMs ?? null,
          args.llmTotalMs ?? null,
          args.errorMessage ?? null,
        ],
      );
      await client.query(
        `
        UPDATE conversations
        SET
          total_tokens_used = total_tokens_used + $2 + $3,
          message_count = message_count + 1,
          last_message_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
        [row.conversation_id, inputTokens, outputTokens],
      );
      await client.query("COMMIT");
      const message = mapMessage(update.rows[0] as Row);
      conversationEvents.emit("message.finalised", {
        messageId: message.id,
        conversationId: message.conversationId,
        userId: message.userId,
        role: message.role,
      });
      return message;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async listForConversation(args: {
    userId: string;
    conversationId: string;
    limit: number;
    cursor?: string;
    asc?: boolean;
  }) {
    const pool = getPool();
    const conv = await pool.query(`SELECT id FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1`, [
      args.conversationId,
      args.userId,
    ]);
    if (!conv.rowCount) throw Errors.conversationNotFound();

    const parsed = parseCursor(args.cursor);
    const filters = [`conversation_id = $1`];
    const values: unknown[] = [args.conversationId];
    let idx = 2;
    if (parsed) {
      filters.push(`(created_at, id) > ($${idx++}::timestamptz, $${idx++}::uuid)`);
      values.push(parsed.createdAt, parsed.id);
    }
    values.push(args.limit + 1);
    const where = filters.join(" AND ");
    const res = await pool.query(
      `
      SELECT * FROM messages
      WHERE ${where}
      ORDER BY created_at ${args.asc === false ? "DESC" : "ASC"}, id ${args.asc === false ? "DESC" : "ASC"}
      LIMIT $${idx}
    `,
      values,
    );
    const rows = res.rows as Row[];
    const hasMore = rows.length > args.limit;
    const pageRows = hasMore ? rows.slice(0, args.limit) : rows;
    const items = pageRows.map(mapMessage);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      hasMore,
    };
  },

  /**
   * Returns all message_cost_items for a message plus an aggregated summary.
   * Used by the cost-breakdown endpoint.
   */
  async getCostBreakdown(userId: string, messageId: string): Promise<{
    promptBreakdown: PromptBreakdown | null;
    costItems: unknown[];
    summary: {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCreditsDeducted: number;
      toolRounds: Record<string, number>;
      routerCallsCount: number;
      streamRoundsCount: number;
    };
  }> {
    const pool = getPool();

    // Verify message belongs to user
    const msgRes = await pool.query(
      `SELECT prompt_breakdown FROM messages WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [messageId, userId],
    );
    if (!msgRes.rowCount) throw Errors.messageNotFound();
    const promptBreakdown = (msgRes.rows[0] as { prompt_breakdown: PromptBreakdown | null }).prompt_breakdown ?? null;

    // Fetch cost items (exclude subagent rows from user-facing tool list)
    const itemsRes = await pool.query(
      `SELECT item_type, component, model_id, model_provider, round_number,
              input_tokens, output_tokens, input_tokens_fresh, input_tokens_cached,
              cache_write_tokens, cost_usd, credits_used, latency_ms, status, metadata, created_at
       FROM message_cost_items
       WHERE message_id = $1
       ORDER BY created_at ASC`,
      [messageId],
    );

    type ItemRow = {
      item_type: string; component: string | null; model_id: string | null;
      model_provider: string | null; round_number: number | null;
      input_tokens: number; output_tokens: number;
      input_tokens_fresh: number | null; input_tokens_cached: number | null;
      cache_write_tokens: number | null; cost_usd: string | null;
      credits_used: number; latency_ms: number | null;
      status: string; metadata: Record<string, unknown>; created_at: string;
    };

    const rows = itemsRes.rows as ItemRow[];
    const costItems = rows.map((r) => ({
      itemType: r.item_type,
      component: r.component,
      modelId: r.model_id,
      modelProvider: r.model_provider,
      roundNumber: r.round_number,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      inputTokensFresh: r.input_tokens_fresh,
      inputTokensCached: r.input_tokens_cached,
      cacheWriteTokens: r.cache_write_tokens,
      costUsd: r.cost_usd !== null ? Number(r.cost_usd) : null,
      creditsUsed: r.credits_used,
      latencyMs: r.latency_ms,
      status: r.status,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));

    // Build summary
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCreditsDeducted = 0;
    let routerCallsCount = 0;
    let streamRoundsCount = 0;
    const toolRounds: Record<string, number> = {};

    for (const r of rows) {
      if (r.item_type.startsWith("router_")) {
        routerCallsCount++;
      } else if (r.item_type === "stream_round") {
        streamRoundsCount++;
        totalInputTokens += r.input_tokens;
        totalOutputTokens += r.output_tokens;
        totalCreditsDeducted += r.credits_used;
      } else if (r.item_type.startsWith("tool_") && r.item_type !== "subagent") {
        const name = r.component ?? r.item_type;
        toolRounds[name] = (toolRounds[name] ?? 0) + 1;
      }
    }

    return { promptBreakdown, costItems, summary: { totalInputTokens, totalOutputTokens, totalCreditsDeducted, toolRounds, routerCallsCount, streamRoundsCount } };
  },

  /** Recent messages for router context (ascending by time). */
  async getRecentMessages(
    userId: string,
    conversationId: string,
    limit: number,
  ): Promise<{ messages: Array<{ role: Message["role"]; content: string }>; summaryText: string | null }> {
    const pool = getPool();
    const conv = await pool.query(
      `SELECT summary_text FROM conversations WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [conversationId, userId],
    );
    if (!conv.rowCount) throw Errors.conversationNotFound();
    const summaryText = (conv.rows[0] as { summary_text?: string | null }).summary_text ?? null;
    const res = await pool.query(
      `
      SELECT role, content
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
      [conversationId, limit],
    );
    const rows = (res.rows as Array<{ role: Message["role"]; content: string }>).reverse();
    return {
      messages: rows.map((r) => ({ role: r.role, content: String(r.content ?? "") })),
      summaryText,
    };
  },
};
