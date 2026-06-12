import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/gateway/auth.middleware.js", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", role: "user" };
    req.platform = "web";
    next();
  },
}));
vi.mock("../../../src/gateway/admin.middleware.js", () => ({
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireSuperadmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../src/gateway/plan.middleware.js", () => ({
  planMiddleware: (req: any, _res: any, next: any) => {
    req.plan = {
      limits: { maxContextMessages: 20, maxFileSize: 1024, maxFilesPerChat: 5, maxArtifactVersions: 5 },
      featureFlags: { modelPicker: true, fileUpload: true, artifactVersioning: true, documentAnalysis: true },
    };
    next();
  },
}));
vi.mock("../../../src/gateway/featureFlag.middleware.js", () => ({ featureFlagMiddleware: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../src/gateway/rateLimit.middleware.js", () => ({ rateLimitMiddleware: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../src/gateway/creditBudget.middleware.js", () => ({ creditBudgetMiddleware: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../src/gateway/logger.middleware.js", () => ({ requestLogger: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../src/gateway/sanitiser.middleware.js", () => ({ sanitiserMiddleware: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../src/gateway/cors.middleware.js", () => ({ corsMiddleware: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../../src/services/conversation.service.js", () => ({
  conversationService: {
    list: vi.fn(async () => ({ items: [{ id: "c1", title: "T" }], nextCursor: null, hasMore: false })),
  },
}));

let buildApp: () => import("express").Express;

describe("conversation user routes", () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      PORT: "3000",
      PUBLIC_URL: "http://localhost:3000",
      APP_VERSION: "test",
      LOG_LEVEL: "info",
      LOG_PRETTY: "false",
      DATABASE_URL: "postgres://app:app@localhost:5432/app",
      DATABASE_POOL_MAX: "20",
      REDIS_URL: "redis://localhost:6379",
      QDRANT_URL: "http://localhost:6333",
      JWT_PRIVATE_KEY_PATH: "./secrets/jwt-private.pem",
      JWT_PUBLIC_KEY_PATH: "./secrets/jwt-public.pem",
      JWT_KID: "v1",
      JWT_ISSUER: "http://localhost:3000",
      ACCESS_TOKEN_TTL_SECONDS: "900",
      REFRESH_TOKEN_TTL_SECONDS: "2592000",
      GOOGLE_CLIENT_IDS: "x",
      MAIL_PROVIDER: "postmark",
      MAIL_FROM: "hello@example.com",
      ALLOWED_ORIGINS: "http://localhost:3000",
    });
    ({ buildApp } = await import("../../../src/app.js"));
  });

  it("GET /api/v1/conversations returns success envelope", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/v1/conversations");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
