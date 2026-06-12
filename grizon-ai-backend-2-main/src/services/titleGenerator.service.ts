import { getPool } from "../db/pool.js";
import { logger } from "../utils/logger.js";
import { callSystemModel } from "../runtime/systemModel.js";

function fallbackTitle(content: string): string {
  const stripped = content.trim().replace(/\s+/g, " ");
  return stripped.length <= 60 ? stripped : `${stripped.slice(0, 57)}...`;
}

export async function generateConversationTitle(
  conversationId: string,
  firstUserMessage: string,
): Promise<string | null> {
  const pool = getPool();

  // Guard: only run if the conversation still has the default title and hasn't been titled yet.
  // The second condition in the UPDATE prevents a race if two jobs fire simultaneously.
  const check = await pool.query(
    `SELECT id FROM conversations WHERE id = $1 AND title = 'New Conversation' AND title_generated_at IS NULL LIMIT 1`,
    [conversationId],
  );
  if (!check.rowCount) return null;

  let title = fallbackTitle(firstUserMessage);

  const prompt = `Generate a concise title (max 60 characters) for a conversation that starts with this message. Reply with only the title, no quotes:\n\n${firstUserMessage.slice(0, 500)}`;

  try {
    const result = await callSystemModel({
      tier: "light",
      systemPrompt: "You generate short conversation titles.",
      userMessage: prompt,
      // 1024 gives reasoning models (e.g. deepseek-v4-flash) enough budget to
      // finish their chain-of-thought and still emit the actual title.
      // Non-reasoning models (gemini, gpt-4o-mini) stop at ~5–10 tokens anyway.
      maxTokens: 1024,
      temperature: 0.3,
    });

    if (result.text.length > 0) {
      title = result.text.replace(/^["']|["']$/g, "").slice(0, 60);
    } else {
      logger.warn({ conversationId, model: result.model }, "title_generator_empty_response_using_fallback");
    }
  } catch (err) {
    logger.warn({ err, conversationId }, "title_generator_ai_failed_using_fallback");
  }

  // Use title_generated_at IS NULL to make the update idempotent under race conditions.
  await pool.query(
    `UPDATE conversations SET title = $1, title_generated_at = now(), updated_at = now()
     WHERE id = $2 AND title_generated_at IS NULL`,
    [title, conversationId],
  );

  logger.info({ conversationId, title }, "conversation_title_generated");
  return title;
}
