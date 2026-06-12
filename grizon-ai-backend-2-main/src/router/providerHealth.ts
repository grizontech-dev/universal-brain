import { getRedisClient } from "../infra/redis.js";
import { logger } from "../utils/logger.js";
import type { ProviderHealth, ProviderId } from "../types/router.js";

const PREFIX = "router:health:";
const WINDOW_SEC = 60;
const OPEN_THRESHOLD = 3;
const HALF_OPEN_AFTER_MS = 30_000;

const providers: ProviderId[] = ["anthropic", "openai", "google", "xai", "deepseek"];

function key(p: ProviderId) {
  return `${PREFIX}${p}`;
}

export const providerHealth = {
  async recordSuccess(p: ProviderId): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;
    try {
      await redis.hSet(key(p), {
        state: "closed",
        openedAt: "",
        failuresInWindow: "0",
        lastErrorCode: "",
      });
    } catch (err) {
      logger.warn({ err, provider: p }, "provider_health_record_success_failed");
    }
  },

  async recordFailure(p: ProviderId, err: unknown): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;
    try {
      const k = key(p);
      const fails = await redis.hIncrBy(k, "failuresInWindow", 1);
      await redis.expire(k, WINDOW_SEC);
      const code = err instanceof Error ? err.name : "UNKNOWN";
      await redis.hSet(k, "lastErrorCode", code);
      if (fails >= OPEN_THRESHOLD) {
        await redis.hSet(k, {
          state: "open",
          openedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      logger.warn({ err: e, provider: p }, "provider_health_record_failure_failed");
    }
  },

  async isOpen(p: ProviderId): Promise<boolean> {
    const h = await this.snapshotOne(p);
    if (!h || h.state === "disabled") return false;
    if (h.state === "closed" || h.state === "half_open") return false;
    if (h.state === "open" && h.openedAt) {
      const opened = Date.parse(h.openedAt);
      if (Number.isFinite(opened) && Date.now() - opened > HALF_OPEN_AFTER_MS) {
        const redis = await getRedisClient();
        if (redis) {
          await redis.hSet(key(p), "state", "half_open");
        }
        return false;
      }
      return true;
    }
    return false;
  },

  async snapshotOne(p: ProviderId): Promise<ProviderHealth | null> {
    const redis = await getRedisClient();
    if (!redis) return null;
    try {
      const raw = await redis.hGetAll(key(p));
      if (!Object.keys(raw).length) {
        return {
          provider: p,
          state: "closed",
          openedAt: null,
          failuresInWindow: 0,
          lastErrorCode: null,
        };
      }
      return {
        provider: p,
        state: (raw.state as ProviderHealth["state"]) ?? "closed",
        openedAt: raw.openedAt || null,
        failuresInWindow: Number(raw.failuresInWindow ?? 0),
        lastErrorCode: raw.lastErrorCode || null,
      };
    } catch {
      return null;
    }
  },

  async snapshot(): Promise<Map<ProviderId, ProviderHealth>> {
    const map = new Map<ProviderId, ProviderHealth>();
    for (const p of providers) {
      const h = await this.snapshotOne(p);
      if (h) map.set(p, h);
    }
    return map;
  },
};
