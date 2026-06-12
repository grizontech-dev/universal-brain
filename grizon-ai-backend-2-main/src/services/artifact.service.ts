import { getPool } from "../db/pool.js";
import { generatePreview } from "../artifacts/preview.js";
import { getArtifactStorage } from "../artifacts/artifact.storage.js";
import { conversationEvents } from "../events/conversation.events.js";
import { Errors } from "../utils/errors.js";
import type { Artifact } from "../types/conversation.js";

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapArtifact(row: Row): Artifact {
  const rawSize = row.file_size;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    conversationId: String(row.conversation_id),
    messageId: (row.message_id as string | null) ?? null,
    title: String(row.title),
    type: String(row.type),
    parentId: (row.parent_id as string | null) ?? null,
    versionNumber: Number(row.version_number ?? 1),
    contentHash: (row.content_hash as string | null) ?? null,
    storagePath: (row.storage_path as string | null) ?? null,
    contentText: (row.content_text as string | null) ?? null,
    createdByAgent: String(row.created_by_agent),
    isLatest: Boolean(row.is_latest),
    previewHtml: (row.preview_html as string | null) ?? null,
    previewGeneratedAt: row.preview_generated_at ? toIso(row.preview_generated_at) : null,
    fileSize: rawSize != null && rawSize !== "" ? Number(rawSize) : null,
    createdAt: toIso(row.created_at),
  };
}

function resolveFileSize(args: {
  fileSize?: number | null;
  contentText?: string | null;
}): number | null {
  if (args.fileSize != null && Number.isFinite(args.fileSize) && args.fileSize >= 0) {
    return Math.trunc(args.fileSize);
  }
  if (args.contentText) {
    return Buffer.byteLength(args.contentText, "utf-8");
  }
  return null;
}

const INLINE_LIMIT_BYTES = 64 * 1024;

