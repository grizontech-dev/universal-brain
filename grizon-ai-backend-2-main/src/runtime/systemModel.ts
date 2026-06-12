/**
 * Provider-agnostic utility for system/utility model calls (title generation,
 * subagent tasks, etc.). Reads model from system_model_config — no plan gating.
 *
 * Supports: claude-* (Anthropic), gemini-* (Google), deepseek-* (DeepSeek), grok-* (xAI), everything else (OpenAI).
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

import { env } from "../config/env.js";
import { getPool } from "../db/pool.js";
import { logger } from "../utils/logger.js";

export type SystemModelTier = "light" | "medium" | "high";

const TIER_DEFAULTS: Record<SystemModelTier, string> = {
  light: "gpt-4o-mini",
  medium: "gpt-4o-mini",
  high: "gpt-4o",
};

const anthropicClient = env.ANTHROPIC_API_KEY?.trim()
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL })
  : null;

const openaiClient = env.OPENAI_API_KEY?.trim()
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL })
  : null;

const googleClient = env.GOOGLE_AI_API_KEY?.trim()
  ? new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY)
  : null;

const deepseekClient = env.DEEPSEEK_API_KEY?.trim()
  ? new OpenAI({ apiKey: env.DEEPSEEK_API_KEY, baseURL: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1" })
  : null;

const xaiClient = env.XAI_API_KEY?.trim()
  ? new OpenAI({ apiKey: env.XAI_API_KEY, baseURL: env.XAI_BASE_URL ?? "https://api.x.ai/v1" })
  : null;

export async function resolveSystemModel(tier: SystemModelTier): Promise<string> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT models FROM system_model_config WHERE tier = $1 LIMIT 1`,
    [tier],
  );
  const models = (res.rows[0] as { models?: unknown[] } | undefined)?.models;

  if (Array.isArray(models) && models.length > 0) {
    const first = models[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const c = first as { model_id?: string; modelId?: string };
      if (c.model_id) return c.model_id;
      if (c.modelId) return c.modelId;
    }
  }

  const fallback = TIER_DEFAULTS[tier];
  logger.warn(
    { tier, fallback, rawModels: models },
    `system_model_config no usable model for tier "${tier}" — falling back to "${fallback}"`,
  );
  return fallback;
}

export interface SystemModelCallOptions {
  tier: SystemModelTier;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}

export interface SystemModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export async function callSystemModel(options: SystemModelCallOptions): Promise<SystemModelResult> {
  const { systemPrompt, userMessage, maxTokens = 300, temperature = 0.3 } = options;
  const model = await resolveSystemModel(options.tier);

  if (model.startsWith("claude-")) {
    if (!anthropicClient) throw new Error("ANTHROPIC_API_KEY is required to use Claude system models.");
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    const block = response.content[0];
    return {
      text: block?.type === "text" ? block.text.trim() : "",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
    };
  }

  if (model.startsWith("gemini-")) {
    if (!googleClient) throw new Error("GOOGLE_AI_API_KEY is required to use Gemini system models.");
    const genModel = googleClient.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    });
    const result = await genModel.generateContent(userMessage);
    const text = result.response.text().trim();
    const usage = result.response.usageMetadata;
    return {
      text,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      model,
    };
  }

  if (model.startsWith("deepseek-")) {
    if (!deepseekClient) throw new Error("DEEPSEEK_API_KEY is required to use DeepSeek system models.");
    // Disable DeepSeek's built-in reasoning/thinking mode — same fix as the
    // chat streaming provider (openai.ts). Without this, reasoning models spend
    // all their token budget on chain-of-thought and return empty content.
    const deepseekBody = {
      model,
      stream: false as const,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userMessage },
      ],
      thinking: { type: "disabled" },
    } as unknown as Parameters<typeof deepseekClient.chat.completions.create>[0] & { stream: false };

    const completion = await deepseekClient.chat.completions.create(deepseekBody);
    const choice = completion.choices[0];

    if (choice?.finish_reason === "length") {
      logger.warn(
        { model, maxTokens },
        `system_model deepseek hit max_tokens (${maxTokens}) before producing content`,
      );
    }

    return {
      text: choice?.message?.content?.trim() ?? "",
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model,
    };
  }

  if (model.startsWith("grok-")) {
    if (!xaiClient) throw new Error("XAI_API_KEY is required to use xAI system models.");
    const completion = await xaiClient.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    return {
      text: completion.choices[0]?.message?.content?.trim() ?? "",
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model,
    };
  }

  // OpenAI-compatible (default)
  if (!openaiClient) throw new Error("OPENAI_API_KEY is required to use OpenAI system models.");
  const completion = await openaiClient.chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });
  return {
    text: completion.choices[0]?.message?.content?.trim() ?? "",
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    model,
  };
}
