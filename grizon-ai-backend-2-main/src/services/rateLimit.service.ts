import { planConfig } from "../config/plan.js";
import { COOLDOWN_DURATION_SEC, FLAG_TRIGGER, WINDOWS, cooldownKeyFor, headerNamesFor, keyFor } from "../config/rateLimit.js";
import { getPool } from "../db/pool.js";
import { getRedisClient } from "../infra/redis.js";
import { subscriptionService } from "./subscription.service.js";
import type { Plan } from "../types/plan.js";
import type { RateLimitCheckResult, RateLimitEventType, RateLimitWindowKey, RateLimitWindows } from "../types/rateLimit.js";
import { Errors } from "../utils/errors.js";
import { planRowToPlan } from "../utils/planSerialize.js";

export interface RateLimitWindowUsage {
  used: number;
  limit: number | null;
  remaining: number;
  usagePercent: number | null;
  resetAt: string;
}

export interface AdminUserRateLimitRow {
  user_id: string;
  name: string;
  email: string;
  plan_slug: string;
  plan_name: string;
  cooldown: { active: boolean; cooldownUntil: string | null };
  windows: Record<RateLimitWindowKey, RateLimitWindowUsage>;
  max_usage_percent: number;
}

function asRateWindows(plan: Plan): RateLimitWindows {
  return {
    hourly: plan.limits.hourly ?? null,
    daily: plan.limits.daily ?? null,
    weekly: plan.limits.weekly ?? null,
    monthly: plan.limits.monthly ?? null,
  };
}

