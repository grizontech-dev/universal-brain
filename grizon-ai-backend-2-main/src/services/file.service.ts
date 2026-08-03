import { getPool } from "../db/pool.js";
import { conversationEvents } from "../events/conversation.events.js";
import { getQdrantClient } from "../infra/qdrant.js";
import { storageService } from "./storage.service.js";
import { Errors } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { MessageFile } from "../types/conversation.js";

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapFile(row: Row): MessageFile {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    conversationId: (row.conversation_id as string | null) ?? null,
    messageId: (row.message_id as string | null) ?? null,
    fileName: String(row.file_name),
    fileType: String(row.file_type),
    fileSize: Number(row.file_size),
    storagePath: String(row.storage_path),
    processingStatus: row.processing_status as MessageFile["processingStatus"],
    extractedText: (row.extracted_text as string | null) ?? null,
    vectorised: Boolean(row.vectorised),
    errorMessage: (row.error_message as string | null) ?? null,
    uploadedAt: toIso(row.uploaded_at),
  };
}

export const fileService = {
  async create(args: {
    userId: string;
    conversationId?: string | null;
    fileName: string;
    fileType: string;
    fileSize: number;
    storagePath: string;
  }): Promise<MessageFile> {
    const pool = getPool();
    const res = await pool.query(
      `
      INSERT INTO files (user_id, conversation_id, file_name, file_type, file_size, storage_path, processing_status)
      VALUES ($1,$2,$3,$4,$5,$6,'pending')
      RETURNING *
    `,
      [args.userId, args.conversationId ?? null, args.fileName, args.fileType, args.fileSize, args.storagePath],
    );
    const file = mapFile(res.rows[0] as Row);
    conversationEvents.emit("file.uploaded", {
      fileId: file.id,
      userId: file.userId,
      conversationId: file.conversationId,
    });
    return file;
  },

  async markReady(fileId: string, extractedText: string): Promise<MessageFile> {
    const pool = getPool();
    const res = await pool.query(
      `
      UPDATE files
      SET processing_status = 'ready', extracted_text = $2, vectorised = true, error_message = NULL
      WHERE id = $1
      RETURNING *
    `,
      [fileId, extractedText],
    );
    if (!res.rowCount) throw Errors.notFound("File");
    const file = mapFile(res.rows[0] as Row);
    conversationEvents.emit("file.ready", { fileId: file.id, userId: file.userId });
    return file;
  },

  async markFailed(fileId: string, errorMessage: string): Promise<MessageFile> {
    const pool = getPool();
    const res = await pool.query(
      `
      UPDATE files
      SET processing_status = 'failed', vectorised = false, error_message = $2
      WHERE id = $1
      RETURNING *
    `,
      [fileId, errorMessage],
    );
    if (!res.rowCount) throw Errors.notFound("File");
    return mapFile(res.rows[0] as Row);
  },

  async getByIdForUser(userId: string, id: string): Promise<MessageFile> {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM files WHERE id = $1 AND user_id = $2 LIMIT 1`, [id, userId]);
    if (!res.rowCount) throw Errors.notFound("File");
    return mapFile(res.rows[0] as Row);
  },

  async listByConversationId(userId: string, conversationId: string, limit: number): Promise<MessageFile[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM files
       WHERE user_id = $1 AND conversation_id = $2
       ORDER BY uploaded_at DESC LIMIT $3`,
      [userId, conversationId, limit],
    );
    return (res.rows as Row[]).map(mapFile);
  },

  async countActiveForConversation(userId: string, conversationId: string): Promise<number> {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM files
      WHERE user_id = $1 AND conversation_id = $2 AND processing_status != 'failed'
    `,
      [userId, conversationId],
    );
    return Number((res.rows[0] as { count?: number } | undefined)?.count ?? 0);
  },

  async deleteForUser(userId: string, id: string): Promise<void> {
    const pool = getPool();

    // 1. Fetch the file row first — need storage_path before we delete it
    const fileRes = await pool.query(
      `SELECT storage_path FROM files WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, userId],
    );
    if (!fileRes.rowCount) throw Errors.notFound("File");
    const storagePath = String((fileRes.rows[0] as { storage_path: string }).storage_path);

    // 2. Collect Qdrant point IDs from file_chunks before CASCADE removes them
    const chunkRes = await pool.query(
      `SELECT qdrant_id FROM file_chunks WHERE file_id = $1`,
      [id],
    );
    const qdrantIds = (chunkRes.rows as { qdrant_id: string }[]).map((r) => r.qdrant_id);

    // 3. Delete Qdrant vectors (best-effort — don't block DB delete on Qdrant failure)
    if (qdrantIds.length > 0) {
      try {
        const qdrant = getQdrantClient();
        await qdrant.delete(`files_${userId}`, { points: qdrantIds });
      } catch (err) {
        logger.warn({ err, fileId: id, userId }, "file_delete_qdrant_cleanup_failed");
      }
    }

    // 4. Delete binary from storage (best-effort)
    try {
      await storageService.delete(storagePath);
    } catch (err) {
      logger.warn({ err, fileId: id, storagePath }, "file_delete_storage_cleanup_failed");
    }

    // 5. Delete DB row — CASCADE removes file_chunks automatically
    await pool.query(`DELETE FROM files WHERE id = $1 AND user_id = $2`, [id, userId]);
  },

  async getManyByIds(
    userId: string,
    fileIds: string[],
  ): Promise<Pick<MessageFile, "id" | "fileName" | "fileType" | "fileSize" | "processingStatus" | "uploadedAt">[]> {
    if (fileIds.length === 0) return [];
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, file_name, file_type, file_size, processing_status, uploaded_at
       FROM files WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [fileIds, userId],
    );
    return (res.rows as Row[]).map((row) => ({
      id: String(row.id),
      fileName: String(row.file_name),
      fileType: String(row.file_type),
      fileSize: Number(row.file_size),
      processingStatus: row.processing_status as MessageFile["processingStatus"],
      uploadedAt: toIso(row.uploaded_at),
    }));
  },

  async getReadyFile(
    userId: string,
    fileId: string,
  ): Promise<{
    id: string;
    mimeType: string;
    extractedText: string | null;
    vectorised: boolean;
  }> {
    let file = await this.getByIdForUser(userId, fileId);

    // Poll up to 10 seconds if file is still processing/pending
    let attempts = 0;
    while (file && file.processingStatus !== "ready" && file.processingStatus !== "failed" && attempts < 10) {
      await new Promise((res) => setTimeout(res, 1000));
      file = await this.getByIdForUser(userId, fileId);
      attempts++;
    }

    if (!file || (file.processingStatus !== "ready" && !file.extractedText)) {
      throw Errors.attachedFileNotReady();
    }
    return {
      id: file.id,
      mimeType: file.fileType,
      extractedText: file.extractedText || `[Attached File: ${file.originalName}]`,
      vectorised: file.vectorised,
    };
  },

  async getReadyFiles(
    userId: string,
    fileIds: string[],
  ): Promise<
    Array<{ id: string; mimeType: string; extractedText: string | null; vectorised: boolean }>
  > {
    const out: Array<{ id: string; mimeType: string; extractedText: string | null; vectorised: boolean }> = [];
    for (const id of fileIds) {
      try {
        out.push(await this.getReadyFile(userId, id));
      } catch {
        /* skip missing / not ready */
      }
    }
    return out;
  },
};
