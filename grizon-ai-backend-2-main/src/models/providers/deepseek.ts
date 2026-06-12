import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { createOpenAIProvider } from "./openai.js";

if (!env.DEEPSEEK_API_KEY?.trim()) {
  logger.warn("DEEPSEEK_API_KEY is not set. deepseek provider will be disabled.");
}

export const deepseekProvider =
  createOpenAIProvider({
    id: "deepseek",
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  }) ?? null;
