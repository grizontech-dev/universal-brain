import { getPool } from "../db/pool.js";
import { conversationEvents } from "../events/conversation.events.js";
import { invalidateSessionCache } from "../memory/session.memory.js";
import { Errors } from "../utils/errors.js";

/** Deterministic summariser (Module 8). For LLM-backed summaries, Module 10 exposes `buildNanoChatDecision` + `streamCompletion` when a plan snapshot is available. */

export const summariserService = {
  async run(conversationId: string): Promise<{ updated: boolean; tokensSaved: number }> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const convRes = await client.query(`SELECT * FROM conversations WHERE id = $1 FOR UPDATE`, [conversationId]);
      if (!convRes.rowCount) throw Errors.conversationNotFound();
      const convo = convRes.rows[0] as Record<string, unknown>;
      const msgRes = await client.query(
        `
        SELECT id, content, input_tokens, output_tokens
        FROM messages
        WHERE conversation_id = $1 AND is_included_in_summary = false
        ORDER BY created_at ASC
      `,
        [conversationId],
      );
      if ((msgRes.rowCount ?? 0) < 8) {
        await client.query("COMMIT");
        return { updated: false, tokensSaved: 0 };
      }
      const rows = msgRes.rows as Array<Record<string, unknown>>;
      const span = rows.slice(0, Math.floor(rows.length / 2));
      const summary = span
        .map((r, idx) => `${idx + 1}. ${String(r.content ?? "").slice(0, 240)}`)
        .join("\n")
        .slice(0, 4_000);
      const tokenBefore = span.reduce(
        (sum, r) => sum + Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0),
        0,
      );
      const tokenAfter = Math.max(1, Math.ceil(summary.length / 4));
      const lastId = String(span[span.length - 1]?.id);
      await client.query(`UPDATE messages SET is_included_in_summary = true WHERE id = ANY($1::uuid[])`, [
        span.map((r) => String(r.id)),
      ]);
      await client.query(
        `
        UPDATE conversations
        SET summary_text = $2, summarised_up_to_msg_id = $3,
            total_tokens_used = GREATEST(0, total_tokens_used - $4 + $5),
            updated_at = now()
        WHERE id = $1
      `,
        [conversationId, summary, lastId, tokenBefore, tokenAfter],
      );
      await client.query("COMMIT");
      await invalidateSessionCache(conversationId);
      const tokensSaved = Math.max(0, tokenBefore - tokenAfter);
      conversationEvents.emit("conversation.summarised", {
        conversationId,
        userId: String(convo.user_id),
        tokensSaved,
      });
      return { updated: true, tokensSaved };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
