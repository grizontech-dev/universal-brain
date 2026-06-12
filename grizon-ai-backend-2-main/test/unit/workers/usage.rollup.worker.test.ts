import { describe, expect, it, vi } from "vitest";

const query = vi.fn(async () => ({ rows: [] }));

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({ query }),
}));

describe("usage.rollup.worker", () => {
  it("executes rollup queries", async () => {
    const { runUsageRollupOnce } = await import("../../../src/workers/usage.rollup.worker.js");
    await runUsageRollupOnce();
    expect(query).toHaveBeenCalledTimes(3);
  });
});
