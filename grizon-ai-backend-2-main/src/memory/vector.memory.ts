import { v5 as uuidv5 } from "uuid";

import OpenAI from "openai";

import { env } from "../config/env.js";
import { getPool } from "../db/pool.js";
import { ensureCollection, getQdrantClient } from "../infra/qdrant.js";
import { embedText } from "../lib/embeddings.js";
import { logger } from "../utils/logger.js";

const openaiClient = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  : null;

// Qdrant collection names cannot contain ":" — use a flat underscore-separated name.
const FACT_NS = "b3e6e4d4-1d8a-4f6e-9e3b-2a1c8b9d7e02" as const;

function collectionForUser(userId: string): string {
  return `mem_${userId.replace(/-/g, "")}`;
}

// Returns a deterministic UUID v5 so the same fact always maps to the same point
// (preserving upsert deduplication and delete-by-id consistency).
function factPointId(userId: string, fact: string): string {
  return uuidv5(`${userId}:${fact}`, FACT_NS);
}

async function extractFacts(assistantMessage: string, userMessage: string): Promise<string[]> {
  if (!openaiClient) return [];
  const completion = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "From this exchange, list at most 3 durable facts about the user. One fact per line. If none, output 'none'.",
      },
      {
        role: "user",
        content: `User message:\n${userMessage}\n\nAssistant message:\n${assistantMessage}`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.toLowerCase() !== "none")
    .slice(0, 3);
}

export async function extractAndStoreFacts(
  userId: string,
  assistantMessage: string,
  userMessage: string,
  sourceMessageId: string,
): Promise<void> {
  try {
    const facts = await extractFacts(assistantMessage, userMessage);
    if (!facts.length) return;

    const pool = getPool();
    const collection = collectionForUser(userId);
    await ensureCollection(collection, 1536);

    for (const fact of facts) {
      const vector = await embedText(fact);
      const pointId = factPointId(userId, fact);
      await getQdrantClient().upsert(collection, {
        wait: false,
        points: [
          {
            id: pointId,
            vector,
            payload: {
              fact,
              sourceMessageId,
              createdAt: new Date().toISOString(),
              confidence: 0.8,
            },
          },
        ],
      });

      await pool.query(
        `
        INSERT INTO memory_facts (user_id, fact, source_message_id, confidence)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, fact) DO NOTHING
        `,
        [userId, fact, sourceMessageId, 0.8],
      );
    }
  } catch (error) {
    logger.warn({ err: error, userId }, "memory_extract_store_failed");
  }
}

export async function recallFacts(userId: string, query: string): Promise<string[]> {
  try {
    const collection = collectionForUser(userId);
    await ensureCollection(collection, 1536);
    const queryEmbedding = await embedText(query);
    const results = await getQdrantClient().search(collection, {
      vector: queryEmbedding,
      limit: 5,
      with_payload: true,
    });
    return results
      .map((r) => (r.payload as { fact?: string } | null)?.fact)
      .filter((fact): fact is string => Boolean(fact));
  } catch (error) {
    logger.warn({ err: error, userId }, "memory_recall_failed");
    return [];
  }
}

export async function deleteFactVector(userId: string, fact: string): Promise<void> {
  try {
    const pointId = factPointId(userId, fact);
    await getQdrantClient().delete(collectionForUser(userId), {
      wait: false,
      points: [pointId],
    });
  } catch (error) {
    logger.warn({ err: error, userId }, "memory_delete_vector_failed");
  }
}

export async function purgeUserMemoryCollection(userId: string): Promise<void> {
  try {
    await getQdrantClient().deleteCollection(collectionForUser(userId));
  } catch (error) {
    logger.warn({ err: error, userId }, "memory_purge_collection_failed");
  }
}
