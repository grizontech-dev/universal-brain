import { env } from "./env.js";

export const QUEUE_NAMES = {
  chat: "chat",
  file: "file",
  notification: "notification",
  subscriptionRedemption: "subscription-redemption",
} as const;

export const HEARTBEAT_MS = 15_000;

const defaultConcurrency = env.NODE_ENV === "test" ? 1 : 4;

export const WORKER_CONCURRENCY = {
  chat: Number(process.env.WORKER_CONCURRENCY_CHAT ?? defaultConcurrency),
  file: Number(process.env.WORKER_CONCURRENCY_FILE ?? defaultConcurrency),
  notification: Number(process.env.WORKER_CONCURRENCY_NOTIFICATION ?? defaultConcurrency),
} as const;

export const JOB_OPTS = {
  chat: {
    attempts: 1,
    backoff: { type: "exponential" as const, delay: 5_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
  file: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 5_000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
  notification: {
    attempts: 5,
    backoff: { type: "exponential" as const, delay: 5_000 },
    removeOnComplete: 500,
    removeOnFail: 1_000,
  },
} as const;
