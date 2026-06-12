import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const getRedisClientMock = vi.fn();

vi.mock("../../../src/infra/redis.js", () => ({
  getRedisClient: getRedisClientMock,
}));

describe("feature middleware (integration)", () => {
  it("enforces webSearch limit and returns 429 on limit+1", async () => {
    const store = new Map<string, number>();
    const ttl = new Map<string, number>();
    getRedisClientMock.mockResolvedValue({
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
    });

    const { requireFeatureWithLimit } = await import("../../../src/gateway/requireFeatureWithLimit.js");
    const { errorHandler } = await import("../../../src/gateway/errorHandler.middleware.js");
    const app = express();
    app.use((req, _res, next) => {
      (req as any).id = "req-test";
      (req as any).user = { id: "user-1" };
      (req as any).plan = {
        featureFlags: { webSearch: true },
        featureLimits: {
          webSearch: { dailyLimit: 2, monthlyLimit: null },
          codeExecution: null,
        },
      };
      next();
    });
    app.get("/search", requireFeatureWithLimit("webSearch"), (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(errorHandler);

    const first = await request(app).get("/search");
    expect(first.status).toBe(200);
    expect(first.headers["x-feature-websearch-daily-remaining"]).toBe("1");

    const second = await request(app).get("/search");
    expect(second.status).toBe(200);
    expect(second.headers["x-feature-websearch-daily-remaining"]).toBe("0");

    const third = await request(app).get("/search");
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("FEATURE_LIMIT_EXCEEDED");
  });
});
