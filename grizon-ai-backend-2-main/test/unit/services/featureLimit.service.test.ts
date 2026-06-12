import { beforeEach, describe, expect, it, vi } from "vitest";

const getRedisClientMock = vi.fn();

vi.mock("../../../src/infra/redis.js", () => ({
  getRedisClient: getRedisClientMock,
}));

describe("featureLimit.service (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows first call and returns limit/remaining headers", async () => {
    const store = new Map<string, number>();
    const ttl = new Map<string, number>();
    const redis = {
      get: vi.fn(async (key: string) => (store.has(key) ? String(store.get(key)) : null)),
      ttl: vi.fn(async (key: string) => ttl.get(key) ?? -1),
      incr: vi.fn(async (key: string) => {
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      }),
      expire: vi.fn(async (key: string, seconds: number) => {
        ttl.set(key, seconds);
        return 1;
      }),
    };
    getRedisClientMock.mockResolvedValue(redis);

    const { checkAndIncrement } = await import("../../../src/services/featureLimit.service.js");
    const result = await checkAndIncrement("user-1", "webSearch", {
      webSearch: { dailyLimit: 2, monthlyLimit: 4 },
      codeExecution: null,
    });

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.headers).toEqual(
        expect.arrayContaining([
          { key: "X-Feature-WebSearch-Daily-Limit", value: "2" },
          { key: "X-Feature-WebSearch-Daily-Remaining", value: "1" },
          { key: "X-Feature-WebSearch-Monthly-Limit", value: "4" },
          { key: "X-Feature-WebSearch-Monthly-Remaining", value: "3" },
        ]),
      );
    }
  });

  it("denies request when daily limit is reached", async () => {
    const redis = {
      get: vi.fn(async () => "2"),
      ttl: vi.fn(async () => 3600),
      incr: vi.fn(),
      expire: vi.fn(),
    };
    getRedisClientMock.mockResolvedValue(redis);

    const { checkAndIncrement } = await import("../../../src/services/featureLimit.service.js");
    const result = await checkAndIncrement("user-1", "webSearch", {
      webSearch: { dailyLimit: 2, monthlyLimit: null },
      codeExecution: null,
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.denial.feature).toBe("webSearch");
      expect(result.denial.window).toBe("daily");
      expect(result.denial.limit).toBe(2);
      expect(result.denial.used).toBe(2);
      expect(result.denial.resetAt).toBeTruthy();
    }
  });

  it("passes through when all windows are unlimited", async () => {
    const redis = {
      get: vi.fn(async () => null),
      ttl: vi.fn(async () => -1),
      incr: vi.fn(),
      expire: vi.fn(),
    };
    getRedisClientMock.mockResolvedValue(redis);

    const { checkAndIncrement } = await import("../../../src/services/featureLimit.service.js");
    const result = await checkAndIncrement("user-1", "webSearch", {
      webSearch: { dailyLimit: null, monthlyLimit: null },
      codeExecution: null,
    });

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.headers).toEqual([]);
    }
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it("fails open when redis is unavailable", async () => {
    getRedisClientMock.mockResolvedValue(null);
    const { checkAndIncrement } = await import("../../../src/services/featureLimit.service.js");
    const result = await checkAndIncrement("user-1", "webSearch", {
      webSearch: { dailyLimit: 1, monthlyLimit: 2 },
      codeExecution: null,
    });
    expect(result).toEqual({ allowed: true, headers: [], degraded: true });
  });
});
