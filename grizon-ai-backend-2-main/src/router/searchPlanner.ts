import { env } from "../config/env.js";
import { captureRouterCall } from "../services/routerCapture.service.js";
import { webSearch, type WebSearchResult } from "../tools/webSearch.tool.js";
import { logger } from "../utils/logger.js";
import type {
  ClassificationResult,
  StreamContext,
  ToolBudgets,
  ToolId,
} from "../types/router.js";

export type PlannedQuery = {
  q: string;
  country?: string;
  date_range?: "h" | "d" | "w" | "m";
};

export interface SearchPlan {
  queries: string[];
  urlsToFetch: string[];
  results: WebSearchResult[];
  plannerLatencyMs: number;
  plannerSource: "heuristic" | "llm" | "skipped";
}

const URL_RE = /https?:\/\/\S+/g;

function buildPlannerPrompt(today: Date): string {
  const year = today.getUTCFullYear();
  const isoDate = today.toISOString().slice(0, 10);
  return `You decompose a user's request into web search queries.

TODAY'S DATE: ${isoDate} (current year is ${year}). Your training data is older than this — DO NOT trust your built-in sense of "the current year". Use ${year} (and ${year + 1} for forward-looking terms like "upcoming") when the query benefits from a year. NEVER inject older years (e.g. ${year - 1}, ${year - 2}) unless the user is explicitly asking about the past.

Return ONLY valid JSON matching:
{
  "queries": [ { "q": string, "country"?: string, "date_range"?: "h"|"d"|"w"|"m" } ],
  "urlsToFetch": string[]
}

Rules:
- queries: 0..MAX (you will be told the cap). Empty array is valid — return it when the request does not actually need fresh web data.
- q: a focused search query (NOT the original user sentence). Strip pronouns, add specific entities.
- Prefer date_range over stuffing years into the query string. Only include a year in q when the user explicitly named one OR when the topic is intrinsically tied to a yearly cycle (e.g. "tax filing ${year}", "Oscars ${year}").
- country: ISO 3166-1 alpha-2 lowercase. Default "in". Override when the user explicitly references a region ("US news" -> "us", "in India" -> "in", "UK" -> "gb", etc.).
- date_range: "h"=past hour, "d"=past day, "w"=past week, "m"=past month. Pick by recency:
  * "today" / "latest" / "now" / "right now" -> "d"
  * "this week" / "recent" / "trending" -> "w"
  * news without explicit time qualifier -> "m"
  * evergreen / historical / definitional -> omit the field
- urlsToFetch: extract any explicit URLs the user pasted. Do NOT invent URLs.`;
}

