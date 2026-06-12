import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQueryMock = vi.fn();
const createForUserMock = vi.fn();
const grantMock = vi.fn();
const adjustMock = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({
    query: poolQueryMock,
    connect: async () => ({ query: vi.fn(), release: vi.fn() }),
  }),
}));

vi.mock("../../../src/services/wallet.service.js", () => ({
  walletService: {
    createForUser: createForUserMock,
    grant: grantMock,
    adjust: adjustMock,
  },
}));

describe("subscriptionService.ensureGrantsForUser", () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    createForUserMock.mockReset().mockResolvedValue({});
    grantMock.mockReset().mockResolvedValue({ alreadyApplied: false });
    adjustMock.mockReset().mockResolvedValue({});
  });

  it("does nothing when no active subscription exists", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { subscriptionService } = await import("../../../src/services/subscription.service.js");
    await subscriptionService.ensureGrantsForUser("user-1");

    expect(createForUserMock).not.toHaveBeenCalled();
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("ensures wallet exists and applies grant + rollover with deterministic idempotency keys", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ id: "sub-1", credits_granted: 1000, credits_rolled_over: 250 }],
      rowCount: 1,
    });

    const { subscriptionService } = await import("../../../src/services/subscription.service.js");
    await subscriptionService.ensureGrantsForUser("user-1");

    expect(createForUserMock).toHaveBeenCalledWith("user-1");

    expect(grantMock).toHaveBeenCalledWith(
      "user-1",
      250,
      "rollover",
      expect.objectContaining({
        idempotencyKey: "subscription_grant:sub-1:created:rollover",
      }),
    );

    expect(grantMock).toHaveBeenCalledWith(
      "user-1",
      1000,
      "subscription",
      expect.objectContaining({
        idempotencyKey: "subscription_grant:sub-1:created:granted",
      }),
    );
  });

  it("skips grant when both creditsGranted and creditsRolledOver are zero", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ id: "sub-1", credits_granted: 0, credits_rolled_over: 0 }],
      rowCount: 1,
    });

    const { subscriptionService } = await import("../../../src/services/subscription.service.js");
    await subscriptionService.ensureGrantsForUser("user-1");

    expect(createForUserMock).not.toHaveBeenCalled();
    expect(grantMock).not.toHaveBeenCalled();
  });
});