export const artifactService = {
  async create(args: {
    userId: string;
    conversationId: string;
    messageId?: string | null;
    title: string;
    type: string;
    contentText?: string | null;
    storagePath?: string | null;
    contentHash?: string | null;
    fileSize?: number | null;
    createdByAgent: string;
    parentId?: string | null;
    maxVersions: number;
  }): Promise<Artifact> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let parentId = args.parentId ?? null;
      let versionNumber = 1;
      let contentText = args.contentText ?? null;
      let storagePath = args.storagePath ?? null;
      let fileSize = resolveFileSize({ fileSize: args.fileSize, contentText });
      if (contentText && Buffer.byteLength(contentText, "utf-8") > INLINE_LIMIT_BYTES) {
        if (fileSize == null) {
          fileSize = Buffer.byteLength(contentText, "utf-8");
        }
        const key = `${args.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.txt`;
        await getArtifactStorage().put(key, Buffer.from(contentText, "utf-8"), "text/plain");
        contentText = null;
        storagePath = key;
      }
      if (parentId) {
        const parent = await client.query(
          `SELECT * FROM artifacts WHERE id = $1 AND user_id = $2 FOR UPDATE LIMIT 1`,
          [parentId, args.userId],
        );
        if (!parent.rowCount) throw Errors.artifactNotFound();
        const count = await client.query(
          `SELECT COUNT(*)::int AS c FROM artifacts WHERE user_id = $1 AND (id = $2 OR parent_id = $2)`,
          [args.userId, parentId],
        );
        const chainCount = Number((count.rows[0] as { c?: number } | undefined)?.c ?? 0);
        if (chainCount >= args.maxVersions) throw Errors.artifactVersionLimit(args.maxVersions);
        const maxV = await client.query(
          `SELECT COALESCE(MAX(version_number), 0)::int AS v FROM artifacts WHERE user_id = $1 AND (id = $2 OR parent_id = $2)`,
          [args.userId, parentId],
        );
        versionNumber = Number((maxV.rows[0] as { v?: number } | undefined)?.v ?? 0) + 1;
        await client.query(`UPDATE artifacts SET is_latest = false WHERE user_id = $1 AND (id = $2 OR parent_id = $2)`, [
          args.userId,
          parentId,
        ]);
      }
      const ins = await client.query(
        `
        INSERT INTO artifacts (user_id, conversation_id, message_id, title, type, parent_id, version_number, content_hash, storage_path, content_text, file_size, created_by_agent, is_latest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
        RETURNING *
      `,
        [
          args.userId,
          args.conversationId,
          args.messageId ?? null,
          args.title,
          args.type,
          parentId,
          versionNumber,
          args.contentHash ?? null,
          storagePath,
          contentText,
          fileSize,
          args.createdByAgent,
        ],
      );
      const createdRow = ins.rows[0] as Row;
      const preview = await generatePreview({
        type: String(createdRow.type),
        contentText: (createdRow.content_text as string | null) ?? null,
      });
      if (preview.previewHtml !== null) {
        await client.query(
          `UPDATE artifacts SET preview_html = $1, preview_generated_at = now() WHERE id = $2`,
          [preview.previewHtml, String(createdRow.id)],
        );
      }
      const reloaded = await client.query(`SELECT * FROM artifacts WHERE id = $1 LIMIT 1`, [String(createdRow.id)]);
      await client.query("COMMIT");
      const artifact = mapArtifact((reloaded.rows[0] as Row) ?? createdRow);
      conversationEvents.emit("artifact.created", {
        artifactId: artifact.id,
        userId: artifact.userId,
        conversationId: artifact.conversationId,
      });
      return artifact;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getById(userId: string, id: string): Promise<Artifact> {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM artifacts WHERE id = $1 AND user_id = $2 LIMIT 1`, [id, userId]);
    if (!res.rowCount) throw Errors.artifactNotFound();
    const mapped = mapArtifact(res.rows[0] as Row);
    if (!mapped.contentText && mapped.storagePath) {
      try {
        const buf = await getArtifactStorage().get(mapped.storagePath);
        mapped.contentText = buf.toString("utf-8");
      } catch {
        // Best effort: keep null when storage read fails.
      }
    }
    return mapped;
  },

  async listLatest(userId: string, limit: number): Promise<Artifact[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM artifacts WHERE user_id = $1 AND is_latest = true ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return (res.rows as Row[]).map(mapArtifact);
  },

  async listByConversationId(userId: string, conversationId: string, limit: number): Promise<Artifact[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM artifacts
       WHERE user_id = $1 AND conversation_id = $2 AND is_latest = true
       ORDER BY created_at DESC LIMIT $3`,
      [userId, conversationId, limit],
    );
    return (res.rows as Row[]).map(mapArtifact);
  },

  /**
   * Fetch latest artifacts for a set of message IDs in one query.
   * Used by the conversation controller to enrich messages with their generated artifacts.
   */
  async listByMessageIds(userId: string, messageIds: string[]): Promise<Artifact[]> {
    if (messageIds.length === 0) return [];
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM artifacts
       WHERE user_id = $1
         AND message_id = ANY($2::uuid[])
         AND is_latest = true
       ORDER BY created_at ASC`,
      [userId, messageIds],
    );
    return (res.rows as Row[]).map(mapArtifact);
  },

  async listVersions(userId: string, id: string): Promise<Artifact[]> {
    const root = await this.getById(userId, id);
    const chainRoot = root.parentId ?? root.id;
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT * FROM artifacts
      WHERE user_id = $1 AND (id = $2 OR parent_id = $2)
      ORDER BY version_number ASC
    `,
      [userId, chainRoot],
    );
    return (res.rows as Row[]).map(mapArtifact);
  },

  async fork(args: {
    userId: string;
    id: string;
    title?: string;
    contentText?: string | null;
    createdByAgent: string;
    maxVersions: number;
  }): Promise<Artifact> {
    const source = await this.getById(args.userId, args.id);
    return this.create({
      userId: args.userId,
      conversationId: source.conversationId,
      messageId: source.messageId,
      title: args.title ?? source.title,
      type: source.type,
      contentText: args.contentText ?? source.contentText,
      storagePath: source.storagePath,
      contentHash: source.contentHash,
      fileSize:
        args.contentText != null
          ? resolveFileSize({ contentText: args.contentText })
          : source.fileSize,
      createdByAgent: args.createdByAgent,
      parentId: source.parentId ?? source.id,
      maxVersions: args.maxVersions,
    });
  },

  async deleteForUser(userId: string, id: string): Promise<void> {
    const pool = getPool();
    const res = await pool.query(`DELETE FROM artifacts WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!res.rowCount) throw Errors.artifactNotFound();
  },
};
