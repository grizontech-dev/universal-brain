import request from "supertest";
import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/services/auth.service.js", () => {
  return {
    authService: {
      checkEmail: vi.fn(async () => ({
        exists: false,
        has_password: false,
        has_google: false,
        suggested_action: "register",
      })),
    },
  };
});

let buildApp: () => import("express").Express;

describe("Module 1 user auth routes (integration)", () => {
  beforeAll(async () => {
    const requiredEnv = {
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
    };

    Object.assign(process.env, requiredEnv);
    ({ buildApp } = await import("../../src/app.js"));
  });

  it("POST /api/v1/auth/check-email returns success envelope", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/auth/check-email")
      .set("x-platform", "web")
      .set("Content-Type", "application/json")
      .send({ email: "maulik@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      exists: false,
      has_password: false,
      has_google: false,
      suggested_action: "register",
    });
  });

  it("POST /api/v1/auth/check-email accepts x-platform=admin (shared auth namespace)", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/auth/check-email")
      .set("x-platform", "admin")
      .set("Content-Type", "application/json")
      .send({ email: "maulik@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

