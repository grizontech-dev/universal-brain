import { getPool } from "../db/pool.js";
import { liveMetricsService } from "./liveMetrics.service.js";

export type CacheRoiResult = {
  period: { from: string; to: string };
  semantic: { hits: number; creditsSaved: number };
  promptCache: {
    cachedTokens: number;
    estimatedUsdSaved: number;
    byProvider: Array<{ provider: string; cachedTokens: number; estimatedUsdSaved: number }>;
  };
  summary: {
    totalUsdSpent: number;
    /** Prompt-cache USD savings only (see promptCache.estimatedUsdSaved). */
    promptCacheUsdSaved: number;
    /** User credits not charged on semantic hits (not USD). */
    semanticCreditsSaved: number;
    /** Share of (recorded spend + prompt savings) attributable to prompt-cache USD savings. */
    savingsPercent: number;
  };
};

export const analyticsService = {
  /** Semantic cache hits + estimated prompt-cache USD savings from api_calls (Anthropic/OpenAI heuristics). */
  async getCacheRoi(params: { from: Date; to: Date }): Promise<CacheRoiResult> {
    const pool = getPool();
    const from = params.from.toISOString();
    const to = params.to.toISOString();

    const semanticRes = await pool.query(
      `
      SELECT
        COUNT(*)::int AS semantic_hits,
        COALESCE(SUM(saved_credits), 0)::numeric AS semantic_credits_saved
      FROM semantic_cache_hits
      WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
    `,
      [from, to],
    );

    const semanticRow = semanticRes.rows[0] as {
      semantic_hits: number;
      semantic_credits_saved: string | number;
    };
    const semanticHits = Number(semanticRow?.semantic_hits ?? 0);
    const semanticCreditsSaved = Number(semanticRow?.semantic_credits_saved ?? 0);

    const promptRes = await pool.query(
      `
      SELECT
        ac.provider,
        SUM(ac.input_cached)::bigint AS cached_tokens,
        SUM(
          (ac.input_cached::numeric / 1000.0)
          * COALESCE(am.input_cost_per_1k, 0)::numeric
          * CASE ac.provider
              WHEN 'anthropic' THEN 0.9
              WHEN 'openai' THEN 0.5
              ELSE 0
            END
        )::numeric AS estimated_usd_saved
      FROM api_calls ac
      LEFT JOIN ai_models am ON am.model_id = ac.model
      WHERE ac.created_at >= $1::timestamptz
        AND ac.created_at <= $2::timestamptz
        AND ac.input_cached > 0
      GROUP BY ac.provider
      ORDER BY ac.provider
    `,
      [from, to],
    );

    type PromptRow = {
      provider: unknown;
      cached_tokens: unknown;
      estimated_usd_saved: unknown;
    };
    const byProvider = (promptRes.rows as PromptRow[]).map((row) => ({
      provider: String(row.provider),
      cachedTokens: Number(row.cached_tokens ?? 0),
      estimatedUsdSaved: Number(row.estimated_usd_saved ?? 0),
    }));

    const promptCachedTokens = byProvider.reduce((acc, row) => acc + row.cachedTokens, 0);
    const promptUsdSaved = byProvider.reduce((acc, row) => acc + row.estimatedUsdSaved, 0);

    const totalRes = await pool.query(
      `
      SELECT COALESCE(SUM(cost_usd_billed_to_us), 0)::numeric AS total_usd_spent
      FROM api_calls
      WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
    `,
      [from, to],
    );
    const totalUsdSpent = Number((totalRes.rows[0] as { total_usd_spent?: string | number })?.total_usd_spent ?? 0);

    const denom = totalUsdSpent + promptUsdSaved;
    const savingsPercent = denom > 0 ? (promptUsdSaved / denom) * 100 : 0;

    return {
      period: { from, to },
      semantic: {
        hits: semanticHits,
        creditsSaved: semanticCreditsSaved,
      },
      promptCache: {
        cachedTokens: promptCachedTokens,
        estimatedUsdSaved: promptUsdSaved,
        byProvider,
      },
      summary: {
        totalUsdSpent,
        promptCacheUsdSaved: promptUsdSaved,
        semanticCreditsSaved,
        savingsPercent,
      },
    };
  },

  async getLiveMetrics() {
    return liveMetricsService.getSnapshot();
  },

  async getUserSummary(userId: string, periodStart: string, periodEnd: string) {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT
        COUNT(*)::int AS requests,
        COALESCE(SUM(ur.total_tokens), 0)::int AS total_tokens,
        COALESCE(SUM(ur.credits_deducted), 0)::int AS credits_used,
        COALESCE(SUM(COALESCE(ur.actual_cost_usd, ac.cost_usd_billed_to_us)), 0)::numeric AS cost_usd,
        COALESCE(SUM(ur.input_tokens_fresh), 0)::int AS input_tokens_fresh,
        COALESCE(SUM(ur.input_tokens_cached), 0)::int AS input_tokens_cached,
        COALESCE(SUM(ur.cache_write_tokens), 0)::int AS cache_write_tokens
      FROM usage_records ur
      LEFT JOIN api_calls ac ON ac.request_id::text = ur.request_id
      WHERE ur.user_id = $1::uuid
        AND ur.created_at >= $2::date
        AND ur.created_at < ($3::date + interval '1 day')
    `,
      [userId, periodStart, periodEnd],
    );
    return res.rows[0] ?? { requests: 0, total_tokens: 0, credits_used: 0, cost_usd: 0, input_tokens_fresh: 0, input_tokens_cached: 0, cache_write_tokens: 0 };
  },

  async getUserHistory(userId: string, days: number) {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT
        date_trunc('day', ur.created_at)::date AS day,
        COUNT(*)::int AS request_count,
        COALESCE(SUM(ur.total_tokens), 0)::int AS total_tokens,
        COALESCE(SUM(ur.credits_deducted), 0)::int AS credits_deducted,
        COALESCE(SUM(COALESCE(ur.actual_cost_usd, ac.cost_usd_billed_to_us)), 0)::numeric AS cost_usd,
        COALESCE(SUM(ur.input_tokens_fresh), 0)::int AS input_tokens_fresh,
        COALESCE(SUM(ur.input_tokens_cached), 0)::int AS input_tokens_cached,
        COALESCE(SUM(ur.cache_write_tokens), 0)::int AS cache_write_tokens
      FROM usage_records ur
      LEFT JOIN api_calls ac ON ac.request_id::text = ur.request_id
      WHERE ur.user_id = $1::uuid
        AND ur.created_at >= current_date - $2::int
      GROUP BY date_trunc('day', ur.created_at)::date
      ORDER BY day ASC
    `,
      [userId, days],
    );
    return res.rows;
  },

  async getOverview(from?: string, to?: string) {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT
        COALESCE(SUM(request_count), 0)::int AS requests,
        COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
        COALESCE(SUM(credits_deducted), 0)::int AS credits_deducted,
        COALESCE(SUM(error_count), 0)::int AS error_count,
        COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
      FROM usage_hourly_system
      WHERE ($1::timestamptz IS NULL OR hour >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR hour <= $2::timestamptz)
    `,
      [from ?? null, to ?? null],
    );
    return res.rows[0];
  },

  async getTopUsers(sort: string, limit: number) {
    const pool = getPool();
    const order = sort === "credits_desc" ? "credits DESC" : "requests DESC";
    const res = await pool.query(
      `
      SELECT
        udu.user_id,
        u.email AS user_email,
        COALESCE(SUM(udu.request_count), 0)::int AS requests,
        COALESCE(SUM(udu.credits_deducted), 0)::int AS credits
      FROM usage_daily_user udu
      JOIN users u ON u.id = udu.user_id
      WHERE udu.day >= current_date - interval '30 days'
      GROUP BY udu.user_id, u.email
      ORDER BY ${order}
      LIMIT $1
    `,
      [limit],
    );
    return res.rows;
  },

  async getModelDistribution() {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT model_id, COUNT(*)::int AS requests, COALESCE(SUM(total_tokens), 0)::int AS total_tokens
      FROM usage_records
      WHERE created_at >= now() - interval '30 days'
      GROUP BY model_id
      ORDER BY requests DESC
    `,
    );
    return res.rows;
  },

  async getCosts(from?: string, to?: string) {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT
        day,
        COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd,
        COALESCE(SUM(credits_deducted), 0)::int AS credits_deducted
      FROM usage_daily_plan
      WHERE ($1::date IS NULL OR day >= $1::date)
        AND ($2::date IS NULL OR day <= $2::date)
      GROUP BY day
      ORDER BY day ASC
    `,
      [from ?? null, to ?? null],
    );
    return res.rows;
  },

  async getCostsOverview() {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT
        COALESCE(SUM(cost_usd_billed_to_us) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day'), 0)::numeric AS today_usd,
        COALESCE(SUM(credits_charged_to_user) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day'), 0)::numeric AS today_credits,
        COALESCE(SUM(cost_usd_billed_to_us) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::numeric AS week_usd,
        COALESCE(SUM(credits_charged_to_user) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::numeric AS week_credits,
        COALESCE(SUM(cost_usd_billed_to_us) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::numeric AS month_usd,
        COALESCE(SUM(credits_charged_to_user) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::numeric AS month_credits,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS today_calls
      FROM api_calls
    `,
    );
    return res.rows[0] ?? {};
  },

  async getCostsByModel() {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT model, provider,
        COUNT(*)::int AS call_count,
        COALESCE(SUM(input_fresh + input_cached + output), 0)::int AS total_tokens,
        COALESCE(SUM(cost_usd_billed_to_us), 0)::numeric AS total_usd
      FROM api_calls
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY model, provider
      ORDER BY total_usd DESC
    `,
    );
    return res.rows;
  },

  async getCostsByAgent() {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT agent_slug,
        COUNT(*)::int AS call_count,
        COALESCE(SUM(cost_usd_billed_to_us), 0)::numeric AS total_usd,
        COALESCE(SUM(credits_charged_to_user), 0)::numeric AS total_credits,
        COALESCE(AVG(latency_ms), 0)::numeric AS avg_latency_ms
      FROM api_calls
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY agent_slug
      ORDER BY total_usd DESC
    `,
    );
    return res.rows;
  },

  async getErrors(from?: string, to?: string) {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT error_code, COUNT(*)::int AS count
      FROM usage_records
      WHERE status IN ('failed', 'error', 'timeout')
        AND ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR created_at <= $2::timestamptz)
      GROUP BY error_code
      ORDER BY count DESC
    `,
      [from ?? null, to ?? null],
    );
    return res.rows;
  },

  async getRatelimits(from?: string, to?: string) {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT event_type, COUNT(*)::int AS count
      FROM rate_limit_events
      WHERE ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR created_at <= $2::timestamptz)
      GROUP BY event_type
      ORDER BY count DESC
    `,
      [from ?? null, to ?? null],
    );
    return res.rows;
  },
};
