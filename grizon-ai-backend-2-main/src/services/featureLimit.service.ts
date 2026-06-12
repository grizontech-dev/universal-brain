import { headerNamesFor, keyFor, ttlFor, windowsFor } from "../config/features.js";
import { getRedisClient } from "../infra/redis.js";
import type { FeatureLimits, FeatureName, FeatureWindow } from "../types/feature.js";

type HeaderPair = {
  key: string;
  value: string;
};

type Denial = {
  feature: FeatureName;
  window: FeatureWindow;
  limit: number;
  used: number;
  resetAt: string;
};

export type FeatureLimitResult =
  | {
      allowed: true;
      headers: HeaderPair[];
      degraded?: boolean;
    }
  | {
      allowed: false;
      denial: Denial;
    };

export async function checkAndIncrement(
  userId: string,
  feature: FeatureName,
  featureLimits?: FeatureLimits,
): Promise<FeatureLimitResult> {
  const redis = await getRedisClient();
  if (!redis) {
    return { allowed: true, headers: [], degraded: true };
  }

  const limitsForFeature = featureLimits?.[feature];
  const windows = windowsFor(feature);
  const usedByWindow = new Map<FeatureWindow, number>();

  for (const window of windows) {
    const limit = getLimit(feature, limitsForFeature, window);
    if (limit === null) continue;
    const key = keyFor(feature, window, userId);
    const raw = await redis.get(key);
    const used = Number.parseInt(raw ?? "0", 10);
    usedByWindow.set(window, Number.isNaN(used) ? 0 : used);
    if (used >= limit) {
      const ttlRemaining = await redis.ttl(key);
      const effectiveTtl = ttlRemaining > 0 ? ttlRemaining : ttlFor(feature, window);
      const resetAt = new Date(Date.now() + effectiveTtl * 1000).toISOString();
      return {
        allowed: false,
        denial: { feature, window, limit, used, resetAt },
      };
    }
  }

  const headers: HeaderPair[] = [];
  for (const window of windows) {
    const limit = getLimit(feature, limitsForFeature, window);
    if (limit === null) continue;
    const key = keyFor(feature, window, userId);
    const used = (usedByWindow.get(window) ?? 0) + 1;
    await redis.incr(key);
    if (used === 1) {
      await redis.expire(key, ttlFor(feature, window));
    }
    const names = headerNamesFor(feature, window);
    headers.push({ key: names.limit, value: String(limit) });
    headers.push({ key: names.remaining, value: String(Math.max(limit - used, 0)) });
  }

  return { allowed: true, headers };
}

function getLimit(
  feature: FeatureName,
  limitsForFeature: FeatureLimits[FeatureName] | undefined,
  window: FeatureWindow,
): number | null {
  if (!limitsForFeature) return null;
  if (feature === "webSearch") {
    const webSearchLimits = limitsForFeature as NonNullable<FeatureLimits["webSearch"]>;
    return window === "daily" ? webSearchLimits.dailyLimit : webSearchLimits.monthlyLimit;
  }
  const codeExecutionLimits = limitsForFeature as NonNullable<FeatureLimits["codeExecution"]>;
  return window === "hourly" ? codeExecutionLimits.hourlyLimit : codeExecutionLimits.dailyLimit;
}
