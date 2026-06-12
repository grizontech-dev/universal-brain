import { v5 as uuidv5 } from "uuid";

import { getPool } from "../db/pool.js";
import { embedText } from "../lib/embeddings.js";
import { ensureCollection, getQdrantClient } from "../infra/qdrant.js";
import { logger } from "../utils/logger.js";

const CACHE_COLLECTION = "semantic_cache";
// Namespace for deterministic UUID v5 point IDs — ensures the same query always upserts
// the same Qdrant point (deduplication) without using a raw hex string that Qdrant rejects.
const SEMANTIC_CACHE_NS = "6f1c2e6e-2b8a-4a4f-9c2c-3b9b1f7e1a01" as const;
const SIMILARITY_THRESHOLD = 0.92;
const FACTUAL_SCORE_THRESHOLD = 0.7;
const ELIGIBLE_AGENTS = new Set(["chat", "writer", "research"]);
const TTL_MAP: Record<string, number> = {
  generic: 7 * 24 * 3600,
  search_grounded: 4 * 3600,
  code: 24 * 3600,
};

type CacheContentType = "generic" | "search_grounded" | "code";

interface CachePayload {
  answer: string;
  agent_slug: string;
  contentType: CacheContentType;
  factualScore: number;
  createdAt: string;
}

export interface SemanticCacheHit {
  answer: string;
  cacheId: string;
  similarity: number;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasPiiTokens(text: string): boolean {
  return (
    /\b\d{3}-\d{2}-\d{4}\b/.test(text) ||
    /\b[A-Z]{1,2}\d{6,9}\b/.test(text) ||
    /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/.test(text)
  );
}

function estimateFactualScore(answer: string): number {
  if (!answer.trim()) return 0.5;
  if (answer.includes("I think") || answer.includes("maybe")) return 0.6;
  return 0.9;
}

export function inferContentType(agentSlug: string): CacheContentType {
  if (agentSlug === "research") return "search_grounded";
  if (agentSlug === "writer") return "generic";
  return "generic";
}

export async function lookupSemanticCache(args: {
  agentSlug: string;
  query: string;
  hasFileAttachments: boolean;
  userOptedOut: boolean;
}): Promise<SemanticCacheHit | null> {
  if (!ELIGIBLE_AGENTS.has(args.agentSlug)) return null;
  if (args.hasFileAttachments || args.userOptedOut || hasPiiTokens(args.query)) return null;

  try {
    await ensureCollection(CACHE_COLLECTION, 1536);
    const queryEmbedding = await embedText(normalizeQuery(args.query));
    const results = await getQdrantClient().search(CACHE_COLLECTION, {
      vector: queryEmbedding,
      limit: 5,
      with_payload: true,
      filter: {
        must: [{ key: "agent_slug", match: { value: args.agentSlug } }],
      },
    });

    for (const result of results) {
      const payload = result.payload as CachePayload | null;
      if (!payload) continue;
      const ttl = (TTL_MAP[payload.contentType] ?? TTL_MAP.generic) * 1000;
      const age = Date.now() - new Date(payload.createdAt).getTime();
      if (
        result.score >= SIMILARITY_THRESHOLD &&
        payload.factualScore >= FACTUAL_SCORE_THRESHOLD &&
        age < ttl
      ) {
        return {
          answer: payload.answer,
          cacheId: String(result.id),
          similarity: result.score,
        };
      }
    }
  } catch (error) {
    logger.warn({ err: error, agent: args.agentSlug }, "semantic_cache_lookup_failed");
  }
  return null;
}

export async function writeSemanticCache(args: {
  agentSlug: string;
  query: string;
  answer: string;
  contentType: CacheContentType;
}): Promise<void> {
  if (!ELIGIBLE_AGENTS.has(args.agentSlug) || hasPiiTokens(args.query)) return;
  try {
    await ensureCollection(CACHE_COLLECTION, 1536);
    const id = uuidv5(`${args.agentSlug}:${normalizeQuery(args.query)}`, SEMANTIC_CACHE_NS);
    const embedding = await embedText(normalizeQuery(args.query));
    await getQdrantClient().upsert(CACHE_COLLECTION, {
      wait: false,
      points: [
        {
          id,
          vector: embedding,
          payload: {
            answer: args.answer,
            agent_slug: args.agentSlug,
            contentType: args.contentType,
            factualScore: estimateFactualScore(args.answer),
            createdAt: new Date().toISOString(),
          },
        },
      ],
    });
  } catch (error) {
    logger.warn({ err: error, agent: args.agentSlug }, "semantic_cache_write_failed");
  }
}

export async function recordSemanticCacheHit(args: {
  userId: string;
  cacheId: string;
  similarity: number;
  savedCredits: number;
}): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO semantic_cache_hits (user_id, cache_id, similarity, saved_credits) VALUES ($1, $2, $3, $4)`,
      [args.userId, args.cacheId, args.similarity, args.savedCredits],
    );
  } catch (error) {
    logger.warn({ err: error, userId: args.userId }, "semantic_cache_hit_record_failed");
  }
}
