import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let buildApp: () => import("express").Express;

describe("ratelimits admin routes (integration)", () => {
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
      ALLOWED_ORIGINS: "http://localhost:3000",
    });
    ({ buildApp } = await import("../../../src/app.js"));
  }, 60_000);

  it("GET /api/v1/admin/ratelimits/events requires admin auth", async () => {
    const app = buildApp();
    const response = await request(app).get("/api/v1/admin/ratelimits/events").set("x-platform", "admin");
    expect(response.status).toBe(401);
  });

  it("GET /api/v1/admin/ratelimits/users requires admin auth", async () => {
    const app = buildApp();
    const response = await request(app).get("/api/v1/admin/ratelimits/users").set("x-platform", "admin");
    expect(response.status).toBe(401);
  });

  it("POST /api/v1/admin/ratelimits/:userId/reset-window requires admin auth", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/admin/ratelimits/00000000-0000-4000-8000-000000000001/reset-window")
      .set("x-platform", "admin")
      .send({ window: "hourly", reason: "Support reset hourly window" });
    expect(response.status).toBe(401);
  });
});
