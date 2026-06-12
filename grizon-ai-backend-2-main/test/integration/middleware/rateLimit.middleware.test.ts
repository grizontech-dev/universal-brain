import { describe, expect, it, vi } from "vitest";

const checkAndRecordMock = vi.fn();
const peekMock = vi.fn();

vi.mock("../../../src/services/rateLimit.service.js", () => ({
  rateLimitService: {
    checkAndRecord: checkAndRecordMock,
    peek: peekMock,
  },
}));

describe("rateLimit.middleware (integration)", () => {
  it("sets headers and passes when allowed", async () => {
    checkAndRecordMock.mockResolvedValueOnce({
      allowed: true,
      headers: [{ key: "X-RateLimit-Hourly-Limit", value: "10" }],
    });
    const { rateLimitMiddleware } = await import("../../../src/gateway/rateLimit.middleware.js");
    const req = {
      method: "POST",
      path: "/api/v1/chat",
      user: { id: "user-1" },
      plan: { limits: { hourly: 10, daily: 20, weekly: 30, monthly: 40 } },
    } as any;
    const setHeader = vi.fn();
    const next = vi.fn();
    await rateLimitMiddleware(req, { setHeader } as any, next);
    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Hourly-Limit", "10");
    expect(next).toHaveBeenCalledWith();
  });

  it("returns error when denied by window", async () => {
    checkAndRecordMock.mockResolvedValueOnce({
      allowed: false,
      deniedBy: "window",
      limitType: "hourly",
      limit: 10,
      resetAt: new Date(),
      retryAfterSeconds: 60,
      headers: [],
    });
    const { rateLimitMiddleware } = await import("../../../src/gateway/rateLimit.middleware.js");
    const next = vi.fn();
    const setHeader = vi.fn();
    await rateLimitMiddleware(
      {
        method: "POST",
        path: "/api/v1/chat",
        user: { id: "user-1" },
        plan: { limits: { hourly: 10, daily: 20, weekly: 30, monthly: 40 } },
      } as any,
      { setHeader } as any,
      next,
    );
    expect(next.mock.calls[0][0].code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns error when denied by cooldown", async () => {
    checkAndRecordMock.mockResolvedValueOnce({
      allowed: false,
      deniedBy: "cooldown",
      retryAfterSeconds: 120,
      cooldownUntil: new Date(),
      headers: [],
    });
    const { rateLimitMiddleware } = await import("../../../src/gateway/rateLimit.middleware.js");
    const next = vi.fn();
    const setHeader = vi.fn();
    await rateLimitMiddleware(
      {
        method: "POST",
        path: "/api/v1/chat",
        user: { id: "user-1" },
        plan: { limits: { hourly: 10, daily: 20, weekly: 30, monthly: 40 } },
      } as any,
      { setHeader } as any,
      next,
    );
    const err = next.mock.calls[0][0];
    expect(err.code).toBe("RATE_LIMIT_COOLDOWN");
    expect(err.details?.reason).toBe("cooldown_active");
  });
});
