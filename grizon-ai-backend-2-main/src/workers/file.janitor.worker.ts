import { getPool } from "../db/pool.js";
import { getQdrantClient } from "../infra/qdrant.js";
import { storageService } from "../services/storage.service.js";
import { logger } from "../utils/logger.js";

/**
 * Files uploaded but never attached to a sent message are considered orphans.
 * We give users 2 hours to send their message before the file is purged.
 */
const ORPHAN_TTL_HOURS = 2;

/** Max files cleaned per tick to avoid long-running transactions. */
const BATCH_LIMIT = 50;

type OrphanRow = {
  id: string;
  user_id: string;
  storage_path: string;
};

/**
 * Purges a single file — Qdrant vectors, storage binary, then DB row.
 * All external calls are best-effort; DB delete always runs last.
 */
async function purgeFile(file: OrphanRow): Promise<void> {
  const pool = getPool();

  // Collect Qdrant point IDs before CASCADE removes them
  const chunkRes = await pool.query(
    `SELECT qdrant_id FROM file_chunks WHERE file_id = $1`,
    [file.id],
  );
  const qdrantIds = (chunkRes.rows as { qdrant_id: string }[]).map((r) => r.qdrant_id);

  // Delete Qdrant vectors
  if (qdrantIds.length > 0) {
    try {
      const qdrant = getQdrantClient();
      await qdrant.delete(`files_${file.user_id}`, { points: qdrantIds });
    } catch (err) {
      logger.warn({ err, fileId: file.id }, "file_janitor_qdrant_cleanup_failed");
    }
  }

  // Delete storage binary
  try {
    await storageService.delete(file.storage_path);
  } catch (err) {
    logger.warn({ err, fileId: file.id, storagePath: file.storage_path }, "file_janitor_storage_cleanup_failed");
  }

  // Delete DB row — CASCADE removes file_chunks automatically
  await pool.query(`DELETE FROM files WHERE id = $1`, [file.id]);
}

/**
 * Finds and purges orphan files:
 * - uploaded more than ORPHAN_TTL_HOURS ago
 * - never attached to a sent message (message_id IS NULL)
 *
 * Runs on every background scheduler tick (every 10 minutes).
 */
export async function runFileJanitorOnce(): Promise<void> {
  const pool = getPool();

  const res = await pool.query(
    `
    SELECT id, user_id, storage_path
    FROM files
    WHERE message_id IS NULL
      AND uploaded_at < now() - ($1::text || ' hours')::interval
    ORDER BY uploaded_at ASC
    LIMIT $2
    `,
    [String(ORPHAN_TTL_HOURS), String(BATCH_LIMIT)],
  );

  if (!res.rowCount) return;

  logger.info({ count: res.rowCount }, "file_janitor_purging_orphans");

  for (const file of res.rows as OrphanRow[]) {
    try {
      await purgeFile(file);
      logger.info({ fileId: file.id, userId: file.user_id }, "file_janitor_purged");
    } catch (err) {
      logger.error({ err, fileId: file.id }, "file_janitor_purge_failed");
    }
  }
}
