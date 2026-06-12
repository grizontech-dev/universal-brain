import { describe, expect, it } from "vitest";

import {
  accumulateWebSearchCitations,
  appendResearchSourcesMarkdown,
  researchPostProcess,
  researchPreflight,
} from "../../../src/agents/researchSources.js";
import { agentMultiplierFor } from "../../../src/config/credits.js";

describe("researchSources", () => {
  it("deep_research slug maps to 2.0 credit multiplier", () => {
    expect(agentMultiplierFor("deep_research")).toBe(2);
  });

  it("researchPreflight rejects very short queries", () => {
    expect(researchPreflight("short").ok).toBe(false);
    expect(researchPreflight("1234567890").ok).toBe(true);
  });

  it("appendResearchSourcesMarkdown skips when headings exist", () => {
    const body = "Hello\n\n## Sources\nalready";
    expect(appendResearchSourcesMarkdown(body, [{ index: 1, url: "https://a.com", title: "A" }])).toBe(body);
  });

  it("appendResearchSourcesMarkdown appends markdown sources", () => {
    const out = appendResearchSourcesMarkdown("Summary text.", [
      { index: 2, url: "https://b.com", title: "B" },
      { index: 1, url: "https://a.com", title: "A" },
    ]);
    expect(out).toContain("**Sources**");
    expect(out).toContain("[1] [A](https://a.com)");
    expect(out).toContain("[2] [B](https://b.com)");
  });

  it("researchPostProcess only affects research agents", () => {
    const citations = [{ index: 1, url: "https://x.com", title: "X" }];
    expect(researchPostProcess("Hi", { agentSlug: "chat", citations, toolCallCount: 0 })).toBe("Hi");
    expect(researchPostProcess("Hi", { agentSlug: "research", citations, toolCallCount: 1 })).toContain(
      "**Sources**",
    );
  });

  it("accumulateWebSearchCitations dedupes URLs", () => {
    const citations: { index: number; title?: string; url?: string; snippet?: string }[] = [];
    const seen = new Set<string>();
    accumulateWebSearchCitations(
      {
        results: [
          { url: "https://a.com", title: "A", snippet: "" },
          { url: "https://a.com", title: "Dup", snippet: "" },
          { url: "https://b.com", title: "B", snippet: "x" },
        ],
      },
      citations,
      seen,
    );
    expect(citations).toHaveLength(2);
    expect(citations[0].index).toBe(1);
    expect(citations[1].index).toBe(2);
  });

  it("accumulateWebSearchCitations ignores error payloads", () => {
    const citations: { index: number; url?: string }[] = [];
    accumulateWebSearchCitations({ error: "tool_not_allowed:foo" }, citations, new Set());
    expect(citations).toHaveLength(0);
  });
});
