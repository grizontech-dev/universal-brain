import { S3Client } from "@aws-sdk/client-s3";

import { storageConfig } from "../config/storage.js";

export function createS3Client(): S3Client {
  const region = storageConfig.s3Region?.trim();
  if (!region) {
    throw new Error("AWS_REGION is required for S3 operations.");
  }
  const endpoint = storageConfig.s3Endpoint?.trim();
  const accessKeyId = storageConfig.s3AccessKeyId?.trim();
  const secretAccessKey = storageConfig.s3SecretAccessKey?.trim();
  return new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
}

export function getS3BucketName(): string {
  const bucket = storageConfig.s3Bucket?.trim();
  if (!bucket) {
    throw new Error("S3_BUCKET is required for S3 operations.");
  }
  return bucket;
}
