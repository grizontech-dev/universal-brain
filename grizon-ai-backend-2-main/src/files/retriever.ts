import { getPool } from "../db/pool.js";
import { ensureCollection, getQdrantClient } from "../infra/qdrant.js";
import { embedText } from "../lib/embeddings.js";

export async function retrieve(fileId: string, userId: string, subQuery?: string): Promise<string> {
  const pool = getPool();
  const fileRes = await pool.query(
    `SELECT id, extracted_text FROM files WHERE id = $1 AND user_id = $2 AND processing_status = 'ready' LIMIT 1`,
    [fileId, userId],
  );
  if (!fileRes.rowCount) return "";

  const collection = `files_${userId}`;
  await ensureCollection(collection, 1536);
  const qdrant = getQdrantClient();

  if (subQuery?.trim()) {
    const embedding = await embedText(subQuery.trim());
    const results = await qdrant.search(collection, {
      vector: embedding,
      limit: 10,
      with_payload: true,
      filter: {
        must: [{ key: "fileId", match: { value: fileId } }],
      },
    });
    return results
      .map((r) => ((r.payload ?? {}) as { text?: string }).text ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  const chunksRes = await pool.query(
    `SELECT qdrant_id, chunk_index FROM file_chunks WHERE file_id = $1 ORDER BY chunk_index ASC LIMIT 20`,
    [fileId],
  );
  if (!chunksRes.rowCount) {
    return String((fileRes.rows[0] as { extracted_text?: string | null }).extracted_text ?? "");
  }
  const ordered = chunksRes.rows as Array<{ qdrant_id: string; chunk_index: number }>;
  const points = await qdrant.retrieve(collection, {
    ids: ordered.map((r) => r.qdrant_id),
    with_payload: true,
  });
  const pointMap = new Map(points.map((p) => [String(p.id), p]));
  return ordered
    .map((row) => {
      const point = pointMap.get(row.qdrant_id);
      return (((point?.payload ?? {}) as { text?: string }).text ?? "").trim();
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}
