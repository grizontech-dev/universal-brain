import OpenAI from "openai";

import { env } from "../config/env.js";

const openaiClient = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  : null;

export async function embedText(text: string): Promise<number[]> {
  if (!openaiClient) {
    throw new Error("OPENAI_API_KEY is required for embeddings.");
  }
  const result = await openaiClient.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: text,
  });
  return result.data[0]?.embedding ?? [];
}
