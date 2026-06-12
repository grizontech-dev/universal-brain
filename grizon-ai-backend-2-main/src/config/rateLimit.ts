import type { RateLimitWindowKey } from "../types/rateLimit.js";

export const WINDOWS: Array<{ key: RateLimitWindowKey; sec: number; label: string }> = [
  { key: "hourly", sec: 3600, label: "Hourly" },
  { key: "daily", sec: 86400, label: "Daily" },
  { key: "weekly", sec: 604800, label: "Weekly" },
  { key: "monthly", sec: 2592000, label: "Monthly" },
];

export const COOLDOWN_DURATION_SEC = 300;
export const FLAG_TRIGGER = { count: 20, withinSec: 86400 };

const SKIP_EXACT = new Set([
  "GET /health",
  "GET /api/v1/auth/me",
  "GET /api/v1/wallet",
  "GET /api/v1/usage/summary",
  "GET /api/v1/usage/rate-limit",
  "GET /api/v1/conversations",
  "GET /api/v1/subscription",
  "GET /api/v1/catalogue",
  "GET /api/v1/usage/history",
  "GET /api/v1/wallet/transactions",
  "GET /api/v1/artifacts",
]);

const SKIP_PREFIXES = [
  "/api/v1/conversations/",
  "/api/v1/catalogue/",
  "/api/v1/files/",
  "/api/v1/artifacts/",
  "/api/v1/chat/stream/",
];

export function keyFor(window: RateLimitWindowKey, userId: string): string {
  return `ratelimit:${window}:${userId}`;
}

export function cooldownKeyFor(userId: string): string {
  return `ratelimit:cooldown:${userId}`;
}

export function headerNamesFor(window: RateLimitWindowKey): { limit: string; remaining: string } {
  const label = WINDOWS.find((w) => w.key === window)?.label ?? "Unknown";
  return {
    limit: `X-RateLimit-${label}-Limit`,
    remaining: `X-RateLimit-${label}-Remaining`,
  };
}

export function isSkipped(method: string, path: string): boolean {
  if (path.startsWith("/api/v1/admin/")) return true;
  if (SKIP_EXACT.has(`${method.toUpperCase()} ${path}`)) return true;
  if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return false;
}