function extractUrls(content: string): string[] {
  const matches = content.match(URL_RE) ?? [];
  // Strip trailing punctuation that commonly sticks to URLs.
  return matches.map((u) => u.replace(/[)>\].,;:!?"']+$/, "")).filter(Boolean);
}

function queryCap(budget: number | undefined): number {
  const b = typeof budget === "number" && budget > 0 ? budget : 0;
  if (b === 0) return 0;
  // Leave at least 1 slot for model follow-ups; deep_research (6) -> 4, general (2) -> 1.
  if (b >= 6) return 4;
  if (b >= 3) return Math.min(3, b - 1);
  return Math.max(1, b - 1);
}

async function planWithLlm(
  content: string,
  cap: number,
  signal: AbortSignal,
  ctx: Pick<StreamContext, "jobId" | "messageId" | "agentSlug" | "userId" | "conversationId">,
): Promise<{ queries: PlannedQuery[]; urlsToFetch: string[] } | null> {
  if (!env.OPENAI_API_KEY?.trim()) return null;
  const startedAt = Date.now();
  const systemPrompt = `${buildPlannerPrompt(new Date())}\n\nMAX queries: ${cap}`;
  const userPrompt = content.slice(0, 2000);
  try {
    const res = await fetch(
      `${env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal,
      },
    );
    if (!res.ok) {
      captureRouterCall({
        component: "search_planner", source: "llm", status: "error",
        userId: ctx.userId, conversationId: ctx.conversationId,
        jobId: ctx.jobId, messageId: ctx.messageId,
        promptSystem: systemPrompt, promptUser: userPrompt,
        latencyMs: Date.now() - startedAt,
        errorMessage: `HTTP ${res.status}`,
      });
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rawQueries = Array.isArray(parsed.queries) ? parsed.queries : [];
    const queries: PlannedQuery[] = [];
    for (const item of rawQueries.slice(0, cap)) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const q = typeof o.q === "string" ? o.q.trim() : "";
      if (!q) continue;
      const country =
        typeof o.country === "string" && /^[a-z]{2}$/i.test(o.country)
          ? o.country.toLowerCase()
          : undefined;
      const dr =
        o.date_range === "h" || o.date_range === "d" || o.date_range === "w" || o.date_range === "m"
          ? (o.date_range as "h" | "d" | "w" | "m")
          : undefined;
      queries.push({ q, country, date_range: dr });
    }
    const rawUrls = Array.isArray(parsed.urlsToFetch) ? parsed.urlsToFetch : [];
    const urlsToFetch = rawUrls
      .filter((u): u is string => typeof u === "string")
      .map((u) => u.trim())
      .filter(Boolean);

    captureRouterCall({
      component: "search_planner", source: "llm", status: "completed",
      userId: ctx.userId, conversationId: ctx.conversationId,
      jobId: ctx.jobId, messageId: ctx.messageId,
      promptSystem: systemPrompt, promptUser: userPrompt,
      responseText: text,
      responseJson: parsed,
      latencyMs: Date.now() - startedAt,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    });

    return { queries, urlsToFetch };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      captureRouterCall({
        component: "search_planner", source: "llm", status: "timeout",
        userId: ctx.userId, conversationId: ctx.conversationId,
        jobId: ctx.jobId, messageId: ctx.messageId,
        promptSystem: systemPrompt, promptUser: userPrompt,
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }
    logger.warn({ err }, "search_planner:llm_failed");
    captureRouterCall({
      component: "search_planner", source: "llm", status: "error",
      userId: ctx.userId, conversationId: ctx.conversationId,
      jobId: ctx.jobId, messageId: ctx.messageId,
      promptSystem: systemPrompt, promptUser: userPrompt,
      latencyMs: Date.now() - startedAt,
      errorMessage: (err as Error).message,
    });
    return null;
  }
}

export async function planSearches(
  content: string,
  classification: ClassificationResult,
  budgets: ToolBudgets,
  allowedTools: ToolId[],
  ctx: Pick<StreamContext, "jobId" | "messageId" | "agentSlug" | "userId" | "conversationId">,
): Promise<SearchPlan | null> {
  const startedAt = Date.now();

  if (!classification.needsWebSearch) return null;
  if (!allowedTools.includes("web_search")) return null;
  const cap = queryCap(budgets.web_search);
  if (cap < 1) return null;

  const explicitUrls = extractUrls(content);

  // Heuristic gate: if confidence is low AND no explicit URL, skip the LLM
  // planner entirely to avoid paying for false positives. Let the model decide.
  if (classification.confidence < 0.6 && explicitUrls.length === 0) {
    logger.debug(
      { confidence: classification.confidence },
      "search_planner:skipped_low_confidence",
    );
    return null;
  }

  // LLM planning with a tight 800ms budget.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2000);
  let plan: { queries: PlannedQuery[]; urlsToFetch: string[] } | null = null;
  try {
    plan = await planWithLlm(content, cap, controller.signal, ctx);
  } finally {
    clearTimeout(t);
  }

  let plannerSource: SearchPlan["plannerSource"] = "llm";
  if (!plan) {
    // Heuristic fallback: single query = truncated user content. Always include explicit URLs.
    plannerSource = "heuristic";
    plan = {
      queries: [{ q: content.slice(0, 200).trim() }],
      urlsToFetch: explicitUrls,
    };
  } else {
    // Merge explicit URLs the user pasted (planner may have missed some).
    const seen = new Set(plan.urlsToFetch);
    for (const u of explicitUrls) {
      if (!seen.has(u)) {
        plan.urlsToFetch.push(u);
        seen.add(u);
      }
    }
  }

  if (plan.queries.length === 0) {
    logger.debug({ plannerSource }, "search_planner:no_queries");
    return {
      queries: [],
      urlsToFetch: plan.urlsToFetch,
      results: [],
      plannerLatencyMs: Date.now() - startedAt,
      plannerSource,
    };
  }

  // Execute searches in parallel; no summarisation to keep latency bounded.
  const searchCtx: StreamContext = {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    jobId: ctx.jobId,
    messageId: ctx.messageId,
    attachedFileIds: [],
    maxArtifactVersions: 1,
    agentSlug: ctx.agentSlug,
  };

  const settled = await Promise.allSettled(
    plan.queries.map((q) =>
      webSearch(
        {
          query: q.q,
          country: q.country,
          date_range: q.date_range,
          summarise: false,
        },
        searchCtx,
      ),
    ),
  );
  const results: WebSearchResult[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") results.push(s.value);
  }

  const plannerLatencyMs = Date.now() - startedAt;
  logger.debug(
    {
      plannerSource,
      queryCount: plan.queries.length,
      urlCount: plan.urlsToFetch.length,
      resultCount: results.reduce((sum, r) => sum + r.results.length, 0),
      plannerLatencyMs,
    },
    "search_planner:done",
  );

  return {
    queries: plan.queries.map((q) => q.q),
    urlsToFetch: plan.urlsToFetch,
    results,
    plannerLatencyMs,
    plannerSource,
  };
}

export function renderSearchPlanForPrompt(plan: SearchPlan, maxChars = 6000): string {
  if (plan.results.length === 0 && plan.urlsToFetch.length === 0) return "";
  const lines: string[] = [];
  lines.push("Pre-fetched web search results (do not re-run these queries):");
  for (let i = 0; i < plan.results.length; i++) {
    const r = plan.results[i];
    const q = plan.queries[i] ?? "(unknown query)";
    lines.push("");
    lines.push(`### Query: "${q}"`);
    if (r.engine === "none") {
      lines.push("- (no results)");
      continue;
    }
    if (r.knowledgeGraph?.title) {
      const kg = r.knowledgeGraph;
      lines.push(`Knowledge: **${kg.title}** — ${kg.description ?? ""}`.trim());
    }
    for (const item of r.results.slice(0, 6)) {
      const snip = item.snippet.replace(/\s+/g, " ").slice(0, 220);
      lines.push(`- [${item.title}](${item.url}) — ${snip}`);
    }
    if (r.peopleAlsoAsk?.length) {
      lines.push(`People also ask: ${r.peopleAlsoAsk.map((p) => p.question).join(" | ")}`);
    }
    if (r.relatedSearches?.length) {
      lines.push(`Related: ${r.relatedSearches.join(", ")}`);
    }
  }
  if (plan.urlsToFetch.length > 0) {
    lines.push("");
    lines.push(`URLs the user referenced (consider fetching via web_fetch urls=[...]): ${plan.urlsToFetch.join(", ")}`);
  }
  const out = lines.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(truncated)` : out;
}
