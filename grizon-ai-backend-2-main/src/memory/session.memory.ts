import { getPool } from "../db/pool.js";
import { getRedisClient } from "../infra/redis.js";
import type { ProviderMessage } from "../types/router.js";
import { logger } from "../utils/logger.js";

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const KEY = (conversationId: string) => `session:${conversationId}`;

async function loadMessagesFromDb(conversationId: string): Promise<ProviderMessage[]> {
  const pool = getPool();
  const conv = await pool.query(`SELECT summary_text FROM conversations WHERE id = $1 LIMIT 1`, [
    conversationId,
  ]);
  const summaryRaw = (conv.rows[0] as { summary_text?: string | null } | undefined)?.summary_text;
  const summaryText = typeof summaryRaw === "string" ? summaryRaw.trim() : "";

  const rows = await pool.query(
    `
    SELECT role, content
    FROM messages
    WHERE conversation_id = $1
      AND role IN ('user', 'assistant')
      AND is_included_in_summary = false
    ORDER BY created_at ASC
    LIMIT 50
    `,
    [conversationId],
  );

  const tail = (rows.rows as Array<{ role: string; content: string }>)
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));

  if (!summaryText) {
    return tail;
  }

  return [
    {
      role: "user",
      content: `Conversation summary:\n${summaryText}`,
    },
    {
      role: "assistant",
      content: "Understood. Continuing from the summary above.",
    },
    ...tail,
  ];
}

/** Clears cached session transcript after summarisation so the next hydrate reloads DB shape. */
export async function invalidateSessionCache(conversationId: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.del(KEY(conversationId));
  } catch (error) {
    logger.debug({ err: error, conversationId }, "session_memory_invalidate_failed");
  }
}

export async function hydrateSession(
  conversationId: string,
  options?: { bypassCache?: boolean },
): Promise<ProviderMessage[]> {
  const redis = await getRedisClient();
  if (redis && !options?.bypassCache) {
    try {
      const cached = await redis.get(KEY(conversationId));
      if (cached) {
        return JSON.parse(cached) as ProviderMessage[];
      }
    } catch (error) {
      logger.debug({ err: error, conversationId }, "session_memory_hydrate_cache_failed");
    }
  }

  const messages = await loadMessagesFromDb(conversationId);

  if (redis) {
    try {
      await redis.setEx(KEY(conversationId), SESSION_TTL_SECONDS, JSON.stringify(messages));
    } catch (error) {
      logger.debug({ err: error, conversationId }, "session_memory_hydrate_set_failed");
    }
  }

  return messages;
}

export async function persistSession(conversationId: string, messages: ProviderMessage[]): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.setEx(KEY(conversationId), SESSION_TTL_SECONDS, JSON.stringify(messages));
  } catch (error) {
    logger.debug({ err: error, conversationId }, "session_memory_persist_failed");
  }
}
