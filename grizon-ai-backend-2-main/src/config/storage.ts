import { env } from "./env.js";

export const storageConfig = {
  driver: env.STORAGE_DRIVER,
  localUploadsDir: env.LOCAL_UPLOADS_DIR,
  s3Bucket: env.S3_BUCKET,
  s3Region: env.AWS_REGION,
  s3Endpoint: env.S3_ENDPOINT,
  s3AccessKeyId: env.AWS_ACCESS_KEY_ID,
  s3SecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
};
