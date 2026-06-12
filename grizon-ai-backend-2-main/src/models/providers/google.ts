import {
  BlockReason,
  FinishReason,
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Schema,
  type Tool,
} from "@google/generative-ai";
import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { ProviderEvent, ProviderMessage, ToolId, ToolSpec } from "../../types/router.js";
import type { Provider, ProviderStreamParams } from "./types.js";

function systemPromptText(systemPrompt: string | object[]): string {
  return typeof systemPrompt === "string" ? systemPrompt : JSON.stringify(systemPrompt);
}

function parseToolArguments(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { raw: json };
  }
}

/** @internal Exported for unit tests. */
export function toGeminiContents(messages: ProviderMessage[]): Content[] {
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content ?? "" }] });
      continue;
    }

    if (msg.role === "system") {
      contents.push({ role: "user", parts: [{ text: msg.content ?? "" }] });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: Content["parts"] = [];
      if (msg.content?.trim()) {
        parts.push({ text: msg.content });
      }
      if (msg.assistantToolCalls?.length) {
        for (const tc of msg.assistantToolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: parseToolArguments(tc.arguments ?? "{}"),
            },
          });
        }
      }
      if (parts.length === 0) {
        parts.push({ text: "" });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    if (msg.role === "tool") {
      const name =
        (typeof msg.toolName === "string" ? msg.toolName : undefined) ??
        msg.toolCallId ??
        "unknown";
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: { result: msg.content ?? "" },
            },
          },
        ],
      });
    }
  }

  return contents;
}

function convertJsonSchemaProperty(prop: unknown): Schema {
  if (!prop || typeof prop !== "object") {
    return { type: SchemaType.STRING };
  }

  const p = prop as Record<string, unknown>;
  const description = typeof p.description === "string" ? p.description : undefined;
  const desc = description ? { description } : {};

  if (Array.isArray(p.enum) && p.enum.every((x) => typeof x === "string")) {
    return {
      type: SchemaType.STRING,
      format: "enum",
      enum: p.enum as string[],
      ...desc,
    };
  }

  switch (p.type) {
    case "number":
      return { type: SchemaType.NUMBER, ...desc };
    case "integer":
      return { type: SchemaType.INTEGER, ...desc };
    case "boolean":
      return { type: SchemaType.BOOLEAN, ...desc };
    case "array": {
      const items = p.items;
      const itemsSchema =
        items && typeof items === "object"
          ? convertJsonSchemaProperty(items)
          : ({ type: SchemaType.STRING } satisfies Schema);
      return {
        type: SchemaType.ARRAY,
        items: itemsSchema,
        ...desc,
      };
    }
    case "object": {
      const nestedProps = (p.properties as Record<string, unknown>) ?? {};
      const req = (p.required as string[]) ?? [];
      const geminiNested: Record<string, Schema> = {};
      for (const [k, v] of Object.entries(nestedProps)) {
        geminiNested[k] = convertJsonSchemaProperty(v);
      }
      return {
        type: SchemaType.OBJECT,
        properties: geminiNested,
        ...(req.length ? { required: req } : {}),
        ...desc,
      };
    }
    default:
      return { type: SchemaType.STRING, ...desc };
  }
}

/** @internal Exported for unit tests. */
export function jsonSchemaToGeminiParameters(schema: Record<string, unknown>): FunctionDeclarationSchema {
  if (!schema || schema.type !== "object") {
    return { type: SchemaType.OBJECT, properties: {} };
  }

  const properties = (schema.properties as Record<string, unknown>) ?? {};
  const required = (schema.required as string[]) ?? [];
  const geminiProps: Record<string, Schema> = {};
  for (const [key, prop] of Object.entries(properties)) {
    geminiProps[key] = convertJsonSchemaProperty(prop);
  }

  return {
    type: SchemaType.OBJECT,
    properties: geminiProps,
    ...(required.length ? { required } : {}),
  };
}

/** @internal Exported for unit tests — Gemini tools path. */
export function toGoogleTools(tools: ToolSpec[]): Tool[] {
  if (!tools?.length) return [];

  const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: jsonSchemaToGeminiParameters(t.parameters as Record<string, unknown>),
  }));

  return [{ functionDeclarations }];
}

function finishReasonIsSafety(fr: FinishReason | string | undefined): boolean {
  if (!fr) return false;
  return (
    fr === FinishReason.SAFETY ||
    fr === FinishReason.BLOCKLIST ||
    fr === FinishReason.PROHIBITED_CONTENT ||
    fr === FinishReason.SPII ||
    fr === FinishReason.RECITATION
  );
}

