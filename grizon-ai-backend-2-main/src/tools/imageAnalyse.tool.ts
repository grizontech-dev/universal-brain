import { readFile } from "fs/promises";
import path from "path";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import { env } from "../config/env.js";
import { storageConfig } from "../config/storage.js";
import { fileService } from "../services/file.service.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

const VISION_SURCHARGE = 1.5;

async function analyseWithOpenAI(
  base64: string,
  mediaType: string,
  question: string,
): Promise<{ description: string; tokensUsed: number }> {
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY!,
    ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
  });
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      },
    ],
  });
  const text = res.choices[0]?.message?.content ?? "";
  const usage = res.usage;
  const tokensUsed = Math.ceil(((usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0)) * VISION_SURCHARGE);
  return { description: text, tokensUsed };
}

function anthropicImageMediaType(mime: string): "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (m === "image/jpg") return "image/jpeg";
  if (m === "image/png" || m === "image/jpeg" || m === "image/gif" || m === "image/webp") return m;
  return "image/png";
}

async function analyseWithAnthropic(
  base64: string,
  mediaType: string,
  question: string,
): Promise<{ description: string; tokensUsed: number }> {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY!,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
  });
  const mt = anthropicImageMediaType(mediaType);
  const res = await client.messages.create({
    model: "claude-3-5-haiku-20241022",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mt, data: base64 },
          },
          { type: "text", text: question },
        ],
      },
    ],
  });
  const blocks = res.content;
  let text = "";
  for (const b of blocks) {
    if (b.type === "text") text += b.text;
  }
  const inTok = res.usage.input_tokens;
  const outTok = res.usage.output_tokens;
  const tokensUsed = Math.ceil((inTok + outTok) * VISION_SURCHARGE);
  return { description: text, tokensUsed };
}

export async function imageAnalyse(
  params: { reason?: string; file_id: string; question?: string },
  ctx: StreamContext,
): Promise<{ description: string; tokensUsed: number } | { error: string }> {
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
    return { error: "vision_provider_not_configured" };
  }
  const file = await fileService.getByIdForUser(ctx.userId, params.file_id);
  if (file.processingStatus !== "ready") {
    return { error: "file_not_ready" };
  }
  const absPath = path.join(storageConfig.localUploadsDir, file.storagePath);
  const buf = await readFile(absPath);
  const base64 = buf.toString("base64");
  const mediaType = file.fileType.includes("/") ? file.fileType : "image/png";
  const question = params.question ?? "Describe this image in detail.";

  try {
    if (env.ANTHROPIC_API_KEY) {
      return await analyseWithAnthropic(base64, mediaType, question);
    }
    return await analyseWithOpenAI(base64, mediaType, question);
  } catch (err) {
    return { error: String(err) };
  }
}

registerTool({
  name: "image_analyse",
  description: "Analyse an uploaded image file (vision model).",
  parallelSafe: false,
  estimatedLatencyMs: 4000,
  planRequired: "starter",
  featureFlag: "imageAnalyse",
  parametersSchema: {
    type: "object",
    properties: {
      reason: { type: "string" },
      file_id: { type: "string" },
      question: { type: "string" },
    },
    required: ["file_id"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    return imageAnalyse(
      {
        reason: p.reason !== undefined ? String(p.reason) : undefined,
        file_id: String(p.file_id ?? ""),
        question: p.question !== undefined ? String(p.question) : undefined,
      },
      ctx,
    );
  },
});
