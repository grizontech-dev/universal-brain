import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "crypto";

function toPem(key: any, type: "pkcs1" | "spki" = "spki") {
  // Node exports depend on key type.
  return key.export(type === "pkcs1" ? { type: "pkcs1", format: "pem" } : { type: "spki", format: "pem" });
}

describe("tokenService (unit)", () => {
  let tokenService: typeof import("../../src/services/token.service.js").tokenService;

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
      REDIS_URL: "redis://localhost:0",
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

    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });

    process.env.JWT_PRIVATE_KEY_PEM = privateKey;
    process.env.JWT_PUBLIC_KEY_PEM = publicKey;

    ({ tokenService } = await import("../../src/services/token.service.js"));
  });

  it("signs and verifies access tokens", async () => {
    const { accessToken } = await tokenService.signAccess({
      userId: "user-1",
      role: "user",
      planId: null,
      platform: "web",
      sessionId: "session-1",
      ttlSeconds: 60,
    });

    const decoded = await tokenService.verifyAccess(accessToken, "web");
    expect(decoded.jti).toBe("session-1");
    expect(decoded.role).toBe("user");
    expect(decoded.aud).toBe("web");
  });
});

