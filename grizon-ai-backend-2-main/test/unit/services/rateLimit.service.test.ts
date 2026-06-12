import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = {
  ttl: vi.fn(),
  zRemRangeByScore: vi.fn(),
  zCard: vi.fn(),
  zAdd: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scanIterator: vi.fn(),
};

vi.mock("../../../src/infra/redis.js", () => ({
  getRedisClient: vi.fn(async () => redis),
}));

const queryMock = vi.fn();
vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
}));

describe("rateLimit.service (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.ttl.mockResolvedValue(-1);
    redis.zCard.mockResolvedValue(0);
    queryMock.mockResolvedValue({ rows: [{ c: 0 }], rowCount: 1 });
  });

  it("allows request and returns headers", async () => {
    const { rateLimitService } = await import("../../../src/services/rateLimit.service.js");
    const result = await rateLimitService.checkAndRecord("user-1", {
      limits: { hourly: 10, daily: 100, weekly: 1000, monthly: 5000 },
    } as any);
    expect(result.allowed).toBe(true);
    expect(result.headers?.length).toBeGreaterThan(0);
  });

  it("denies on active cooldown", async () => {
    redis.ttl.mockResolvedValueOnce(120);
    const { rateLimitService } = await import("../../../src/services/rateLimit.service.js");
    const result = await rateLimitService.checkAndRecord("user-1", {
      limits: { hourly: 10, daily: 100, weekly: 1000, monthly: 5000 },
    } as any);
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe("cooldown");
  });

  it("denies by plan window without applying cooldown escalation", async () => {
    redis.zCard.mockResolvedValueOnce(10);
    const { rateLimitService } = await import("../../../src/services/rateLimit.service.js");
    const result = await rateLimitService.checkAndRecord("user-1", {
      limits: { hourly: 10, daily: 100, weekly: 1000, monthly: 5000 },
    } as any);
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe("window");
    expect(result.limitType).toBe("hourly");
    expect(result.limit).toBe(10);
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.zAdd).not.toHaveBeenCalled();
  });

  it("resetWindow deletes only the selected window key and audits", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "user-1" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { rateLimitService } = await import("../../../src/services/rateLimit.service.js");
    await rateLimitService.resetWindow("user-1", "hourly", "admin-1", "Support reset hourly window");
    expect(redis.del).toHaveBeenCalledWith("ratelimit:hourly:user-1");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO rate_limit_events"),
      expect.arrayContaining(["user-1", "cleared", "hourly"]),
    );
  });

  it("resetWindow throws when user does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const { rateLimitService } = await import("../../../src/services/rateLimit.service.js");
    await expect(
      rateLimitService.resetWindow("missing-user", "daily", "admin-1", "Support reset daily window"),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});
