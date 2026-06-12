import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { createOpenAIProvider } from "./openai.js";

if (!env.XAI_API_KEY?.trim()) {
  logger.warn("XAI_API_KEY is not set. xai provider will be disabled.");
}

export const xaiProvider =
  createOpenAIProvider({
    id: "xai",
    apiKey: env.XAI_API_KEY,
    baseURL: env.XAI_BASE_URL ?? "https://api.x.ai/v1",
  }) ?? null;
