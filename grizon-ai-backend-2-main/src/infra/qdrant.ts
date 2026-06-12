import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "../config/env.js";

const VECTOR_SIZE = 1536;

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
    });
  }
  return client;
}

export async function ensureCollection(
  name: string,
  vectorSize = VECTOR_SIZE,
  distance: "Cosine" | "Dot" = "Cosine",
): Promise<void> {
  const qdrant = getQdrantClient();
  const existing = await qdrant.collectionExists(name);
  if (!existing.exists) {
    await qdrant.createCollection(name, {
      vectors: { size: vectorSize, distance },
    });
  }
}
