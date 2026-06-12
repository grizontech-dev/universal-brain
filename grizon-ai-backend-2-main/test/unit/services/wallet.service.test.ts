import { beforeEach, describe, expect, it, vi } from "vitest";

const getPoolMock = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: getPoolMock,
}));

describe("wallet.service (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects zero delta adjustments before DB", async () => {
    const { walletService } = await import("../../../src/services/wallet.service.js");
    await expect(walletService.adjust("user-1", 0, "valid reason text", "admin-1")).rejects.toMatchObject({
      code: "ZERO_DELTA",
    });
    expect(getPoolMock).not.toHaveBeenCalled();
  });

  it("rejects short reason adjustments before DB", async () => {
    const { walletService } = await import("../../../src/services/wallet.service.js");
    await expect(walletService.adjust("user-1", 10, "short", "admin-1")).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
    expect(getPoolMock).not.toHaveBeenCalled();
  });
});
