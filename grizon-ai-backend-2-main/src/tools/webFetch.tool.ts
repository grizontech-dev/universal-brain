import { URL } from "url";

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

const MAX_CHARS = 32000;
const MAX_FETCH_URLS_PER_CALL = 5;

export type FetchSuccess = { url: string; title: string; text: string; wordCount: number };
export type FetchFailure = { url: string; error: string };
export type FetchOne = FetchSuccess | FetchFailure;

function isUrlSafe(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  const blocked = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^::1$/,
    /^0\.0\.0\.0$/,
    /\.internal$/i,
    /\.local$/i,
  ];
  return !blocked.some((r) => r.test(host));
}

function allowedContentType(ct: string | null): boolean {
  if (!ct) return false;
  const lower = ct.split(";")[0].trim().toLowerCase();
  return (
    lower === "text/html" ||
    lower === "text/plain" ||
    lower === "application/json" ||
    lower.startsWith("text/html") ||
    lower.startsWith("text/plain") ||
    lower.startsWith("application/json")
  );
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function fetchOne(rawUrl: string, extract: "article" | "full"): Promise<FetchOne> {
  if (!isUrlSafe(rawUrl)) {
    return { url: rawUrl, error: "url_not_allowed" };
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "GrizonAI-WebFetch/1.0" },
      redirect: "follow",
    });
    clearTimeout(t);
    const ct = res.headers.get("content-type");
    if (!allowedContentType(ct)) {
      return { url: rawUrl, error: `unsupported_content_type:${ct ?? "unknown"}` };
    }
    const raw = await res.text();
    let title = "";
    let text = "";

    if (ct?.toLowerCase().includes("application/json")) {
      title = rawUrl;
      text = raw;
    } else if (ct?.toLowerCase().includes("text/plain")) {
      title = rawUrl;
      text = raw;
    } else {
      const dom = new JSDOM(raw, { url: rawUrl });
      if (extract === "article") {
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        title = article?.title ?? dom.window.document.title ?? "";
        text = article?.textContent ?? "";
      }
      if (!text.trim()) {
        text = dom.window.document.body?.textContent ?? "";
        title = dom.window.document.title ?? "";
      }
    }

    text = text.replace(/\s+/g, " ").trim();
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
    }
    return {
      url: rawUrl,
      title: title || rawUrl,
      text,
      wordCount: wordCount(text),
    };
  } catch (err) {
    clearTimeout(t);
    return { url: rawUrl, error: String(err) };
  }
}

export async function webFetchMany(
  urls: string[],
  extract: "article" | "full",
): Promise<FetchOne[]> {
  const concurrency = Math.max(1, Math.min(env.WEB_FETCH_CONCURRENCY, MAX_FETCH_URLS_PER_CALL));
  const out: FetchOne[] = new Array(urls.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= urls.length) return;
      out[i] = await fetchOne(urls[i], extract);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return out;
}

export type WebFetchParams = {
  reason?: string;
  url?: string;
  urls?: string[];
  extract?: "article" | "full";
};

export type WebFetchReturn =
  | FetchSuccess
  | { error: string }
  | { error: string; max?: number; received?: number }
  | { results: FetchOne[] };

export async function webFetch(
  params: WebFetchParams,
  _ctx: StreamContext,
): Promise<WebFetchReturn> {
  const extract = params.extract ?? "article";
  const hasSingle = typeof params.url === "string" && params.url.length > 0;
  const hasBatch = Array.isArray(params.urls);

  if (hasSingle && hasBatch) {
    return { error: "use_url_or_urls_not_both" };
  }
  if (!hasSingle && !hasBatch) {
    return { error: "url_required" };
  }

  if (hasBatch) {
    const urls = (params.urls ?? []).filter((u) => typeof u === "string" && u.length > 0);
    if (urls.length === 0) {
      return { error: "urls_empty" };
    }
    if (urls.length > MAX_FETCH_URLS_PER_CALL) {
      logger.warn(
        { received: urls.length, max: MAX_FETCH_URLS_PER_CALL },
        "web_fetch:too_many_urls",
      );
      return { error: "too_many_urls", max: MAX_FETCH_URLS_PER_CALL, received: urls.length };
    }
    const results = await webFetchMany(urls, extract);
    return { results };
  }

  // Single-URL path — preserve original return shape for backward compatibility.
  const single = await fetchOne(params.url as string, extract);
  if ("error" in single) {
    return { error: single.error };
  }
  return { url: single.url, title: single.title, text: single.text, wordCount: single.wordCount };
}

registerTool({
  name: "web_fetch",
  description:
    "Fetch and extract the full text of one or more URLs you already have. " +
    "Use after web_search to read pages in depth. " +
    "BATCH MODE: pass `urls` (array) to fetch up to 5 URLs in parallel in a single call — strongly preferred over multiple sequential calls. " +
    "Hard limit: 5 URLs per call. Do NOT guess URLs from memory — use web_search first to find them.",
  parallelSafe: true,
  estimatedLatencyMs: 4000,
  planRequired: "starter",
  featureFlag: "webFetch",
  parametersSchema: {
    type: "object",
    properties: {
      reason: { type: "string" },
      url: { type: "string", description: "Single URL to fetch (mutually exclusive with `urls`)" },
      urls: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_FETCH_URLS_PER_CALL,
        description: `Batch mode: fetch up to ${MAX_FETCH_URLS_PER_CALL} URLs in parallel — prefer this over multiple single calls. Hard limit: ${MAX_FETCH_URLS_PER_CALL} URLs per call.`,
      },
      extract: { type: "string", enum: ["article", "full"] },
    },
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const ex = p.extract === "full" || p.extract === "article" ? p.extract : undefined;
    const urls = Array.isArray(p.urls)
      ? (p.urls as unknown[]).map((u) => String(u)).filter(Boolean)
      : undefined;
    return webFetch(
      {
        reason: p.reason !== undefined ? String(p.reason) : undefined,
        url: typeof p.url === "string" && p.url.length > 0 ? p.url : undefined,
        urls,
        extract: ex,
      },
      ctx,
    );
  },
});
