import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({
    query: queryMock,
    connect: async () => ({ query: queryMock, release: releaseMock }),
  }),
}));

describe("artifactService", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
  });

  it("throws ARTIFACT_VERSION_LIMIT when max versions reached", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: "a1" }], rowCount: 1 }) // parent exists
      .mockResolvedValueOnce({ rows: [{ c: 3 }], rowCount: 1 }) // chain count
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK
    const { artifactService } = await import("../../../src/services/artifact.service.js");
    await expect(
      artifactService.create({
        userId: "u1",
        conversationId: "c1",
        title: "t",
        type: "code",
        createdByAgent: "x",
        parentId: "a1",
        maxVersions: 3,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_VERSION_LIMIT" });
  });
});
