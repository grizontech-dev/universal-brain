import { describe, expect, it } from "vitest";

import { liveMetricsService } from "../../../src/services/liveMetrics.service.js";

describe("liveMetricsService", () => {
  it("getSnapshot returns stable shape when Redis is unavailable", async () => {
    const snap = await liveMetricsService.getSnapshot();
    expect(snap).toHaveProperty("date");
    expect(snap.cache).toMatchObject({
      semanticHitsToday: expect.any(Number),
      semanticHitsYesterday: expect.any(Number),
      promptCacheHitsToday: expect.any(Number),
    });
    expect(Array.isArray(snap.providers)).toBe(true);
    expect(Array.isArray(snap.agents)).toBe(true);
    expect(snap.agents.some((a) => a.slug === "chat")).toBe(true);
    expect(snap.agents.some((a) => a.slug === "deep_research")).toBe(true);
  });

  it("recordLlmSuccess does not throw for unknown provider string", async () => {
    await expect(liveMetricsService.recordLlmSuccess("semantic_cache", "chat", 0)).resolves.toBeUndefined();
  });
});