function member(now: number): string {
  return `${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function userIdFromRedisKey(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const userId = key.slice(prefix.length);
  return userId.length > 0 ? userId : null;
}

function maxUsagePercent(windows: Record<string, { usagePercent: number | null }>): number {
  let max = 0;
  for (const w of Object.values(windows)) {
    if (w.usagePercent != null) max = Math.max(max, w.usagePercent);
  }
  return max;
}

async function resolvePlanForUser(userId: string): Promise<Plan> {
  const sub = await subscriptionService.getActiveSubscriptionForUser(userId);
  if (sub) return sub.planSnapshot;
  const pool = getPool();
  const planRes = await pool.query(`SELECT * FROM plans WHERE id = $1 AND status = 'active' LIMIT 1`, [planConfig.freePlanId]);
  if (!planRes.rowCount) throw Errors.internal(new Error(`FREE_PLAN_MISSING:${planConfig.freePlanId}`));
  return planRowToPlan(planRes.rows[0] as Record<string, unknown>);
}

async function collectActiveUserIds(redis: NonNullable<Awaited<ReturnType<typeof getRedisClient>>>): Promise<Set<string>> {
  const active = new Set<string>();
  const now = Date.now();

  for (const window of WINDOWS) {
    const prefix = `ratelimit:${window.key}:`;
    for await (const key of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
      const userId = userIdFromRedisKey(String(key), prefix);
      if (!userId) continue;
      const cutoff = now - window.sec * 1000;
      await redis.zRemRangeByScore(key, 0, cutoff);
      const used = Number(await redis.zCard(key));
      if (used > 0) active.add(userId);
    }
  }

  const cooldownPrefix = "ratelimit:cooldown:";
  for await (const key of redis.scanIterator({ MATCH: `${cooldownPrefix}*`, COUNT: 200 })) {
    const userId = userIdFromRedisKey(String(key), cooldownPrefix);
    if (!userId) continue;
    const ttl = await redis.ttl(key);
    if (ttl > 0) active.add(userId);
  }

  return active;
}

export const rateLimitService = {
  async checkAndRecord(userId: string, plan: Plan): Promise<RateLimitCheckResult> {
    const redis = await getRedisClient();
    if (!redis) {
      return { allowed: true, degraded: true, headers: [] };
    }

    const cooldownTtl = await redis.ttl(cooldownKeyFor(userId));
    if (cooldownTtl > 0) {
      const cooldownUntil = new Date(Date.now() + cooldownTtl * 1000);
      return {
        allowed: false,
        deniedBy: "cooldown",
        retryAfterSeconds: cooldownTtl,
        cooldownUntil,
      };
    }

    const now = Date.now();
    const windows = asRateWindows(plan);
    const counts = new Map<RateLimitWindowKey, number>();
    const resets = new Map<RateLimitWindowKey, Date>();

    for (const window of WINDOWS) {
      const limit = windows[window.key];
      if (limit === null) continue;
      const cutoff = now - window.sec * 1000;
      const key = keyFor(window.key, userId);
      await redis.zRemRangeByScore(key, 0, cutoff);
      const count = Number(await redis.zCard(key));
      counts.set(window.key, count);
      const retry = Math.max(1, Math.ceil((window.sec * 1000 - (now - cutoff)) / 1000));
      resets.set(window.key, new Date(now + retry * 1000));
      if (count >= limit) {
        return {
          allowed: false,
          deniedBy: "window",
          limitType: window.key,
          limit,
          remaining: 0,
          resetAt: resets.get(window.key),
          retryAfterSeconds: Math.max(1, Math.ceil((resets.get(window.key)!.getTime() - now) / 1000)),
        };
      }
    }

    for (const window of WINDOWS) {
      const limit = windows[window.key];
      if (limit === null) continue;
      const key = keyFor(window.key, userId);
      await redis.zAdd(key, [{ score: now, value: member(now) }]);
      await redis.expire(key, window.sec);
    }

    return {
      allowed: true,
      headers: rateLimitService.headersFromCounts(windows, counts, resets),
    };
  },

  async peek(userId: string, plan: Plan): Promise<RateLimitCheckResult> {
    const redis = await getRedisClient();
    if (!redis) return { allowed: true, degraded: true, headers: [] };
    const now = Date.now();
    const windows = asRateWindows(plan);
    const counts = new Map<RateLimitWindowKey, number>();
    const resets = new Map<RateLimitWindowKey, Date>();
    for (const window of WINDOWS) {
      const limit = windows[window.key];
      if (limit === null) continue;
      const cutoff = now - window.sec * 1000;
      const key = keyFor(window.key, userId);
      await redis.zRemRangeByScore(key, 0, cutoff);
      counts.set(window.key, Number(await redis.zCard(key)));
      resets.set(window.key, new Date(now + window.sec * 1000));
    }
    return { allowed: true, headers: rateLimitService.headersFromCounts(windows, counts, resets) };
  },

  async resetWindow(userId: string, window: RateLimitWindowKey, actorId: string, reason: string): Promise<void> {
    const pool = getPool();
    const userRes = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (!userRes.rowCount) throw Errors.userNotFound();

    const redis = await getRedisClient();
    if (redis) {
      await redis.del(keyFor(window, userId));
    }
    await rateLimitService.recordEvent("cleared", userId, window, { actorId, reason, window });
  },

  async listActiveUsersUsage(args: {
    page: number;
    pageSize: number;
    search?: string;
    planSlug?: string;
  }): Promise<{ users: AdminUserRateLimitRow[]; total: number; degraded: boolean }> {
    const redis = await getRedisClient();
    if (!redis) {
      return { users: [], total: 0, degraded: true };
    }

    const candidateIds = [...(await collectActiveUserIds(redis))];
    if (candidateIds.length === 0) {
      return { users: [], total: 0, degraded: false };
    }

    const pool = getPool();
    const filters = ["u.id = ANY($1::uuid[])"];
    const values: unknown[] = [candidateIds];
    let i = 2;
    if (args.search) {
      filters.push(`(u.email ILIKE $${i} OR u.name ILIKE $${i})`);
      values.push(`%${args.search}%`);
      i++;
    }
    if (args.planSlug) {
      filters.push(`COALESCE(s.plan_snapshot->>'slug', '') = $${i}`);
      values.push(args.planSlug);
      i++;
    }
    const where = filters.join(" AND ");
    const rows = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        COALESCE(s.plan_snapshot->>'slug', '') AS plan_slug,
        COALESCE(s.plan_snapshot->>'name', 'Free') AS plan_name
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      WHERE ${where}
      ORDER BY u.email ASC
    `,
      values,
    );

    const enriched: AdminUserRateLimitRow[] = [];
    for (const row of rows.rows as Array<{
      user_id: string;
      name: string;
      email: string;
      plan_slug: string;
      plan_name: string;
    }>) {
      const plan = await resolvePlanForUser(row.user_id);
      const usage = await rateLimitService.getUsage(row.user_id, plan);
      const hasWindowUsage = Object.values(usage.windows).some((w) => w.used > 0);
      if (!hasWindowUsage && !usage.cooldown.active) continue;

      const windows = usage.windows as Record<RateLimitWindowKey, RateLimitWindowUsage>;
      enriched.push({
        user_id: row.user_id,
        name: row.name,
        email: row.email,
        plan_slug: row.plan_slug || plan.slug,
        plan_name: row.plan_name || plan.name,
        cooldown: {
          active: usage.cooldown.active,
          cooldownUntil: usage.cooldown.cooldownUntil,
        },
        windows,
        max_usage_percent: maxUsagePercent(windows),
      });
    }

    enriched.sort((a, b) => b.max_usage_percent - a.max_usage_percent);
    const total = enriched.length;
    const offset = (args.page - 1) * args.pageSize;
    const users = enriched.slice(offset, offset + args.pageSize);
    return { users, total, degraded: false };
  },

  async clear(userId: string, actorId: string, reason: string): Promise<void> {
    const redis = await getRedisClient();
    if (redis) {
      await redis.del(
        keyFor("hourly", userId),
        keyFor("daily", userId),
        keyFor("weekly", userId),
        keyFor("monthly", userId),
        cooldownKeyFor(userId),
      );
    }
    await rateLimitService.recordEvent("cleared", userId, undefined, { actorId, reason });
  },

  async applyCooldown(userId: string, durationSec: number, reason: string): Promise<Date> {
    const redis = await getRedisClient();
    const sec = durationSec > 0 ? durationSec : COOLDOWN_DURATION_SEC;
    if (redis) {
      await redis.set(cooldownKeyFor(userId), "1", { EX: sec });
    }
    const until = new Date(Date.now() + sec * 1000);
    await rateLimitService.recordEvent("cooldown", userId, undefined, { reason, cooldownUntil: until.toISOString() });
    const pool = getPool();
    const cooldowns = await pool.query(
      `SELECT COUNT(*)::int AS c FROM rate_limit_events WHERE user_id = $1 AND event_type = 'cooldown' AND created_at > now() - interval '24 hours'`,
      [userId],
    );
    const c = Number(cooldowns.rows[0]?.c ?? 0);
    if (c >= FLAG_TRIGGER.count) {
      await rateLimitService.recordEvent("flagged", userId, undefined, { cooldownsIn24h: c });
    }
    return until;
  },

  async removeCooldown(userId: string, actorId: string, reason: string): Promise<void> {
    const redis = await getRedisClient();
    if (redis) {
      await redis.del(cooldownKeyFor(userId));
    }
    await rateLimitService.recordEvent("cleared", userId, undefined, { actorId, reason });
  },

  async listEvents(args: {
    userId?: string;
    eventType?: string;
    limitType?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }) {
    const pool = getPool();
    const filters = ["TRUE"];
    const values: unknown[] = [];
    let i = 1;
    if (args.userId) {
      filters.push(`rle.user_id = $${i++}`);
      values.push(args.userId);
    }
    if (args.eventType) {
      filters.push(`rle.event_type = $${i++}`);
      values.push(args.eventType);
    }
    if (args.limitType) {
      filters.push(`rle.limit_type = $${i++}`);
      values.push(args.limitType);
    }
    if (args.from) {
      filters.push(`rle.created_at >= $${i++}`);
      values.push(args.from);
    }
    if (args.to) {
      filters.push(`rle.created_at <= $${i++}`);
      values.push(args.to);
    }
    const where = filters.join(" AND ");
    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM rate_limit_events rle WHERE ${where}`, values);
    const total = Number(countRes.rows[0]?.c ?? 0);
    const offset = (args.page - 1) * args.pageSize;
    values.push(args.pageSize, offset);
    const limIdx = i++;
    const offIdx = i;
    const rows = await pool.query(
      `
      SELECT rle.*, u.email AS user_email
      FROM rate_limit_events rle
      JOIN users u ON u.id = rle.user_id
      WHERE ${where}
      ORDER BY rle.created_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}
    `,
      values,
    );
    return { events: rows.rows, total };
  },

  async listFlagged(page = 1, pageSize = 25) {
    const pool = getPool();
    const offset = (page - 1) * pageSize;
    const rows = await pool.query(
      `
      SELECT
        rle.user_id,
        u.email AS user_email,
        COALESCE((s.plan_snapshot->>'slug')::text, '') AS plan_slug,
        COUNT(*)::int AS cooldowns_24h,
        MIN(rle.created_at) AS first_flag_at,
        MAX(rle.created_at) AS last_event_at
      FROM rate_limit_events rle
      JOIN users u ON u.id = rle.user_id
      LEFT JOIN subscriptions s ON s.user_id = rle.user_id AND s.status = 'active'
      WHERE rle.event_type = 'cooldown' AND rle.created_at > now() - interval '24 hours'
      GROUP BY rle.user_id, u.email, plan_slug
      HAVING COUNT(*) >= $1
      ORDER BY last_event_at DESC
      LIMIT $2 OFFSET $3
    `,
      [FLAG_TRIGGER.count, pageSize, offset],
    );
    return rows.rows;
  },

  async resolveFlag(userId: string, action: "resolve_no_action" | "whitelist_24h" | "escalate_ban", notes: string, actorId: string) {
    if (action === "whitelist_24h") {
      await rateLimitService.applyCooldown(userId, 1, "whitelist_short_reset");
      await rateLimitService.removeCooldown(userId, actorId, "whitelist_24h");
    }
    await rateLimitService.recordEvent("flag_resolved", userId, undefined, { action, notes, actorId });
  },

  headersFromCounts(
    windows: RateLimitWindows,
    counts: Map<RateLimitWindowKey, number>,
    resets: Map<RateLimitWindowKey, Date>,
  ): Array<{ key: string; value: string }> {
    const headers: Array<{ key: string; value: string }> = [];
    let earliestReset: Date | null = null;
    for (const window of WINDOWS) {
      const limit = windows[window.key];
      const names = headerNamesFor(window.key);
      if (limit === null) {
        headers.push({ key: names.limit, value: "unlimited" });
        continue;
      }
      const count = counts.get(window.key) ?? 0;
      const remaining = Math.max(limit - count, 0);
      headers.push({ key: names.limit, value: String(limit) });
      headers.push({ key: names.remaining, value: String(remaining) });
      const reset = resets.get(window.key) ?? new Date(Date.now() + window.sec * 1000);
      if (!earliestReset || reset.getTime() < earliestReset.getTime()) earliestReset = reset;
    }
    if (earliestReset) {
      headers.push({ key: "X-RateLimit-Reset", value: String(Math.floor(earliestReset.getTime() / 1000)) });
    }
    return headers;
  },

  async getUsage(userId: string, plan: Plan): Promise<{
    cooldown: { active: boolean; retryAfterSeconds: number | null; cooldownUntil: string | null };
    windows: Record<string, { used: number; limit: number | null; remaining: number; usagePercent: number | null; resetAt: string }>;
    degraded: boolean;
  }> {
    const redis = await getRedisClient();
    if (!redis) {
      return {
        cooldown: { active: false, retryAfterSeconds: null, cooldownUntil: null },
        windows: {},
        degraded: true,
      };
    }

    const cooldownTtl = await redis.ttl(cooldownKeyFor(userId));
    const cooldownActive = cooldownTtl > 0;

    const now = Date.now();
    const windows = asRateWindows(plan);
    const result: Record<string, { used: number; limit: number | null; remaining: number; usagePercent: number | null; resetAt: string }> = {};

    for (const window of WINDOWS) {
      const limit = windows[window.key];
      const cutoff = now - window.sec * 1000;
      const key = keyFor(window.key, userId);
      await redis.zRemRangeByScore(key, 0, cutoff);
      const used = Number(await redis.zCard(key));
      const remaining = limit !== null ? Math.max(limit - used, 0) : 0;
      const usagePercent = limit !== null ? Math.round((used / limit) * 10000) / 100 : null;
      result[window.key] = {
        used,
        limit,
        remaining: limit !== null ? remaining : 0,
        usagePercent,
        resetAt: new Date(now + window.sec * 1000).toISOString(),
      };
    }

    return {
      cooldown: {
        active: cooldownActive,
        retryAfterSeconds: cooldownActive ? cooldownTtl : null,
        cooldownUntil: cooldownActive ? new Date(Date.now() + cooldownTtl * 1000).toISOString() : null,
      },
      windows: result,
      degraded: false,
    };
  },

  async recordEvent(
    eventType: RateLimitEventType,
    userId: string,
    limitType?: RateLimitWindowKey,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO rate_limit_events (user_id, event_type, limit_type, metadata) VALUES ($1,$2,$3,$4::jsonb)`,
      [userId, eventType, limitType ?? null, JSON.stringify(metadata)],
    );
  },
};
