import { getAllAgentDescriptors } from "../agents/index.js";
import { getRedisClient } from "../infra/redis.js";
import { logger } from "../utils/logger.js";
import type { ProviderId } from "../types/router.js";

const TTL_SEC = 172800;

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "google", "xai", "deepseek"];

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function incrExpire(key: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.incr(key);
    await redis.expire(key, TTL_SEC);
  } catch (err) {
    logger.debug({ err, key }, "live_metrics_incr_failed");
  }
}

function coerceProvider(provider: string): ProviderId | null {
  return PROVIDERS.includes(provider as ProviderId) ? (provider as ProviderId) : null;
}

export const liveMetricsService = {
  /** Semantic cache answer served (no LLM provider round). */
  async recordSemanticHit(agentSlug: string): Promise<void> {
    try {
      await this.incrSemanticCacheHitDay();
      await this.incrAgentCall(agentSlug);
    } catch (err) {
      logger.debug({ err }, "live_metrics_semantic_hit_failed");
    }
  },

  /** Successful LLM completion path. */
  async recordLlmSuccess(provider: string, agentSlug: string, inputCached: number): Promise<void> {
    try {
      const pid = coerceProvider(provider);
      if (pid) await this.incrProviderOk(pid);
      await this.incrAgentCall(agentSlug);
      if (inputCached > 0) await this.incrPromptCacheHitDay();
    } catch (err) {
      logger.debug({ err }, "live_metrics_llm_success_failed");
    }
  },

  /** Provider-side failure (not user cancel). */
  async recordProviderFailure(provider: string): Promise<void> {
    try {
      const pid = coerceProvider(provider);
      if (pid) await this.incrProviderErr(pid);
    } catch (err) {
      logger.debug({ err }, "live_metrics_provider_err_failed");
    }
  },

  async incrSemanticCacheHitDay(dateKey = dayKey()): Promise<void> {
    await incrExpire(`metrics:cache:semantic:${dateKey}`);
  },

  async incrPromptCacheHitDay(dateKey = dayKey()): Promise<void> {
    await incrExpire(`metrics:cache:prompt:${dateKey}`);
  },

  async incrProviderOk(provider: ProviderId, dateKey = dayKey()): Promise<void> {
    await incrExpire(`metrics:provider:${provider}:ok:${dateKey}`);
  },

  async incrProviderErr(provider: ProviderId, dateKey = dayKey()): Promise<void> {
    await incrExpire(`metrics:provider:${provider}:err:${dateKey}`);
  },

  async incrAgentCall(agentSlug: string, dateKey = dayKey()): Promise<void> {
    await incrExpire(`metrics:agent:${agentSlug}:calls:${dateKey}`);
  },

  async getSnapshot() {
    const today = dayKey();
    const yesterday = dayKey(new Date(Date.now() - 86400_000));
    const agentSlugs = getAllAgentDescriptors().map((a) => a.slug).sort();

    const redis = await getRedisClient();
    if (!redis) {
      return {
        date: today,
        cache: {
          semanticHitsToday: 0,
          semanticHitsYesterday: 0,
          promptCacheHitsToday: 0,
        },
        providers: PROVIDERS.map((id) => ({ id, successesToday: 0, errorsToday: 0 })),
        agents: agentSlugs.map((slug) => ({ slug, callsToday: 0 })),
      };
    }

    try {
      const providerKeys = PROVIDERS.flatMap((p) => [
        `metrics:provider:${p}:ok:${today}`,
        `metrics:provider:${p}:err:${today}`,
      ]);
      const agentKeys = agentSlugs.map((a) => `metrics:agent:${a}:calls:${today}`);

      const cacheKeys = [
        `metrics:cache:semantic:${today}`,
        `metrics:cache:semantic:${yesterday}`,
        `metrics:cache:prompt:${today}`,
      ];

      const [cacheVals, providerVals, agentVals] = await Promise.all([
        redis.mGet(cacheKeys),
        redis.mGet(providerKeys),
        redis.mGet(agentKeys),
      ]);

      const parseInt0 = (v: string | null | undefined) => Number.parseInt(String(v ?? "0"), 10) || 0;

      const semanticToday = parseInt0(cacheVals[0]);
      const semanticYesterday = parseInt0(cacheVals[1]);
      const promptToday = parseInt0(cacheVals[2]);

      const providers = PROVIDERS.map((id, i) => ({
        id,
        successesToday: parseInt0(providerVals[i * 2]),
        errorsToday: parseInt0(providerVals[i * 2 + 1]),
      }));

      const agents = agentSlugs.map((slug, i) => ({
        slug,
        callsToday: parseInt0(agentVals[i]),
      }));

      return {
        date: today,
        cache: {
          semanticHitsToday: semanticToday,
          semanticHitsYesterday: semanticYesterday,
          promptCacheHitsToday: promptToday,
        },
        providers,
        agents,
      };
    } catch (err) {
      logger.warn({ err }, "live_metrics_snapshot_failed");
      return {
        date: today,
        cache: {
          semanticHitsToday: 0,
          semanticHitsYesterday: 0,
          promptCacheHitsToday: 0,
        },
        providers: PROVIDERS.map((id) => ({ id, successesToday: 0, errorsToday: 0 })),
        agents: agentSlugs.map((slug) => ({ slug, callsToday: 0 })),
      };
    }
  },
};
