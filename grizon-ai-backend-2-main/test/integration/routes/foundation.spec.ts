import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

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

let buildApp: () => import("express").Express;

beforeAll(async () => {
  Object.assign(process.env, requiredEnv);
  ({ buildApp } = await import("../../../src/app.js"));
}, 60_000);

describe("foundation envelope", () => {
  it("returns success envelope and request id", async () => {
    const app = buildApp();
    const response = await request(app)
      .get("/api/v1/ping")
      .set("x-platform", "web")
      .set("x-request-id", "req_test_123");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Pong.");
    expect(response.body.meta.request_id).toBe("req_test_123");
    expect(response.headers["x-request-id"]).toBe("req_test_123");
  });

  it("returns error envelope for app errors", async () => {
    const app = buildApp();
    const response = await request(app).get("/api/v1/error").set("x-platform", "web");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.meta.request_id).toBeTruthy();
  });
});
