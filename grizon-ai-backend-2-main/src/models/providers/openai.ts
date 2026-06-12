import OpenAI from "openai";

import { env } from "../../config/env.js";
import type { ProviderEvent, ProviderMessage, ToolId, ToolSpec } from "../../types/router.js";
import type { Provider, ProviderStreamParams } from "./types.js";

function toOpenAIMessages(
  systemPrompt: string | object[],
  messages: ProviderMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: typeof systemPrompt === "string" ? systemPrompt : JSON.stringify(systemPrompt) },
  ];
  for (const m of messages) {
    if (m.role === "tool" && m.toolCallId) {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      });
    } else if (m.role === "assistant") {
      if (m.assistantToolCalls?.length) {
        out.push({
          role: "assistant",
          content: m.content || null,
          tool_calls: m.assistantToolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      } else {
        out.push({ role: "assistant", content: m.content });
      }
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    }
  }
  return out;
}

function toOpenAITools(tools: ToolSpec[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// o1 family: no tools, no temperature (OpenAI hides reasoning server-side, nothing to replay)
function isO1Model(modelId: string): boolean {
  return modelId === "o1" || modelId.startsWith("o1-");
}

// DeepSeek models have thinking ON by default; we disable it so they behave as standard
// chat models (tools + temperature work, no reasoning_content replay required)
function isDeepSeekModel(modelId: string): boolean {
  return (
    modelId === "deepseek-reasoner" ||
    modelId === "deepseek-v4-flash" ||
    modelId === "deepseek-v4-pro"
  );
}

export function createOpenAIProvider(opts: {
  id: import("../../types/router.js").ProviderId;
  baseURL?: string;
  apiKey: string | undefined;
}): Provider | null {
  if (!opts.apiKey?.trim()) return null;

  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
  });

  return {
    id: opts.id,
    async *streamCompletion(params: ProviderStreamParams): AsyncIterable<ProviderEvent> {
      const o1 = isO1Model(params.modelId);
      const deepseek = isDeepSeekModel(params.modelId);
      const tools = o1 ? [] : toOpenAITools(params.tools);
      const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: params.modelId,
        messages: toOpenAIMessages(params.systemPrompt, params.messages),
        stream: true,
        tools: tools.length ? tools : undefined,
        stream_options: { include_usage: true },
        max_tokens: params.maxOutputTokens,
      };
      if (!o1 && params.temperature !== undefined) {
        body.temperature = params.temperature;
      }
      if (deepseek) {
        (body as unknown as Record<string, unknown>).thinking = { type: "disabled" };
      }

      const stream = await client.chat.completions.create(body, { signal: params.abortSignal });

      const toolBuf = new Map<
        number,
        { id?: string; name?: string; args: string }
      >();

      let finishReason: "stop" | "length" | "content_filter" | "tool_use" | "error" = "stop";

      // Speculative-preamble buffer.
      //
      // Unlike Anthropic (which interleaves text_delta and tool_use blocks in a
      // single response), OpenAI-compatible providers stream all text chunks
      // first and only emit tool_calls at the very end (finish_reason=tool_calls).
      // This means we cannot know while streaming whether a given text chunk is
      // the final answer or pre-tool narration ("Let me search…").
      //
      // Strategy: buffer text chunks. Once we know the finish_reason we either
      // re-emit them as answer chunks (finish=stop) or as preamble (finish=tool_use).
      // Preamble chunks are tagged phase:"preamble" so the worker routes them to
      // the SSE "status" channel (shown briefly in the UI, not persisted to DB).
      const textChunkBuf: string[] = [];

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) {
          if (chunk.usage) {
            const u = chunk.usage;
            const cached =
              (u as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0;
            yield {
              type: "usage",
              inputTokensFresh: Math.max(0, (u.prompt_tokens ?? 0) - cached),
              inputTokensCached: cached,
              outputTokens: u.completion_tokens ?? 0,
              cacheWriteTokens: 0,
            };
          }
          continue;
        }

        const delta = choice.delta;
        if (delta?.content) {
          // Buffer instead of yielding immediately — we don't know the phase yet.
          textChunkBuf.push(delta.content);
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            const cur = toolBuf.get(i) ?? { args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolBuf.set(i, cur);
          }
        }

        if (choice.finish_reason) {
          const fr = choice.finish_reason;
          if (fr === "length") finishReason = "length";
          else if (fr === "content_filter") finishReason = "content_filter";
          else if (fr === "tool_calls") finishReason = "tool_use";
          else finishReason = "stop";
        }

        if (chunk.usage) {
          const u = chunk.usage;
          const cached =
            (u as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0;
          yield {
            type: "usage",
            inputTokensFresh: Math.max(0, (u.prompt_tokens ?? 0) - cached),
            inputTokensCached: cached,
            outputTokens: u.completion_tokens ?? 0,
            cacheWriteTokens: 0,
          };
        }
      }

      // Now we know whether this round ended with tool calls or not.
      // Flush the buffered text with the correct phase tag.
      const isTurnWithTools = toolBuf.size > 0;
      for (const delta of textChunkBuf) {
        yield {
          type: "chunk",
          delta,
          phase: isTurnWithTools ? "preamble" : "answer",
        } as ProviderEvent;
      }

      if (toolBuf.size > 0) {
        const sorted = [...toolBuf.entries()].sort((a, b) => a[0] - b[0]);
        for (const [, data] of sorted) {
          let parsed: unknown = {};
          try {
            parsed = data.args ? JSON.parse(data.args) : {};
          } catch {
            parsed = { raw: data.args };
          }
          const name = data.name ?? "unknown";
          yield {
            type: "tool_call",
            toolId: name as ToolId,
            arguments: parsed,
            callId: data.id ?? name,
          };
        }
      }

      yield {
        type: "finish",
        reason: finishReason,
        modelUsed: params.modelId,
        provider: opts.id,
      };
    },
  };
}

export const openaiProvider = createOpenAIProvider({
  id: "openai",
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL,
});
