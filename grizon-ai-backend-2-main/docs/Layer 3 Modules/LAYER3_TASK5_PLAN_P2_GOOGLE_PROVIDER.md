# Layer 3 Task 5 — P2: Google/Gemini Provider Completion
## Implementation Plan

> **Priority:** P2 — Blocks all Google model routing for tool-using agents  
> **Depends on:** Nothing (self-contained provider fix)  
> **Last Updated:** 2026-05-09

---

## Table of Contents
1. [Overview & Current State](#1-overview--current-state)
2. [Fix 1 — Multi-Turn Message Structure](#2-fix-1--multi-turn-message-structure)
3. [Fix 2 — Gemini Function Calling](#3-fix-2--gemini-function-calling)
4. [Fix 3 — Tool Result Injection](#4-fix-3--tool-result-injection)
5. [Fix 4 — Streaming Event Normalisation](#5-fix-4--streaming-event-normalisation)
6. [Testing Verification Points](#6-testing-verification-points)
7. [Files Changed](#7-files-changed)

---

## 1. Overview & Current State

**File:** `src/models/providers/google.ts`

### What's broken

| Issue | Impact |
|---|---|
| All messages + system prompt flattened into a single string | Multi-turn reasoning, context, and tool results are lost |
| `toGoogleTools()` returns `[]` with TODO | No agent on a Google model can call tools |
| No tool result re-injection path | Even if tools emitted calls, results couldn't be sent back |
| `cacheWriteTokens` hardcoded to 0 | Minor — Google doesn't expose this, acceptable |

### Target model
`gemini-1.5-flash` (standard), `gemini-1.5-pro` (premium), `gemini-2.0-flash` (nano).  
The Google Generative AI SDK (`@google/generative-ai`) is already installed.

---

## 2. Fix 1 — Multi-Turn Message Structure

### Current (broken)
```typescript
// Lines 11-13 in current google.ts
const fullPrompt = [params.systemPrompt, ...params.messages.map(m => m.content)].join('\n\n');
const result = await model.generateContentStream(fullPrompt);
```

### Target: Proper `Content[]` format

```typescript
import {
  GoogleGenerativeAI,
  Content,
  Part,
  FunctionDeclaration,
  FunctionCallingMode,
} from '@google/generative-ai';

function toGeminiContents(
  systemPrompt: string,
  messages: ProviderMessage[]
): { systemInstruction: Content; contents: Content[] } {
  // System prompt → systemInstruction (separate field, not in contents[])
  const systemInstruction: Content = {
    role: 'user',           // Gemini uses 'user' for system instruction
    parts: [{ text: systemPrompt }],
  };

  const contents: Content[] = messages.map((msg) => {
    // Map role: 'assistant' → 'model' (Gemini naming)
    const role = msg.role === 'assistant' ? 'model' : 'user';

    // Handle tool result messages
    if (msg.role === 'tool') {
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.toolName ?? 'unknown',
            response: { result: msg.content },
          }
        }],
      };
    }

    // Handle assistant messages that contain tool calls
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'model',
        parts: msg.toolCalls.map(tc => ({
          functionCall: {
            name: tc.name,
            args: tc.arguments,
          }
        })),
      };
    }

    // Regular text message
    return {
      role,
      parts: [{ text: msg.content || '' }],
    };
  });

  return { systemInstruction, contents };
}
```

### Updated `streamCompletion` call
```typescript
const { systemInstruction, contents } = toGeminiContents(params.systemPrompt, params.messages);

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: params.modelId,
  systemInstruction,
  tools: toGoogleTools(params.tools),
  generationConfig: {
    temperature: params.temperature ?? 0.7,
    maxOutputTokens: params.maxOutputTokens ?? 4096,
  },
});

const result = await model.generateContentStream({ contents });
```

---

## 3. Fix 2 — Gemini Function Calling

### Current (broken)
```typescript
function toGoogleTools(_tools: ToolSpec[]): Tool[] {
  // @internal exported for tests — tools path not yet wired for Gemini
  return [];
}
```

### Target: Full Gemini function declaration conversion

```typescript
import {
  Tool as GeminiTool,
  FunctionDeclaration,
  Schema as GeminiSchema,
  SchemaType,
} from '@google/generative-ai';

function toGoogleTools(tools: ToolSpec[]): GeminiTool[] {
  if (!tools || tools.length === 0) return [];

  const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: jsonSchemaToGeminiSchema(t.parametersSchema),
  }));

  return [{ functionDeclarations }];
}

function jsonSchemaToGeminiSchema(schema: Record<string, unknown>): GeminiSchema {
  if (!schema || schema.type !== 'object') {
    return { type: SchemaType.OBJECT, properties: {} };
  }

  const properties = schema.properties as Record<string, any> ?? {};
  const required = schema.required as string[] ?? [];

  const geminiProperties: Record<string, GeminiSchema> = {};
  for (const [key, prop] of Object.entries(properties)) {
    geminiProperties[key] = convertProperty(prop);
  }

  return {
    type: SchemaType.OBJECT,
    properties: geminiProperties,
    required,
  };
}

function convertProperty(prop: any): GeminiSchema {
  const typeMap: Record<string, SchemaType> = {
    string: SchemaType.STRING,
    number: SchemaType.NUMBER,
    integer: SchemaType.INTEGER,
    boolean: SchemaType.BOOLEAN,
    array: SchemaType.ARRAY,
    object: SchemaType.OBJECT,
  };

  const base: GeminiSchema = {
    type: typeMap[prop.type] ?? SchemaType.STRING,
    description: prop.description,
  };

  if (prop.enum) base.enum = prop.enum;
  if (prop.type === 'array' && prop.items) {
    base.items = convertProperty(prop.items);
  }
  if (prop.type === 'object' && prop.properties) {
    base.properties = Object.fromEntries(
      Object.entries(prop.properties).map(([k, v]) => [k, convertProperty(v)])
    );
  }

  return base;
}
```

---

## 4. Fix 3 — Tool Result Injection & Stream Event Emission

The streaming loop needs to detect `functionCall` parts in Gemini response chunks and emit them as `tool_call` events (same shape as Anthropic/OpenAI).

```typescript
// Inside the streaming for-await loop
for await (const chunk of result.stream) {
  const candidate = chunk.candidates?.[0];
  if (!candidate) continue;

  for (const part of candidate.content?.parts ?? []) {
    // Regular text
    if (part.text) {
      yield { type: 'chunk', delta: part.text };
    }

    // Function call (tool call)
    if (part.functionCall) {
      yield {
        type: 'tool_call',
        toolId: part.functionCall.name as ToolName,
        arguments: part.functionCall.args ?? {},
        callId: `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    }
  }

  // Finish reason
  const finishReason = candidate.finishReason;
  if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
    // tool call pending
    if (finishReason === 'FUNCTION_CALL') {
      yield { type: 'finish', reason: 'tool_use', modelUsed: params.modelId, provider: 'google' };
      return;
    }
  }
}

// Final usage
const usageMetadata = (await result.response).usageMetadata;
if (usageMetadata) {
  yield {
    type: 'usage',
    inputTokensFresh: (usageMetadata.promptTokenCount ?? 0) - (usageMetadata.cachedContentTokenCount ?? 0),
    inputTokensCached: usageMetadata.cachedContentTokenCount ?? 0,
    outputTokens: usageMetadata.candidatesTokenCount ?? 0,
    cacheWriteTokens: 0,
  };
}

yield { type: 'finish', reason: 'stop', modelUsed: params.modelId, provider: 'google' };
```

---

## 5. Fix 4 — Streaming Event Normalisation

Gemini can return multiple parts in a single chunk (e.g., text + functionCall together). Ensure the loop handles this correctly by iterating `parts` not just taking `parts[0]`.

Also handle `SAFETY` finish reason:
```typescript
if (finishReason === 'SAFETY') {
  yield { type: 'error', code: 'CONTENT_FILTER', message: 'Response blocked by safety filter', retryable: false };
  return;
}
```

---

## 6. Testing Verification Points

Before marking complete, verify:

1. **Simple chat**: `chat` agent on `gemini-1.5-flash` — single user message → text response streams correctly
2. **Multi-turn**: 3+ message conversation → model sees full history, not just last message
3. **Tool call**: `research` agent on `gemini-1.5-flash` — web_search tool call emitted, result injected, second response generated
4. **Tool whitelist**: Schema conversion round-trip — Anthropic tool spec → Gemini schema → no lost fields
5. **Usage tracking**: `inputTokensCached` populated from `cachedContentTokenCount`

---

## 7. Files Changed

| File | Action |
|---|---|
| `src/models/providers/google.ts` | **Rewrite** — fix message structure, implement toGoogleTools(), tool call streaming |
