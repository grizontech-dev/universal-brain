import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import { createS3Client, getS3BucketName } from "../infra/s3.client.js";
import { storageConfig } from "../config/storage.js";

export interface ArtifactStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  signedUrl(key: string, ttlSec: number): Promise<string>;
  delete(key: string): Promise<void>;
}

class LocalArtifactStorage implements ArtifactStorage {
  private readonly baseDir = path.join(storageConfig.localUploadsDir, "artifacts");

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const fullPath = path.join(this.baseDir, key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(path.join(this.baseDir, key));
  }

  async signedUrl(key: string, _ttlSec: number): Promise<string> {
    return `/internal/artifacts/file/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(path.join(this.baseDir, key)).catch(() => {});
  }
}

class S3ArtifactStorage implements ArtifactStorage {
  private readonly client = createS3Client();
  private readonly bucket = getS3BucketName();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const stream = response.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async signedUrl(key: string, ttlSec: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function getArtifactStorage(): ArtifactStorage {
  return storageConfig.driver === "s3" ? new S3ArtifactStorage() : new LocalArtifactStorage();
}
