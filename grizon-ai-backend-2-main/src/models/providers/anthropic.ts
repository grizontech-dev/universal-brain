import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import { getRedisClient } from "../../infra/redis.js";
import { logger } from "../../utils/logger.js";
import type { ProviderEvent, ProviderMessage, ToolId, ToolSpec } from "../../types/router.js";
import type { Provider, ProviderStreamParams } from "./types.js";

const KEEPALIVE_TTL_SECONDS = 10 * 60;
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
const keepaliveIntervals = new Map<string, NodeJS.Timeout>();

function parseCachedUserContent(content: string): { text: string; cacheControl: boolean } {
  try {
    const parsed = JSON.parse(content) as { text?: string; cache_control?: { type?: string } };
    if (typeof parsed.text === "string" && parsed.cache_control?.type === "ephemeral") {
      return { text: parsed.text, cacheControl: true };
    }
  } catch {
    // Not a cache-tagged payload.
  }
  return { text: content, cacheControl: false };
}

function toAnthropicMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const parsed = parseCachedUserContent(m.content);
      if (parsed.cacheControl) {
        out.push({
          role: "user",
          content: [{ type: "text", text: parsed.text, cache_control: { type: "ephemeral" } }],
        });
      } else {
        out.push({ role: "user", content: m.content });
      }
    } else if (m.role === "assistant") {
      if (m.assistantToolCalls?.length) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (m.content.trim()) {
          blocks.push({ type: "text", text: m.content });
        }
        for (const tc of m.assistantToolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = tc.arguments ? (JSON.parse(tc.arguments) as Record<string, unknown>) : {};
          } catch {
            input = { raw: tc.arguments };
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input,
          });
        }
        out.push({ role: "assistant", content: blocks });
      } else {
        out.push({ role: "assistant", content: m.content });
      }
    } else if (m.role === "tool" && m.toolCallId) {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: m.content,
          },
        ],
      });
    }
  }
  return out;
}

function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      ...(typeof t.parameters === "object" && t.parameters !== null ? t.parameters : {}),
    } as Anthropic.Tool.InputSchema,
  }));
}

async function refreshKeepalive(client: Anthropic, key: string, systemPrompt: string) {
  try {
    await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 1,
      system: systemPrompt,
      messages: [{ role: "user", content: "keepalive" }],
    });
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(key, String(Date.now()), { EX: KEEPALIVE_TTL_SECONDS });
    }
  } catch (error) {
    logger.warn({ err: error, key }, "anthropic_keepalive_refresh_failed");
  }
}

async function startKeepalive(client: Anthropic, params: ProviderStreamParams) {
  const jobId = params.jobId ?? randomUUID();
  const keepaliveKey = `keepalive:job:${jobId}`;
  const systemPrompt =
    typeof params.systemPrompt === "string"
      ? params.systemPrompt
      : JSON.stringify(params.systemPrompt.filter((b) => typeof b === "object"));
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(keepaliveKey, String(Date.now()), { EX: KEEPALIVE_TTL_SECONDS });
  }
  const interval = setInterval(() => {
    void refreshKeepalive(client, keepaliveKey, systemPrompt);
  }, KEEPALIVE_INTERVAL_MS);
  keepaliveIntervals.set(keepaliveKey, interval);
  return keepaliveKey;
}

async function stopKeepalive(keepaliveKey: string | null) {
  if (!keepaliveKey) return;
  const interval = keepaliveIntervals.get(keepaliveKey);
  if (interval) {
    clearInterval(interval);
    keepaliveIntervals.delete(keepaliveKey);
  }
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(keepaliveKey);
  }
}

export function createAnthropicProvider(): Provider | null {
  if (!env.ANTHROPIC_API_KEY?.trim()) return null;

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL,
  });

  return {
    id: "anthropic",
    async *streamCompletion(params: ProviderStreamParams): AsyncIterable<ProviderEvent> {
      const tools = params.tools.length ? toAnthropicTools(params.tools) : undefined;
      const keepaliveKey = await startKeepalive(client, params);

      try {
        const stream = client.messages.stream(
          {
            model: params.modelId,
            max_tokens: params.maxOutputTokens ?? 2048,
            system: params.systemPrompt as string | Anthropic.TextBlockParam[],
            messages: toAnthropicMessages(params.messages),
            tools,
            temperature: params.temperature,
          },
          { signal: params.abortSignal },
        );

        let finishReason: "stop" | "length" | "content_filter" | "tool_use" | "error" = "stop";
        let hasSeenToolUse = false;

        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            hasSeenToolUse = true;
          }
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            // Text emitted before any tool_use block in this stream is preamble
            // ("Let me search…"). Anthropic always emits text content blocks before
            // tool_use blocks, so any text seen so far is preamble if tool_use later
            // appears. The worker speculatively treats it as preamble and promotes it
            // to the answer on `finish` if no tool_use occurred this stream.
            yield {
              type: "chunk",
              delta: event.delta.text,
              phase: hasSeenToolUse ? "answer" : "preamble",
            };
          }
          if (event.type === "message_delta" && event.delta.stop_reason) {
            const sr = event.delta.stop_reason;
            if (sr === "max_tokens") finishReason = "length";
            else if (sr === "tool_use") finishReason = "tool_use";
            else finishReason = "stop";
          }
        }

        const final = await stream.finalMessage();
        for (const block of final.content) {
          if (block.type === "tool_use") {
            yield {
              type: "tool_call",
              toolId: block.name as ToolId,
              arguments: block.input as unknown,
              callId: block.id,
            };
            finishReason = "tool_use";
          }
        }

        const u = final.usage;
        yield {
          type: "usage",
          inputTokensFresh: Math.max(0, u.input_tokens - (u.cache_read_input_tokens ?? 0)),
          inputTokensCached: u.cache_read_input_tokens ?? 0,
          outputTokens: u.output_tokens,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        };

        yield {
          type: "finish",
          reason: finishReason,
          modelUsed: params.modelId,
          provider: "anthropic",
        };
      } finally {
        await stopKeepalive(keepaliveKey);
      }
    },
  };
}

export const anthropicProvider = createAnthropicProvider();
