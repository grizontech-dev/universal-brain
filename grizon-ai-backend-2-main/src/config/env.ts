import "dotenv/config";

import { z } from "zod";

/** Positive Authkey template id from env string (omit or blank → undefined). */
const optionalAuthkeyMid = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.string().url(),
  APP_VERSION: z.string().min(1),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LOG_PRETTY: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() === "true"),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  REDIS_URL: z.string().min(1),
  ENABLE_BACKGROUND_SCHEDULERS: z
    .string()
    .optional()
    .transform((v) => {
      if (v === "false") return false;
      if (v === "true") return true;
      return process.env.NODE_ENV !== "test";
    }),
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().optional(),
  JWT_PRIVATE_KEY_PATH: z.string().min(1),
  JWT_PUBLIC_KEY_PATH: z.string().min(1),
  JWT_KID: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive(),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive(),
  GOOGLE_CLIENT_IDS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  TURNSTILE_SECRET: z.string().optional(),
  MAIL_PROVIDER: z.enum(["postmark", "resend", "ses", "authkey"]),
  MAIL_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().email(),
  /** Required when MAIL_PROVIDER=authkey (same key powers SMS template sends). */
  AUTHKEY_AUTH_KEY: z.string().optional(),
  AUTHKEY_EMAIL_VERIFY_MID: optionalAuthkeyMid,
  AUTHKEY_PASSWORD_RESET_MID: optionalAuthkeyMid,
  AUTHKEY_NOTIFY_WELCOME_MID: optionalAuthkeyMid,
  AUTHKEY_NOTIFY_NEW_DEVICE_MID: optionalAuthkeyMid,
  AUTHKEY_NOTIFY_PASSWORD_CHANGED_MID: optionalAuthkeyMid,
  AUTHKEY_NOTIFY_BANNED_MID: optionalAuthkeyMid,
  AUTHKEY_NOTIFY_TOPUP_SUCCEEDED_MID: optionalAuthkeyMid,
  AUTHKEY_NOTIFY_RATE_LIMIT_FLAGGED_MID: optionalAuthkeyMid,
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  OPENWEATHERMAP_API_KEY: z.string().optional(),
  MAX_PARALLEL_TOOLS: z.coerce.number().int().positive().max(16).default(3),
  WEB_FETCH_CONCURRENCY: z.coerce.number().int().positive().max(16).default(4),
  JUDGE0_URL: z.string().url().optional(),
  JUDGE0_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  GOOGLE_AI_BASE_URL: z.string().url().optional(),
  XAI_BASE_URL: z.string().url().optional(),
  DEEPSEEK_BASE_URL: z.string().url().optional(),
  MAX_BODY_SIZE_KB: z.coerce.number().int().positive().default(70000),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_UPLOADS_DIR: z.string().min(1).default("./uploads"),
  S3_BUCKET: z.string().optional(),
  /** Required when STORAGE_DRIVER=s3 (unless relying solely on instance IAM role + SDK defaults). */
  AWS_REGION: z.string().optional(),
  /** Optional — LocalStack / MinIO style custom endpoint. */
  S3_ENDPOINT: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  IP_HASH_SALT: z.string().min(1).default("dev-ip-hash-salt"),
  ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ANALYTICS_TOOL_INSIGHTS_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),
  ANALYTICS_JOURNEY_TRACER_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),
  ANALYTICS_PROMPT_CAPTURE_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),
  ANALYTICS_PROMPT_CAPTURE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),

  // PhonePe v2 Payment Gateway
  PHONEPE_CLIENT_ID: z.string().optional(),
  PHONEPE_CLIENT_SECRET: z.string().optional(),
  PHONEPE_CLIENT_VERSION: z.coerce.number().int().positive().default(1),
  PHONEPE_MERCHANT_ID: z.string().optional(),
  // Webhook auth: PhonePe sends Authorization: SHA256(username:password), where
  // username/password are configured in the PhonePe dashboard. Set these two.
  PHONEPE_WEBHOOK_USERNAME: z.string().optional(),
  PHONEPE_WEBHOOK_PASSWORD: z.string().optional(),
  // Fallback: a pre-computed SHA256(username:password) hash, compared directly
  // against the Authorization header (kept for backward compatibility).
  PHONEPE_WEBHOOK_HMAC_KEY: z.string().optional(),
  PHONEPE_SANDBOX: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),
});

const envSchemaRefined = envSchema.superRefine((data, ctx) => {
  if (data.STORAGE_DRIVER !== "s3") return;
  if (!data.S3_BUCKET?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "S3_BUCKET is required when STORAGE_DRIVER=s3",
      path: ["S3_BUCKET"],
    });
  }
  if (!data.AWS_REGION?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "AWS_REGION is required when STORAGE_DRIVER=s3",
      path: ["AWS_REGION"],
    });
  }
});

const envSchemaAuthkey = envSchemaRefined.superRefine((data, ctx) => {
  if (data.MAIL_PROVIDER !== "authkey") return;
  if (!data.AUTHKEY_AUTH_KEY?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "AUTHKEY_AUTH_KEY is required when MAIL_PROVIDER=authkey",
      path: ["AUTHKEY_AUTH_KEY"],
    });
  }
});

const parsed = envSchemaAuthkey.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Environment validation failed:\n${issues}`);
}

export const env = parsed.data;
