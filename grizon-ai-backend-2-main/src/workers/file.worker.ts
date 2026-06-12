import { Worker } from "bullmq";
import { randomUUID } from "crypto";
import path from "path";

import { env } from "../config/env.js";
import { QUEUE_NAMES, WORKER_CONCURRENCY } from "../config/queue.js";
import { getPool } from "../db/pool.js";
import { ensureCollection, getQdrantClient } from "../infra/qdrant.js";
import { embedText } from "../lib/embeddings.js";
import { logger } from "../utils/logger.js";
import { storageService } from "../services/storage.service.js";
import type { FileJobPayload } from "../types/fileJob.js";

function splitIntoChunks(text: string, chunkSizeTokens: number, overlapTokens: number): string[] {
  const chunkChars = chunkSizeTokens * 4;
  const overlapChars = overlapTokens * 4;
  if (!text.trim()) return [];
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(cursor + chunkChars, text.length);
    const chunk = text.slice(cursor, end).trim();
    if (chunk) out.push(chunk);
    if (end >= text.length) break;
    cursor = Math.max(0, end - overlapChars);
  }
  return out;
}

async function parseWithUnstructured(binary: Buffer, fileLabel: string): Promise<string> {
  if (!env.UNSTRUCTURED_API_URL) {
    throw new Error("unstructured_url_not_configured");
  }
  const body = new FormData();
  body.append("files", new Blob([new Uint8Array(binary)]), fileLabel);
  body.append("strategy", "auto");
  const res = await fetch(`${env.UNSTRUCTURED_API_URL}/general/v0/general`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.error({ status: res.status, detail, fileLabel }, "unstructured_api_error");
    throw new Error(`unstructured_api_error:${res.status}`);
  }
  const parsed = (await res.json()) as Array<{ text?: string }>;
  return parsed.map((e) => e.text ?? "").filter(Boolean).join("\n\n");
}

export function startFileWorker() {
  return new Worker<FileJobPayload>(
    QUEUE_NAMES.file,
    async (job) => {
      const pool = getPool();
      const fileId = job.data.fileId;
      try {
        await pool.query(`UPDATE files SET processing_status = 'processing', error_message = NULL WHERE id = $1`, [fileId]);
        const fileRes = await pool.query(
          `SELECT id, user_id, conversation_id, file_type, storage_path FROM files WHERE id = $1 LIMIT 1`,
          [fileId],
        );
        if (!fileRes.rowCount) return;
        const file = fileRes.rows[0] as {
          id: string;
          user_id: string;
          conversation_id: string | null;
          file_type: string;
          storage_path: string;
        };
        const fileLabel = path.basename(file.storage_path);
        const binary = await storageService.readUploadedBytes(file.storage_path);
        let extractedText = "";
        if (
          file.file_type === "application/pdf" ||
          file.file_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.file_type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ) {
          extractedText = await parseWithUnstructured(binary, fileLabel);
        } else if (file.file_type === "text/csv" || file.file_type === "text/plain") {
          extractedText = binary.toString("utf-8");
        } else {
          await pool.query(
            `UPDATE files SET processing_status = 'failed', vectorised = false, error_message = 'unsupported_mime' WHERE id = $1`,
            [fileId],
          );
          return;
        }

        const chunks = splitIntoChunks(extractedText, 1000, 100);
        const collection = `files_${file.user_id}`;
        await ensureCollection(collection, 1536);
        const qdrant = getQdrantClient();

        for (let i = 0; i < chunks.length; i += 20) {
          const batch = chunks.slice(i, i + 20);
          for (let j = 0; j < batch.length; j += 1) {
            const text = batch[j]!;
            const chunkIndex = i + j;
            const embedding = await embedText(text);
            const qdrantId = randomUUID();
            await qdrant.upsert(collection, {
              wait: false,
              points: [
                {
                  id: qdrantId,
                  vector: embedding,
                  payload: {
                    fileId: file.id,
                    chunkIndex,
                    text,
                  },
                },
              ],
            });
            await pool.query(
              `
                INSERT INTO file_chunks (file_id, chunk_index, qdrant_id, page, section, token_count)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (file_id, chunk_index) DO NOTHING
              `,
              [file.id, chunkIndex, qdrantId, null, null, Math.ceil(text.length / 4)],
            );
          }
        }

        const safeText = extractedText.length < 64 * 1024 ? extractedText : null;
        await pool.query(
          `
            UPDATE files
            SET processing_status = 'ready',
                vectorised = true,
                extracted_text = $2,
                error_message = NULL
            WHERE id = $1
          `,
          [file.id, safeText],
        );
        logger.info({ fileId: file.id, conversationId: file.conversation_id }, "file_ready");
      } catch (error) {
        await pool.query(
          `UPDATE files SET processing_status = 'failed', vectorised = false, error_message = $2 WHERE id = $1`,
          [fileId, error instanceof Error ? error.message : "ingestion_failed"],
        );
        logger.error({ err: error, fileId }, "file_worker_ingestion_failed");
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: WORKER_CONCURRENCY.file,
    },
  );
}
