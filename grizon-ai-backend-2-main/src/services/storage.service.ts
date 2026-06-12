import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { storageConfig } from "../config/storage.js";
import { createS3Client, getS3BucketName } from "../infra/s3.client.js";

const MIME_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "video/mp4": ".mp4",
};

function safeExt(mimeType: string): string {
  return MIME_EXT[mimeType] ?? "";
}

function uploadsKey(relPath: string): string {
  const normalised = relPath.split(path.sep).join("/");
  return `uploads/${normalised}`;
}

async function readObjectBody(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const storageService = {
  async write(
    content: Buffer,
    args: { userId: string; fileType: string },
  ): Promise<{ path: string; driver: "local" | "s3" }> {
    const ext = safeExt(args.fileType);
    const relPath = path.join(args.userId, `${randomUUID()}${ext}`);

    if (storageConfig.driver === "s3") {
      const client = createS3Client();
      const bucket = getS3BucketName();
      const key = uploadsKey(relPath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: args.fileType,
        }),
      );
      return { path: relPath, driver: "s3" };
    }

    const absPath = path.join(storageConfig.localUploadsDir, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, content);
    return { path: relPath, driver: "local" };
  },

  /** Load raw bytes for a path returned by `write` (local disk or S3 `uploads/` prefix). */
  async readUploadedBytes(relPath: string): Promise<Buffer> {
    if (storageConfig.driver === "s3") {
      const client = createS3Client();
      const bucket = getS3BucketName();
      const out = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: uploadsKey(relPath),
        }),
      );
      if (!out.Body) {
        throw new Error("S3 GetObject returned empty body.");
      }
      return readObjectBody(out.Body as NodeJS.ReadableStream);
    }

    const absPath = path.join(storageConfig.localUploadsDir, relPath);
    return readFile(absPath);
  },

  /** Delete a file from local disk or S3. Best-effort — does not throw if file is missing. */
  async delete(relPath: string): Promise<void> {
    if (storageConfig.driver === "s3") {
      const client = createS3Client();
      const bucket = getS3BucketName();
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: uploadsKey(relPath),
        }),
      );
      return;
    }

    const absPath = path.join(storageConfig.localUploadsDir, relPath);
    await unlink(absPath).catch((err: NodeJS.ErrnoException) => {
      // ENOENT = already gone, not an error worth surfacing
      if (err.code !== "ENOENT") throw err;
    });
  },
};
