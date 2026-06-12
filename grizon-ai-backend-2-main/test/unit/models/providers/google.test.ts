import { SchemaType } from "@google/generative-ai";
import { describe, expect, it } from "vitest";

import {
  jsonSchemaToGeminiParameters,
  toGeminiContents,
  toGoogleTools,
} from "../../../../src/models/providers/google.js";
import type { ProviderMessage } from "../../../../src/types/router.js";

describe("toGeminiContents", () => {
  it("maps user and plain assistant turns", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const contents = toGeminiContents(messages);
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi there" }] },
    ]);
  });

  it("maps assistant tool calls with parsed arguments", () => {
    const messages: ProviderMessage[] = [
      {
        role: "assistant",
        content: "",
        assistantToolCalls: [
          {
            id: "call-1",
            name: "web_search",
            arguments: JSON.stringify({ query: "pandas", priority: "high" }),
          },
        ],
      },
    ];
    const contents = toGeminiContents(messages);
    expect(contents[0]).toMatchObject({
      role: "model",
      parts: [
        {
          functionCall: {
            name: "web_search",
            args: { query: "pandas", priority: "high" },
          },
        },
      ],
    });
  });

  it("maps tool results using toolName for functionResponse", () => {
    const messages: ProviderMessage[] = [
      {
        role: "tool",
        toolCallId: "550e8400-e29b-41d4-a716-446655440000",
        toolName: "web_search",
        content: '{"results":[]}',
      },
    ];
    const contents = toGeminiContents(messages);
    expect(contents[0]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: "web_search",
            response: { result: '{"results":[]}' },
          },
        },
      ],
    });
  });

  it("interleaves text and functionCall parts when assistant has both", () => {
    const messages: ProviderMessage[] = [
      {
        role: "assistant",
        content: "Searching now.",
        assistantToolCalls: [
          {
            id: "c1",
            name: "web_search",
            arguments: "{}",
          },
        ],
      },
    ];
    const contents = toGeminiContents(messages);
    expect(contents[0]?.parts?.length).toBe(2);
    expect(contents[0]?.parts?.[0]).toEqual({ text: "Searching now." });
    expect(contents[0]?.parts?.[1]).toMatchObject({
      functionCall: { name: "web_search", args: {} },
    });
  });
});

describe("jsonSchemaToGeminiParameters / toGoogleTools", () => {
  it("converts web_search-style schema with enum string field", () => {
    const schema = jsonSchemaToGeminiParameters({
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        priority: { type: "string", enum: ["standard", "high"] },
        max_results: { type: "number" },
      },
      required: ["query"],
    });
    expect(schema.type).toBe(SchemaType.OBJECT);
    expect(schema.required).toEqual(["query"]);
    expect(schema.properties.query).toMatchObject({ type: SchemaType.STRING });
    expect(schema.properties.priority).toMatchObject({
      type: SchemaType.STRING,
      format: "enum",
      enum: ["standard", "high"],
    });
    expect(schema.properties.max_results).toMatchObject({ type: SchemaType.NUMBER });
  });

  it("wraps tools in functionDeclarations tool shape", () => {
    const tools = toGoogleTools([
      {
        name: "web_search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      functionDeclarations: [
        {
          name: "web_search",
          description: "Search the web",
        },
      ],
    });
    const decl = tools[0]?.functionDeclarations?.[0];
    expect(decl?.parameters?.type).toBe(SchemaType.OBJECT);
    expect(decl?.parameters?.properties?.query).toMatchObject({ type: SchemaType.STRING });
  });

  it("returns empty array when tools list is empty", () => {
    expect(toGoogleTools([])).toEqual([]);
  });
});
