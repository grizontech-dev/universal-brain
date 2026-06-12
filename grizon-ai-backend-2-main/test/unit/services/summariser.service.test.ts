import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({
    connect: async () => ({ query: queryMock, release: releaseMock }),
  }),
}));

describe("summariserService", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
  });

  it("no-ops when fewer than 8 unsummarised messages", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "c1", user_id: "u1" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "m1" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT
    const { summariserService } = await import("../../../src/services/summariser.service.js");
    const out = await summariserService.run("c1");
    expect(out.updated).toBe(false);
  });
});
