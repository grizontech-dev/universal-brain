import { beforeAll, describe, expect, it } from "vitest";

let subscriptionService: typeof import("../../../src/services/subscription.service.js").subscriptionService;

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

  ({ subscriptionService } = await import("../../../src/services/subscription.service.js"));
}, 30_000);

describe("subscription math helpers", () => {
  it("computePeriodWindow monthly advances one calendar month", () => {
    const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    const { start: outStart, end } = subscriptionService.computePeriodWindow("monthly", start);
    expect(outStart.toISOString()).toBe(start.toISOString());
    expect(end.toISOString()).toBe(new Date(Date.UTC(2026, 1, 15, 12, 0, 0)).toISOString());
  });

  it("computePeriodWindow annual advances one calendar year", () => {
    const start = new Date(Date.UTC(2026, 3, 3, 0, 0, 0));
    const { end } = subscriptionService.computePeriodWindow("annual", start);
    expect(end.toISOString()).toBe(new Date(Date.UTC(2027, 3, 3, 0, 0, 0)).toISOString());
  });

  it("computeRolloverGrant respects rollover=false", () => {
    expect(
      subscriptionService.computeRolloverGrant(
        { included: 100, rollover: false, maxRollover: 50, topupEnabled: false, topupPackages: [] },
        999,
      ),
    ).toBe(0);
  });

  it("computeRolloverGrant caps by maxRollover when set", () => {
    expect(
      subscriptionService.computeRolloverGrant(
        { included: 100, rollover: true, maxRollover: 40, topupEnabled: false, topupPackages: [] },
        999,
      ),
    ).toBe(40);
  });

  it("computeRolloverGrant uses infinity cap when maxRollover null", () => {
    expect(
      subscriptionService.computeRolloverGrant(
        { included: 100, rollover: true, maxRollover: null, topupEnabled: false, topupPackages: [] },
        25,
      ),
    ).toBe(25);
  });
});
