# Layer 3 Task 4 — P1: Tool System Completion
## Implementation Plan

> **Priority:** P1 — Blocks research, UI, analyst, and deep_research agents  
> **Depends on:** Nothing (self-contained)  
> **Last Updated:** 2026-05-09

---

## Table of Contents
1. [Overview & Scope](#1-overview--scope)
2. [Web Search Strategy Redesign](#2-web-search-strategy-redesign)
3. [New Tool: web_fetch](#3-new-tool-web_fetch)
4. [New Tool: html_generate](#4-new-tool-html_generate)
5. [New Tool: chart_generate](#5-new-tool-chart_generate)
6. [New Tool: image_analyse](#6-new-tool-image_analyse)
7. [New Tool: stock_data (Yahoo Finance)](#7-new-tool-stock_data-yahoo-finance)
8. [New Tool: get_weather](#8-new-tool-get_weather)
9. [Fix file_gen (PDF + TXT)](#9-fix-file_gen-pdf--txt)
10. [Tool Registry](#10-tool-registry)
11. [Parallel Tool Execution](#11-parallel-tool-execution)
12. [Agent Descriptor Updates](#12-agent-descriptor-updates)
13. [Feature Flags & Plan Updates](#13-feature-flags--plan-updates)
14. [Packages Required](#14-packages-required)
15. [Files Changed / Created](#15-files-changed--created)

---

## 1. Overview & Scope

Current state:
- `webSearch.tool.ts`: Tavily primary, Brave fallback — **needs to be flipped**
- `web_fetch`: does not exist
- `html_generate`: does not exist
- `chart_generate`: does not exist
- `image_analyse`: does not exist
- `stock_data`: does not exist (new feature)
- `get_weather`: does not exist (new feature)
- `file_gen`: PDF is stored as raw text, TXT not handled
- `tools/index.ts`: sequential switch, no registry, no parallelism

All of these are implemented inside `src/tools/` and wired through `src/tools/index.ts` (the tool dispatcher), with agent descriptors updated in `src/agents/`.

---

## 2. Web Search Strategy Redesign

### Decision
**Brave Search = primary (all requests)**  
**Tavily = high-priority only** (triggered when `priority: 'high'` is passed OR agent is `research` / `deep_research` OR query complexity is `complex`)

### Rationale
- Brave is cheaper per call; good enough for most searches
- Tavily returns richer structured results with citations — worth the cost only for research-grade tasks
- The caller (agent loop / router) passes a priority signal

### Changes to `src/tools/webSearch.tool.ts`

```typescript
// New parameter shape
interface WebSearchParams {
  reason: string;
  query: string;
  priority?: 'standard' | 'high';    // 'standard' = Brave, 'high' = Tavily
  max_results?: number;               // default 5
  summarise?: boolean;                // trigger subagent summarisation
}
```

**Logic:**
```
priority === 'high' AND TAVILY_API_KEY configured
  → call Tavily
  → on Tavily failure → fall back to Brave
priority === 'standard' OR priority undefined
  → call Brave
  → on Brave failure → if TAVILY_API_KEY configured → fall back to Tavily
  → on both failure → return { results: [], engine: 'none' }
```

**Result shape stays the same:**
```typescript
interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  source: string;     // 'brave' | 'tavily'
}
```

### Who sets priority?
- `src/workers/chat.worker.ts` passes agent slug into tool context
- Tool reads `ctx.agentSlug` and maps `research | deep_research` → `'high'`
- Tool also checks `ctx.queryComplexity === 'complex'` → `'high'`
- Caller can also explicitly pass `priority: 'high'` in params

### ToolContext additions (in `src/tools/index.ts` and types)
```typescript
interface ToolContext {
  // ...existing fields...
  agentSlug: string;
  queryComplexity?: 'simple' | 'medium' | 'complex';
}
```

---

## 3. New Tool: web_fetch

**File:** `src/tools/webFetch.tool.ts`

### Purpose
Fetch and parse the readable text content of a URL. Used by research and deep_research agents to read specific pages found by web_search.

### SSRF Guard (required)
Before any HTTP request, validate the URL:
```typescript
import { URL } from 'url';

function isUrlSafe(rawUrl: string): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  // Block private ranges and localhost
  const blocked = [
    /^localhost$/i, /^127\./, /^10\./, /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^0\.0\.0\.0$/,
    /\.internal$/, /\.local$/
  ];
  return !blocked.some(r => r.test(host));
}
```

### Implementation steps

1. Validate URL with `isUrlSafe()` — return error if blocked
2. Fetch with 10s timeout via `AbortController`
3. Check Content-Type — only process `text/html`, `text/plain`, `application/json`; reject others
4. For HTML: use `@mozilla/readability` + `jsdom` to extract readable article text
5. Truncate to 8000 tokens (≈32000 chars) before returning to LLM
6. Return `{ url, title, text, wordCount }`

```typescript
export interface WebFetchParams {
  reason: string;
  url: string;
  extract?: 'article' | 'full';   // default 'article'
}

export interface WebFetchResult {
  url: string;
  title: string;
  text: string;
  wordCount: number;
}

export async function webFetch(
  params: WebFetchParams,
  _ctx: ToolContext
): Promise<ToolResult<WebFetchResult>> { ... }
```

### Package
```
npm install @mozilla/readability jsdom
npm install --save-dev @types/jsdom
```

---

## 4. New Tool: html_generate

**File:** `src/tools/htmlGenerate.tool.ts`

### Purpose
Take HTML/CSS/JS content from the LLM and materialise it as an `html` artifact. The preview pipeline already handles `html` artifact type — this tool is the missing bridge.

### Parameters
```typescript
export interface HtmlGenerateParams {
  reason: string;
  html: string;           // full HTML document from LLM
  title: string;          // artifact title
  description?: string;
}
```

### Implementation steps

1. Sanitise the HTML through `sanitize-html` with a permissive but safe config:
   ```typescript
   const sanitiseConfig = {
     allowedTags: sanitizeHtml.defaults.allowedTags.concat([
       'html', 'head', 'body', 'style', 'script',
       'canvas', 'svg', 'path', 'circle', 'rect',
       'section', 'article', 'header', 'footer', 'main', 'nav'
     ]),
     allowedAttributes: { '*': ['class', 'id', 'style', 'data-*'] },
     allowedSchemes: ['http', 'https'],
     // strip event handlers: onclick, onload, etc.
     disallowedTagsMode: 'discard',
   };
   ```
2. Call `artifactService.create()` with `type: 'html'`, `contentText: sanitisedHtml`
3. `artifact.service.ts` already calls `generatePreview()` on create — no extra wiring needed
4. Return `{ artifactId, title, previewAvailable: true }`

---

## 5. New Tool: chart_generate

**File:** `src/tools/chartGenerate.tool.ts`

### Purpose
Generate a chart from tabular data. Strategy: generate matplotlib Python code, execute via Judge0, capture the PNG output file, create an `image` artifact.

### Parameters
```typescript
export interface ChartGenerateParams {
  reason: string;
  chart_type: 'bar' | 'line' | 'pie' | 'scatter' | 'histogram';
  data: {
    labels: string[];
    datasets: { label: string; values: number[] }[];
  };
  title?: string;
  x_label?: string;
  y_label?: string;
}
```

### Implementation steps

1. Build matplotlib Python code programmatically from `params.data`:
   ```python
   import matplotlib
   matplotlib.use('Agg')
   import matplotlib.pyplot as plt
   import json, base64, sys

   # ...data injected here...
   plt.savefig('/tmp/chart.png', dpi=150, bbox_inches='tight')
   with open('/tmp/chart.png', 'rb') as f:
       print(base64.b64encode(f.read()).decode())
   ```
2. Call `codeExecution({ language: 'python', code: generatedCode })` — reuse existing Judge0 integration
3. Parse base64 from stdout
4. Convert to `Buffer`
5. Call `artifactService.create()` with `type: 'image'`, store via `artifact.storage.ts`
6. Return `{ artifactId, title }`

### Note on Judge0 output file handling
Judge0 `wait=true` mode returns `stdout`. The Python script writes to stdout as base64. This avoids needing Judge0 file retrieval endpoints.

---

## 6. New Tool: image_analyse

**File:** `src/tools/imageAnalyse.tool.ts`

### Purpose
Describe or extract data from an uploaded image. Calls the vision-capable provider (Anthropic claude-sonnet or GPT-4o).

### Parameters
```typescript
export interface ImageAnalyseParams {
  reason: string;
  file_id: string;           // uploaded file ID
  question?: string;         // specific question about the image
}
```

### Implementation steps

1. Load file from `files` table by `file_id` + `userId` (auth check)
2. Read binary from `artifact.storage` (or local uploads path)
3. Convert to base64
4. Call the vision provider directly (not the full agent loop):
   ```typescript
   // Use Anthropic if available, else OpenAI (both support vision)
   const provider = getProvider('anthropic') ?? getProvider('openai');
   const messages = [{
     role: 'user',
     content: [
       { type: 'image', source: { type: 'base64', media_type, data: base64Data } },
       { type: 'text', text: params.question ?? 'Describe this image in detail.' }
     ]
   }];
   ```
5. Collect full response (non-streaming, small call)
6. Return `{ description, tokensUsed }`

### Cost tracking
Vision calls have a surcharge. `costCredits` in `ToolResult` should reflect: `inputTokens × visionSurcharge`. The `visionSurcharge` factor is `1.5` (configurable, stored in `ai_models` row for image input).

---

## 7. New Tool: stock_data (Yahoo Finance)

**File:** `src/tools/stockData.tool.ts`

### Purpose
Fetch real-time and historical stock market data using Yahoo Finance. No API key required for basic usage via `yahoo-finance2` package.

### Parameters
```typescript
export interface StockDataParams {
  reason: string;
  symbol: string;             // e.g. 'AAPL', 'TSLA', 'BTC-USD'
  type: 'quote' | 'history' | 'profile';
  period?: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';
}
```

### Implementation

```typescript
import yahooFinance from 'yahoo-finance2';

export async function stockData(
  params: StockDataParams,
  _ctx: ToolContext
): Promise<ToolResult<StockDataResult>> {
  try {
    if (params.type === 'quote') {
      const quote = await yahooFinance.quote(params.symbol);
      return ok({
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        open: quote.regularMarketOpen,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        currency: quote.currency,
        timestamp: new Date().toISOString(),
      });
    }
    if (params.type === 'history') {
      const period = params.period ?? '1mo';
      const result = await yahooFinance.historical(params.symbol, {
        period1: periodToDate(period),
        period2: new Date(),
        interval: period === '1d' ? '1h' : '1d',
      });
      return ok({ symbol: params.symbol, history: result.slice(-30) });
    }
    if (params.type === 'profile') {
      const summary = await yahooFinance.quoteSummary(params.symbol, {
        modules: ['summaryProfile', 'financialData']
      });
      return ok({ symbol: params.symbol, profile: summary });
    }
  } catch (err: any) {
    return fail(`Yahoo Finance error: ${err.message}`);
  }
}
```

### Plan access
- `stockData` is available on **Starter+** plans (set in feature flags)
- No external API cost (Yahoo Finance is free via `yahoo-finance2`)

### Package
```
npm install yahoo-finance2
```

---

## 8. New Tool: get_weather

**File:** `src/tools/weather.tool.ts`

### Purpose
Get current weather and 5-day forecast for a location. Uses OpenWeatherMap API (free tier: 1M calls/month).

### Environment variable required
```
OPENWEATHERMAP_API_KEY=<key>
```

### Parameters
```typescript
export interface WeatherParams {
  reason: string;
  location: string;       // city name, e.g. "London" or "Mumbai, IN"
  units?: 'metric' | 'imperial';   // default 'metric'
}
```

### Implementation

```typescript
const BASE = 'https://api.openweathermap.org/data/2.5';

export async function getWeather(
  params: WeatherParams,
  _ctx: ToolContext
): Promise<ToolResult<WeatherResult>> {
  const apiKey = env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) return fail('Weather API not configured');

  const units = params.units ?? 'metric';
  const encoded = encodeURIComponent(params.location);

  // Current weather
  const currentRes = await fetch(
    `${BASE}/weather?q=${encoded}&units=${units}&appid=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!currentRes.ok) {
    const body = await currentRes.json().catch(() => ({}));
    return fail(`Weather API error: ${body.message ?? currentRes.status}`);
  }
  const current = await currentRes.json();

  // 5-day forecast (every 3h)
  const forecastRes = await fetch(
    `${BASE}/forecast?q=${encoded}&units=${units}&cnt=8&appid=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const forecast = forecastRes.ok ? await forecastRes.json() : null;

  return ok({
    location: `${current.name}, ${current.sys?.country}`,
    current: {
      condition: current.weather?.[0]?.description,
      temp: current.main?.temp,
      feelsLike: current.main?.feels_like,
      humidity: current.main?.humidity,
      windSpeed: current.wind?.speed,
    },
    forecast: forecast?.list?.map((f: any) => ({
      time: f.dt_txt,
      condition: f.weather?.[0]?.description,
      temp: f.main?.temp,
    })) ?? [],
    units,
  });
}
```

### Plan access
- `getWeather` is available on **Free+** plans (low cost, high value)

---

## 9. Fix file_gen (PDF + TXT)

**File:** `src/tools/fileGen.tool.ts`

### 9.1 PDF — add real generation via `pdfkit`
```typescript
import PDFDocument from 'pdfkit';
import { Writable } from 'stream';

async function generatePdf(content: string, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).text(title, { align: 'center' }).moveDown();
    doc.fontSize(11).text(content, { align: 'left' });
    doc.end();
  });
}
```
- Store via `artifactService.create()` with `type: 'text'` and `storagePath` (binary stored)
- Return download URL

```
npm install pdfkit
npm install --save-dev @types/pdfkit
```

### 9.2 TXT — add explicit case
```typescript
case 'txt': {
  const buffer = Buffer.from(params.content, 'utf-8');
  // store via artifact service
  break;
}
```

### 9.3 Update switch statement
```typescript
type FileFormat = 'excel' | 'xlsx' | 'docx' | 'word' | 'markdown' | 'md' | 'pdf' | 'txt' | 'csv';
```

---

## 10. Tool Registry

**File:** `src/tools/registry.ts`

### Purpose
Replace the hardcoded switch in `tools/index.ts` with a typed registry that:
1. Declares every tool's name, description, JSON schema, plan requirement, parallelSafe flag
2. Allows agents to declare `allowedTools: ToolName[]` and have the loop enforce it
3. Makes tool definitions available to the prompt assembler for injecting into LLM context

### Tool registration
```typescript
export interface ToolDefinition {
  name: ToolName;
  description: string;
  parametersSchema: Record<string, unknown>;  // JSON Schema
  planRequired: 'free' | 'starter' | 'pro' | 'enterprise';
  featureFlag?: string;
  parallelSafe: boolean;                       // can run concurrently with others
  estimatedLatencyMs: number;
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult<unknown>>;
}

const TOOL_REGISTRY = new Map<ToolName, ToolDefinition>();

export function registerTool(def: ToolDefinition): void {
  TOOL_REGISTRY.set(def.name, def);
}

export function getTool(name: ToolName): ToolDefinition | undefined {
  return TOOL_REGISTRY.get(name);
}

export function getToolsForAgent(allowedTools: ToolName[]): ToolDefinition[] {
  return allowedTools.map(n => TOOL_REGISTRY.get(n)).filter(Boolean) as ToolDefinition[];
}
```

### Tool names enum
```typescript
export type ToolName =
  | 'web_search'
  | 'web_fetch'
  | 'file_read'
  | 'file_gen'
  | 'html_generate'
  | 'chart_generate'
  | 'code_execution'
  | 'image_analyse'
  | 'stock_data'
  | 'get_weather';
```

### Each tool file calls `registerTool()` at module load:
```typescript
// webSearch.tool.ts
registerTool({
  name: 'web_search',
  description: 'Search the web for information. Use priority="high" for research-grade tasks.',
  parallelSafe: true,
  estimatedLatencyMs: 2000,
  planRequired: 'starter',
  featureFlag: 'webSearch',
  parametersSchema: { /* JSON schema */ },
  execute: webSearch,
});
```

### Updated `tools/index.ts`
```typescript
import './webSearch.tool';
import './webFetch.tool';
import './fileRead.tool';
import './fileGen.tool';
import './htmlGenerate.tool';
import './chartGenerate.tool';
import './codeExecution.tool';
import './imageAnalyse.tool';
import './stockData.tool';
import './weather.tool';

export { executeTool } from './executor';
export { getToolsForAgent, getTool, ToolName } from './registry';
```

### Updated `tools/executor.ts` (renamed from index logic)
```typescript
export async function executeTool(
  name: ToolName,
  params: unknown,
  ctx: ToolContext,
  agentAllowedTools: ToolName[]
): Promise<ToolResult<unknown>> {
  // Enforce agent tool whitelist
  if (!agentAllowedTools.includes(name)) {
    return { ok: false, data: null, error: `Tool '${name}' is not allowed for this agent`, costCredits: 0, durationMs: 0 };
  }
  const def = getTool(name);
  if (!def) {
    return { ok: false, data: null, error: `Unknown tool: ${name}`, costCredits: 0, durationMs: 0 };
  }
  const start = Date.now();
  const result = await def.execute(params, ctx);
  return { ...result, durationMs: Date.now() - start };
}
```

---

## 11. Parallel Tool Execution

**File:** `src/workers/chat.worker.ts` — update tool execution block

### Current behaviour
Sequential: one tool call → inject result → call LLM again → next tool call.

### New behaviour
When the LLM emits multiple `tool_call` events in the same streaming round AND all called tools are `parallelSafe`, run them concurrently:

```typescript
// In the tool execution block inside the agent loop
const pendingCalls = collectedToolCalls; // array of { name, params, callId }

// Partition into parallel-safe and sequential
const parallelCalls = pendingCalls.filter(c => getTool(c.name)?.parallelSafe);
const sequentialCalls = pendingCalls.filter(c => !getTool(c.name)?.parallelSafe);

// Run parallel batch
const parallelResults = await Promise.all(
  parallelCalls.map(c => executeTool(c.name, c.params, toolCtx, agentDescriptor.allowedTools)
    .then(result => ({ callId: c.callId, result }))
  )
);

// Run sequential one-by-one
const sequentialResults: { callId: string; result: ToolResult<unknown> }[] = [];
for (const c of sequentialCalls) {
  const result = await executeTool(c.name, c.params, toolCtx, agentDescriptor.allowedTools);
  sequentialResults.push({ callId: c.callId, result });
}

// Inject all results back as a batched tool_result message
const allResults = [...parallelResults, ...sequentialResults];
```

### Max parallel tools: 3 (configurable via env `MAX_PARALLEL_TOOLS=3`)
```typescript
const MAX_PARALLEL = parseInt(process.env.MAX_PARALLEL_TOOLS ?? '3', 10);
const parallelBatches = chunk(parallelCalls, MAX_PARALLEL);
```

---

## 12. Agent Descriptor Updates

**Files:** `src/agents/*.agent.ts`

| Agent | Add tools | Notes |
|---|---|---|
| `research.agent.ts` | `web_fetch` | Already has `web_search`; add `web_fetch` to allowedTools |
| `deep_research.agent.ts` | `web_search`, `web_fetch`, `file_read` | New file (see Task 7) |
| `analyst.agent.ts` | `chart_generate`, `stock_data` | Currently has `code_execution`, `file_read`, `file_gen` |
| `architect.agent.ts` | `web_search` | Add web_search to allowedTools per spec |
| `ui.agent.ts` | `html_generate` | Replace `file_gen` with `html_generate` |
| `chat.agent.ts` | `get_weather`, `stock_data` | Light enrichment tools for general chat |
| `writer.agent.ts` | `get_weather` | For weather-aware content |

```typescript
// Example: research.agent.ts update
export const researchAgent: AgentDescriptor = {
  slug: 'research',
  allowedTools: ['web_search', 'web_fetch', 'file_gen'],
  // ... rest unchanged
};
```

---

## 13. Feature Flags & Plan Updates

Add new flags to `FeatureFlags` interface and plan defaults:

```typescript
// In src/config/features.ts or equivalent
interface FeatureFlags {
  // ...existing...
  stockData: boolean;       // Yahoo Finance tool access
  weatherData: boolean;     // OpenWeatherMap tool access
}
```

| Flag | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| `stockData` | ✗ | ✓ | ✓ | ✓ |
| `weatherData` | ✓ | ✓ | ✓ | ✓ |
| `webFetch` | ✗ | ✓ | ✓ | ✓ |
| `htmlPreview` | ✗ | ✓ | ✓ | ✓ |
| `chartGenerate` | ✗ | ✗ | ✓ | ✓ |
| `imageAnalyse` | ✗ | ✓ | ✓ | ✓ |

**DB migration** `src/db/migrations/036_feature_flags_new_tools.sql`:
```sql
UPDATE plans SET feature_flags = feature_flags || '{"stockData": true, "weatherData": true}'
WHERE slug IN ('starter', 'pro', 'enterprise');

UPDATE plans SET feature_flags = feature_flags || '{"weatherData": true}'
WHERE slug = 'free';
```

### ENV additions to `.env.example`
```
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=
OPENWEATHERMAP_API_KEY=
JUDGE0_URL=http://judge0:2358
```

---

## 14. Packages Required

```bash
npm install @mozilla/readability jsdom yahoo-finance2 pdfkit
npm install --save-dev @types/jsdom @types/pdfkit
```

`sanitize-html` already installed (used in preview.ts).

---

## 15. Files Changed / Created

| File | Action |
|---|---|
| `src/tools/webSearch.tool.ts` | **Modify** — flip priority logic (Brave primary, Tavily high-priority) |
| `src/tools/webFetch.tool.ts` | **Create** |
| `src/tools/htmlGenerate.tool.ts` | **Create** |
| `src/tools/chartGenerate.tool.ts` | **Create** |
| `src/tools/imageAnalyse.tool.ts` | **Create** |
| `src/tools/stockData.tool.ts` | **Create** |
| `src/tools/weather.tool.ts` | **Create** |
| `src/tools/fileGen.tool.ts` | **Modify** — add PDF (pdfkit) + TXT |
| `src/tools/registry.ts` | **Create** |
| `src/tools/executor.ts` | **Create** (split from index.ts) |
| `src/tools/index.ts` | **Modify** — import all tools, re-export registry + executor |
| `src/workers/chat.worker.ts` | **Modify** — add parallel tool execution, pass agentAllowedTools to executeTool |
| `src/agents/research.agent.ts` | **Modify** — add web_fetch |
| `src/agents/analyst.agent.ts` | **Modify** — add chart_generate, stock_data |
| `src/agents/architect.agent.ts` | **Modify** — add web_search |
| `src/agents/ui.agent.ts` | **Modify** — add html_generate |
| `src/agents/chat.agent.ts` | **Modify** — add get_weather, stock_data |
| `src/agents/writer.agent.ts` | **Modify** — add get_weather |
| `src/db/migrations/036_feature_flags_new_tools.sql` | **Create** |
| `.env.example` | **Modify** — add OPENWEATHERMAP_API_KEY |
