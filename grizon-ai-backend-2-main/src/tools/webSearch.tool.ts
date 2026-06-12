import { env } from "../config/env.js";
import { spawnSubagent } from "../runtime/subagent.js";
import { logger } from "../utils/logger.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

export type WebSearchPriority = "standard" | "high";
export type WebSearchDateRange = "h" | "d" | "w" | "m";

export type WebSearchArgs = {
  reason?: string;
  query: string;
  priority?: WebSearchPriority;
  max_results?: number;
  summarise?: boolean;
  country?: string;
  date_range?: WebSearchDateRange;
};

export type WebSearchResult = {
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    source: "brave" | "tavily" | "serper";
  }>;
  engine: "tavily" | "brave" | "serper" | "none";
  summaries?: string[];
  subagentCost?: number;
  /** Set when engine === "none" — instructs the LLM how to handle the failure. */
  message?: string;
  knowledgeGraph?: {
    title: string;
    description?: string;
    attributes?: Record<string, string>;
  };
  peopleAlsoAsk?: Array<{ question: string; snippet: string; link: string }>;
  relatedSearches?: string[];
};

function inferPriority(args: WebSearchArgs, ctx?: StreamContext): WebSearchPriority {
  if (args.priority === "standard") return "standard";
  const slug = ctx?.agentSlug;
  const isResearchAgent = slug === "research" || slug === "deep_research";
  const isComplex = ctx?.queryComplexity === "complex";
  if (isResearchAgent && isComplex) return "high";
  if (args.priority === "high" && (isResearchAgent || isComplex)) return "high";
  return "standard";
}

async function searchSerper(
  query: string,
  count: number,
  opts: { country?: string; dateRange?: WebSearchDateRange },
): Promise<WebSearchResult | null> {
  if (!env.SERPER_API_KEY?.trim()) {
    logger.debug({ query }, "web_search:serper_skipped — SERPER_API_KEY not set");
    return null;
  }
  const gl = (opts.country ?? "in").toLowerCase();
  const body: Record<string, unknown> = { q: query, num: count, gl };
  if (opts.dateRange) body.tbs = `qdr:${opts.dateRange}`;
  logger.debug({ query, count, gl, tbs: body.tbs }, "web_search:serper_attempt");
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      logger.warn({ query, status: res.status, body: t }, "web_search:serper_http_error");
      return null;
    }
    const data = (await res.json()) as {
      organic?: Array<{ title: string; link: string; snippet?: string }>;
      knowledgeGraph?: {
        title?: string;
        description?: string;
        attributes?: Record<string, string>;
      };
      peopleAlsoAsk?: Array<{ question: string; snippet: string; link: string }>;
      relatedSearches?: Array<{ query: string }>;
      credits?: number;
    };
    const results = (data.organic ?? []).map((r) => ({
      url: r.link,
      title: r.title,
      snippet: (r.snippet ?? "").slice(0, 400),
      source: "serper" as const,
    }));
    const out: WebSearchResult = { results, engine: "serper" };
    if (data.knowledgeGraph?.title) {
      out.knowledgeGraph = {
        title: data.knowledgeGraph.title,
        description: data.knowledgeGraph.description,
        attributes: data.knowledgeGraph.attributes,
      };
    }
    if (data.peopleAlsoAsk?.length) {
      out.peopleAlsoAsk = data.peopleAlsoAsk.slice(0, 4).map((p) => ({
        question: p.question,
        snippet: p.snippet,
        link: p.link,
      }));
    }
    if (data.relatedSearches?.length) {
      out.relatedSearches = data.relatedSearches
        .slice(0, 6)
        .map((r) => r.query)
        .filter(Boolean);
    }
    logger.debug(
      { query, resultCount: results.length, credits: data.credits, gl, tbs: body.tbs },
      "web_search:serper_ok",
    );
    return out;
  } catch (err) {
    logger.warn({ query, err }, "web_search:serper_exception");
    return null;
  }
}

async function searchBrave(query: string, count: number): Promise<WebSearchResult | null> {
  if (!env.BRAVE_API_KEY?.trim()) {
    logger.debug({ query }, "web_search:brave_skipped — BRAVE_API_KEY not set");
    return null;
  }
  logger.debug({ query, count }, "web_search:brave_attempt");
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": env.BRAVE_API_KEY,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ query, status: res.status, body }, "web_search:brave_http_error");
      return null;
    }
    const data = (await res.json()) as {
      web?: { results?: Array<{ url: string; title: string; description: string }> };
    };
    const results = (data.web?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.description ?? "",
      source: "brave" as const,
    }));
    logger.debug({ query, resultCount: results.length }, "web_search:brave_ok");
    return { results, engine: "brave" };
  } catch (err) {
    logger.warn({ query, err }, "web_search:brave_exception");
    return null;
  }
}

async function searchTavily(query: string, count: number): Promise<WebSearchResult | null> {
  if (!env.TAVILY_API_KEY?.trim()) {
    logger.debug({ query }, "web_search:tavily_skipped — TAVILY_API_KEY not set");
    return null;
  }
  logger.debug({ query, count }, "web_search:tavily_attempt");
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: count,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ query, status: res.status, body }, "web_search:tavily_http_error");
      return null;
    }
    const data = (await res.json()) as {
      results?: Array<{ url: string; title: string; content: string }>;
    };
    const results = (data.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content?.slice(0, 400) ?? "",
      source: "tavily" as const,
    }));
    logger.debug({ query, resultCount: results.length }, "web_search:tavily_ok");
    return { results, engine: "tavily" };
  } catch (err) {
    logger.warn({ query, err }, "web_search:tavily_exception");
    return null;
  }
}