function mapFinishReason(
  fr: FinishReason | string | undefined,
): Extract<ProviderEvent, { type: "finish" }>["reason"] {
  if (fr === FinishReason.MAX_TOKENS) return "length";
  if (finishReasonIsSafety(fr)) return "content_filter";
  return "stop";
}

export function createGoogleProvider(): Provider | null {
  if (!env.GOOGLE_AI_API_KEY?.trim()) return null;

  const requestOptions =
    env.GOOGLE_AI_BASE_URL?.trim() ?
      { baseUrl: env.GOOGLE_AI_BASE_URL.trim() }
    : undefined;

  const genAI = new GoogleGenerativeAI(env.GOOGLE_AI_API_KEY);

  return {
    id: "google",
    async *streamCompletion(params: ProviderStreamParams): AsyncIterable<ProviderEvent> {
      const contents = toGeminiContents(params.messages);
      const geminiTools = toGoogleTools(params.tools);

      const model = genAI.getGenerativeModel(
        {
          model: params.modelId,
          systemInstruction: systemPromptText(params.systemPrompt),
          tools: geminiTools.length ? geminiTools : undefined,
          toolConfig:
            geminiTools.length ?
              { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
            : undefined,
          generationConfig: {
            temperature: params.temperature ?? 0.7,
            maxOutputTokens: params.maxOutputTokens ?? 4096,
          },
        },
        requestOptions,
      );

      const result = await model.generateContentStream(
        { contents },
        { signal: params.abortSignal },
      );

      for await (const chunk of result.stream) {
        if (chunk.promptFeedback?.blockReason === BlockReason.SAFETY) {
          yield {
            type: "error",
            code: "CONTENT_FILTER",
            message: "Prompt blocked by safety filter",
            retryable: false,
          };
          return;
        }

        const cand = chunk.candidates?.[0];
        if (!cand) continue;

        if (finishReasonIsSafety(cand.finishReason)) {
          yield {
            type: "error",
            code: "CONTENT_FILTER",
            message: "Response blocked by safety filter",
            retryable: false,
          };
          return;
        }

        if (cand.finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
          yield {
            type: "error",
            code: "MALFORMED_FUNCTION_CALL",
            message: cand.finishMessage ?? "Model returned an invalid function call",
            retryable: false,
          };
          return;
        }

        for (const part of cand.content?.parts ?? []) {
          if ("text" in part && part.text) {
            yield { type: "chunk", delta: part.text };
          }
        }
      }

      let response: Awaited<typeof result.response>;
      try {
        response = await result.response;
      } catch (err) {
        yield {
          type: "error",
          code: "STREAM_ERROR",
          message: String(err),
          retryable: true,
        };
        return;
      }

      if (response.promptFeedback?.blockReason === BlockReason.SAFETY) {
        yield {
          type: "error",
          code: "CONTENT_FILTER",
          message: "Prompt blocked by safety filter",
          retryable: false,
        };
        return;
      }

      const meta = response.usageMetadata;
      yield {
        type: "usage",
        inputTokensFresh: Math.max(0, (meta?.promptTokenCount ?? 0) - (meta?.cachedContentTokenCount ?? 0)),
        inputTokensCached: meta?.cachedContentTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
        cacheWriteTokens: 0,
      };

      let functionCalls: FunctionCall[] | undefined;
      try {
        functionCalls = response.functionCalls();
      } catch {
        functionCalls = undefined;
      }

      if (functionCalls?.length) {
        for (const fc of functionCalls) {
          yield {
            type: "tool_call",
            toolId: fc.name as ToolId,
            arguments: fc.args ?? {},
            callId: randomUUID(),
          };
        }
        yield {
          type: "finish",
          reason: "tool_use",
          modelUsed: params.modelId,
          provider: "google",
        };
        return;
      }

      const cand = response.candidates?.[0];
      const fr = cand?.finishReason;

      if (finishReasonIsSafety(fr)) {
        yield {
          type: "error",
          code: "CONTENT_FILTER",
          message: "Response blocked by safety filter",
          retryable: false,
        };
        return;
      }

      if (fr && fr !== FinishReason.STOP && fr !== FinishReason.FINISH_REASON_UNSPECIFIED) {
        logger.warn({ finishReason: fr, modelId: params.modelId }, "google_stream_finish_reason");
      }

      yield {
        type: "finish",
        reason: mapFinishReason(fr),
        modelUsed: params.modelId,
        provider: "google",
      };
    },
  };
}

export const googleProvider = createGoogleProvider();
