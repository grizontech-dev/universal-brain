import { beforeAll, describe, expect, it } from "vitest";

describe("passwordService", () => {
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

  let passwordService: typeof import("../../src/services/password.service.js").passwordService;

  beforeAll(() => {
    Object.assign(process.env, requiredEnv);
  });

  beforeAll(async () => {
    ({ passwordService } = await import("../../src/services/password.service.js"));
  });

  it("hashes and verifies passwords", async () => {
    const plain = "Password1234";
    const hash = await passwordService.hash(plain);

    expect(hash).toMatch(/^\$argon2/);
    await expect(passwordService.verify(plain, hash)).resolves.toBe(true);
    await expect(passwordService.verify("wrong-password", hash)).resolves.toBe(false);
  });

  it("needsRehash returns false for current params", async () => {
    const plain = "Password1234";
    const hash = await passwordService.hash(plain);
    expect(passwordService.needsRehash(hash)).toBe(false);
  });
});

