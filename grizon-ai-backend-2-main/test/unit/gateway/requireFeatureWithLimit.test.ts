import { beforeEach, describe, expect, it, vi } from "vitest";

const checkAndIncrementMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock("../../../src/services/featureLimit.service.js", () => ({
  checkAndIncrement: checkAndIncrementMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { warn: loggerWarnMock },
}));

describe("requireFeatureWithLimit (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when feature flag is disabled", async () => {
    const { requireFeatureWithLimit } = await import("../../../src/gateway/requireFeatureWithLimit.js");
    const next = vi.fn();
    const middleware = requireFeatureWithLimit("webSearch");

    await middleware(
      {
        user: { id: "user-1" },
        plan: {
          featureFlags: { webSearch: false },
          featureLimits: { webSearch: { dailyLimit: 1, monthlyLimit: 2 }, codeExecution: null },
        },
      } as any,
      {} as any,
      next,
    );
    expect(next.mock.calls[0][0].code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("returns 403 when feature limits for feature are null", async () => {
    const { requireFeatureWithLimit } = await import("../../../src/gateway/requireFeatureWithLimit.js");
    const next = vi.fn();
    const middleware = requireFeatureWithLimit("webSearch");

    await middleware(
      {
        user: { id: "user-1" },
        plan: {
          featureFlags: { webSearch: true },
          featureLimits: { webSearch: null, codeExecution: null },
        },
      } as any,
      {} as any,
      next,
    );
    expect(next.mock.calls[0][0].code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("sets headers and calls next when allowed", async () => {
    checkAndIncrementMock.mockResolvedValueOnce({
      allowed: true,
      headers: [{ key: "X-Feature-WebSearch-Daily-Remaining", value: "1" }],
    });
    const { requireFeatureWithLimit } = await import("../../../src/gateway/requireFeatureWithLimit.js");
    const next = vi.fn();
    const setHeader = vi.fn();
    const middleware = requireFeatureWithLimit("webSearch");

    await middleware(
      {
        id: "req-1",
        user: { id: "user-1" },
        plan: {
          featureFlags: { webSearch: true },
          featureLimits: { webSearch: { dailyLimit: 2, monthlyLimit: 5 }, codeExecution: null },
        },
      } as any,
      { setHeader } as any,
      next,
    );

    expect(setHeader).toHaveBeenCalledWith("X-Feature-WebSearch-Daily-Remaining", "1");
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 429 with feature limit exceeded", async () => {
    checkAndIncrementMock.mockResolvedValueOnce({
      allowed: false,
      denial: {
        feature: "webSearch",
        window: "daily",
        limit: 2,
        used: 2,
        resetAt: new Date().toISOString(),
      },
    });
    const { requireFeatureWithLimit } = await import("../../../src/gateway/requireFeatureWithLimit.js");
    const next = vi.fn();
    const middleware = requireFeatureWithLimit("webSearch");

    await middleware(
      {
        user: { id: "user-1" },
        plan: {
          featureFlags: { webSearch: true },
          featureLimits: { webSearch: { dailyLimit: 2, monthlyLimit: 5 }, codeExecution: null },
        },
      } as any,
      {} as any,
      next,
    );
    expect(next.mock.calls[0][0].code).toBe("FEATURE_LIMIT_EXCEEDED");
  });

  it("fails open and logs warning when service is degraded", async () => {
    checkAndIncrementMock.mockResolvedValueOnce({
      allowed: true,
      headers: [],
      degraded: true,
    });
    const { requireFeatureWithLimit } = await import("../../../src/gateway/requireFeatureWithLimit.js");
    const next = vi.fn();
    const middleware = requireFeatureWithLimit("webSearch");

    await middleware(
      {
        id: "req-1",
        user: { id: "user-1" },
        plan: {
          featureFlags: { webSearch: true },
          featureLimits: { webSearch: { dailyLimit: 2, monthlyLimit: 5 }, codeExecution: null },
        },
      } as any,
      {} as any,
      next,
    );

    expect(loggerWarnMock).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });
});
