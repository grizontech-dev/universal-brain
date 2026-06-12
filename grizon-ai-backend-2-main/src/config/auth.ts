import "dotenv/config";

import { env } from "./env.js";

// Module 1 auth config: single source of truth for knobs.
// Keep this file dependency-light; actual key reads are done lazily by the token layer.

export const authConfig = {
  accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,

  jwt: {
    issuer: env.JWT_ISSUER,
    kid: env.JWT_KID,
    // For access tokens the `aud` claim is the device platform (`x-platform`).
    acceptedPlatforms: ["web", "admin", "mobile-ios", "mobile-android"] as const,
  },

  lockoutPolicy: {
    // 5 failed logins / 15 min => lock
    failedLoginThreshold: 5,
    failedLoginWindowSeconds: 15 * 60,

    // base 15 min lock, doubles on repeat, capped at 60 min
    baseLockoutSeconds: 15 * 60,
    maxLockoutSeconds: 60 * 60,
    doublingWindowSeconds: 24 * 60 * 60,
  },

  captcha: {
    // Email-check endpoint mitigation:
    // - captcha required after 3rd 429 within 10 minutes (per IP)
    requireAfterEmailCheck429Count: 3,
    requireAfterEmailCheck429WindowSeconds: 10 * 60,
    // NOTE: token validation is handled by the route/service layer.
  },

  emailCheckRateLimits: {
    // per IP: 30 / min, 300 / hour
    ipPerMinute: 30,
    ipPerHour: 300,
    // per email: 10 / hour
    emailPerHour: 10,
  },

  password: {
    // OWASP 2024-ish baseline from docs.
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  },

  jwtRotation: {
    // Phase 1 supports two key pairs: current + previous.
    // We load previous keys lazily if env provides them.
    previousPrivateKeyPath: process.env.JWT_PRIVATE_KEY_PATH_PREVIOUS,
    previousPublicKeyPath: process.env.JWT_PUBLIC_KEY_PATH_PREVIOUS,
  },
};

export const googleConfig = {
  clientIds: env.GOOGLE_CLIENT_IDS,
  // Required issuer forms per docs.
  acceptedIssuers: ["accounts.google.com", "https://accounts.google.com"],
  // email_verified must be true
};

