import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({ query }),
}));

describe("usageTracker.service", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("inserts usage record without throwing", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { usageTracker } = await import("../../../src/services/usageTracker.service.js");
    await expect(
      usageTracker.record({
        userId: "2d994d43-a453-4f50-9f9a-f00b63ee4a56",
        modelId: "gpt-4o-mini",
        agentSlug: "chat",
        modelProvider: "openai",
        platform: "web",
        status: "success",
        latencyMs: 100,
        inputTokens: 10,
        outputTokens: 20,
        creditsDeducted: 3,
        ip: "127.0.0.1",
      }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
