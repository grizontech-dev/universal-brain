import type {
  PostProcessCitation,
  PostProcessContext,
  PreflightResult,
} from "../types/router.js";

/** Pull citation rows from a web_search tool_result payload (deduped by URL). */
export function accumulateWebSearchCitations(
  output: unknown,
  citations: PostProcessCitation[],
  seenUrls: Set<string>,
): void {
  if (!output || typeof output !== "object") return;
  if ("error" in output) return;
  const results = (output as { results?: unknown }).results;
  if (!Array.isArray(results)) return;
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const r = item as { url?: string; title?: string; snippet?: string };
    const url = r.url;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    citations.push({
      index: citations.length + 1,
      title: r.title,
      url,
      snippet: r.snippet,
    });
  }
}

/** Accumulated from web_search tool results in the chat worker (1-based index). */
export type ResearchCitation = PostProcessCitation;

export function researchPreflight(query: string): PreflightResult {
  if (query.trim().length < 10) {
    return { ok: false, reason: "Search query too short. Please provide more detail." };
  }
  return { ok: true };
}

/** Append markdown Sources section when missing; used by research / deep_research postProcess hooks. */
export function appendResearchSourcesMarkdown(content: string, citations: ResearchCitation[]): string {
  if (citations.length === 0) return content;
  if (content.includes("## Sources") || content.includes("**Sources**")) return content;
  const sourceList = [...citations]
    .sort((a, b) => a.index - b.index)
    .map((c) => `[${c.index}] [${c.title ?? "Source"}](${c.url ?? "#"})`)
    .join("\n");
  return `${content}\n\n---\n**Sources**\n${sourceList}`;
}

export function researchPostProcess(content: string, ctx: PostProcessContext): string {
  if (ctx.agentSlug !== "research" && ctx.agentSlug !== "deep_research") return content;
  return appendResearchSourcesMarkdown(content, ctx.citations);
}