async function withSummaries(
  result: WebSearchResult,
  ctx: StreamContext | undefined,
  summarise: boolean,
): Promise<WebSearchResult> {
  if (!summarise) return result;
  const parentJobId = ctx?.jobId ?? ctx?.messageId;
  if (!ctx || result.results.length <= 1 || !parentJobId) return result;
  let subagentCost = 0;
  const summaries: string[] = [];
  for (const item of result.results.slice(0, 3)) {
    try {
      const out = await spawnSubagent({
        task: "summarise_pages",
        inputs: `${item.title}\n${item.snippet}\n${item.url}`,
        parentJobId,
        modelTier: "nano",
        maxOutputTokens: 300,
        messageId: ctx.messageId ?? null,
        userId: ctx.userId ?? null,
        conversationId: ctx.conversationId ?? null,
        agentSlug: ctx.agentSlug ?? null,
      });
      summaries.push(out.summary);
      subagentCost += out.creditsUsed;
    } catch {
      summaries.push("[summarisation failed]");
    }
  }
  return { ...result, summaries, subagentCost: Number(subagentCost.toFixed(4)) };
}

const NO_RESULTS_MESSAGE =
  "The web search returned no results. Do not tell the user you lack search capability — the tool ran but found nothing. Acknowledge that you could not find current information on this topic and offer to help with what you know, or suggest the user try a different source.";

export async function webSearch(args: WebSearchArgs, ctx?: StreamContext): Promise<WebSearchResult> {
  const maxResults = Math.min(Math.max(Number(args.max_results ?? 5) || 5, 1), 20);
  const summarise = args.summarise !== false;
  const priority = inferPriority(args, ctx);

  logger.debug(
    {
      query: args.query,
      priority,
      maxResults,
      summarise,
      country: args.country,
      dateRange: args.date_range,
      agentSlug: ctx?.agentSlug,
      hasSerper: Boolean(env.SERPER_API_KEY?.trim()),
      hasBrave: Boolean(env.BRAVE_API_KEY?.trim()),
      hasTavily: Boolean(env.TAVILY_API_KEY?.trim()),
    },
    "web_search:start",
  );

  type Step = { name: "serper" | "brave" | "tavily"; fn: () => Promise<WebSearchResult | null> };
  const chain: Step[] =
    priority === "high"
      ? [
          { name: "brave", fn: () => searchBrave(args.query, maxResults) },
          { name: "tavily", fn: () => searchTavily(args.query, maxResults) },
        ]
      : [
          {
            name: "serper",
            fn: () =>
              searchSerper(args.query, maxResults, {
                country: args.country,
                dateRange: args.date_range,
              }),
          },
          { name: "brave", fn: () => searchBrave(args.query, maxResults) },
          { name: "tavily", fn: () => searchTavily(args.query, maxResults) },
        ];

  for (const step of chain) {
    const r = await step.fn();
    if (r && r.results.length > 0) {
      logger.debug(
        { query: args.query, engine: r.engine, resultCount: r.results.length },
        "web_search:done",
      );
      return withSummaries(r, ctx, summarise);
    }
  }

  logger.warn(
    {
      query: args.query,
      priority,
      hasSerper: Boolean(env.SERPER_API_KEY?.trim()),
      hasBrave: Boolean(env.BRAVE_API_KEY?.trim()),
      hasTavily: Boolean(env.TAVILY_API_KEY?.trim()),
    },
    "web_search:no_results — all engines empty or no keys configured",
  );
  return withSummaries({ results: [], engine: "none", message: NO_RESULTS_MESSAGE }, ctx, summarise);
}

registerTool({
  name: "web_search",
  description:
    "Search the web to discover relevant URLs and current information. " +
    "Use this FIRST when you need to find up-to-date information or don't have a specific URL.",
  parallelSafe: true,
  estimatedLatencyMs: 2000,
  planRequired: "starter",
  featureFlag: "webSearch",
  parametersSchema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why this search is needed" },
      query: { type: "string", description: "Search query" },
      priority: { type: "string", enum: ["standard", "high"] },
      max_results: { type: "number", description: "Max results (default 5)" },
      summarise: { type: "boolean", description: "Summarise top pages via subagent (default true)" },
      country: {
        type: "string",
        description: "ISO 3166-1 alpha-2 country code (lowercase, e.g. 'in', 'us'). Default 'in'.",
      },
      date_range: {
        type: "string",
        enum: ["h", "d", "w", "m"],
        description: "Recency filter: h=past hour, d=past day, w=past week, m=past month. Omit for any time.",
      },
    },
    required: ["query"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const dr =
      p.date_range === "h" || p.date_range === "d" || p.date_range === "w" || p.date_range === "m"
        ? (p.date_range as WebSearchDateRange)
        : undefined;
    return webSearch(
      {
        reason: p.reason !== undefined ? String(p.reason) : undefined,
        query: String(p.query ?? ""),
        priority: p.priority === "high" || p.priority === "standard" ? p.priority : undefined,
        max_results: typeof p.max_results === "number" ? p.max_results : undefined,
        summarise: typeof p.summarise === "boolean" ? p.summarise : undefined,
        country: typeof p.country === "string" ? p.country : undefined,
        date_range: dr,
      },
      ctx,
    );
  },
});
