import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/analytics.service.js", () => ({
  analyticsService: {
    getUserSummary: vi.fn(async () => ({
      requests: 1,
      total_tokens: 100,
      credits_used: 2,
      cost_usd: 0.01,
    })),
    getUserHistory: vi.fn(async () => []),
  },
}));

let buildApp: () => import("express").Express;

describe("usage user routes (integration)", () => {
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
      QDRANT_API_KEY: "",
      JWT_PRIVATE_KEY_PATH: "./secrets/jwt-private.pem",
      JWT_PUBLIC_KEY_PATH: "./secrets/jwt-public.pem",
      JWT_KID: "v1",
      JWT_ISSUER: "http://localhost:3000",
      ACCESS_TOKEN_TTL_SECONDS: "900",
      REFRESH_TOKEN_TTL_SECONDS: "2592000",
      GOOGLE_CLIENT_IDS: "web-client-id.apps.googleusercontent.com",
      TURNSTILE_SECRET: "",
      MAIL_PROVIDER: "postmark",
      MAIL_API_KEY: "",
      MAIL_FROM: "hello@example.com",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GOOGLE_AI_API_KEY: "",
      TAVILY_API_KEY: "",
      IP_HASH_SALT: "test-salt",
      ALLOWED_ORIGINS: "http://localhost:3000",
    });
    ({ buildApp } = await import("../../../src/app.js"));
  }, 60_000);

  it("GET /api/v1/usage/summary requires auth", async () => {
    const app = buildApp();
    const response = await request(app).get("/api/v1/usage/summary").set("x-platform", "web");
    expect(response.status).toBe(401);
  });
});
