import { getPool } from "../db/pool.js";

export async function runUsageRollupOnce() {
  const pool = getPool();

  await pool.query(
    `
    INSERT INTO usage_daily_user (
      user_id, day, request_count, input_tokens, output_tokens, total_tokens, credits_deducted, error_count, cost_usd, updated_at
    )
    SELECT
      ur.user_id,
      date_trunc('day', ur.created_at)::date AS day,
      COUNT(*)::int,
      COALESCE(SUM(ur.input_tokens), 0)::int,
      COALESCE(SUM(ur.output_tokens), 0)::int,
      COALESCE(SUM(ur.total_tokens), 0)::int,
      COALESCE(SUM(ur.credits_deducted), 0)::int,
      COALESCE(SUM(CASE WHEN ur.status = 'error' THEN 1 ELSE 0 END), 0)::int,
      COALESCE(SUM(ur.actual_cost_usd), 0)::numeric,
      now()
    FROM usage_records ur
    WHERE ur.created_at >= now() - interval '2 days'
    GROUP BY ur.user_id, date_trunc('day', ur.created_at)::date
    ON CONFLICT (user_id, day) DO UPDATE SET
      request_count = EXCLUDED.request_count,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      credits_deducted = EXCLUDED.credits_deducted,
      error_count = EXCLUDED.error_count,
      cost_usd = EXCLUDED.cost_usd,
      updated_at = now()
  `,
  );

  await pool.query(
    `
    INSERT INTO usage_daily_plan (
      plan_id, day, request_count, input_tokens, output_tokens, total_tokens, credits_deducted, error_count, cost_usd, updated_at
    )
    SELECT
      s.plan_id,
      date_trunc('day', ur.created_at)::date AS day,
      COUNT(*)::int,
      COALESCE(SUM(ur.input_tokens), 0)::int,
      COALESCE(SUM(ur.output_tokens), 0)::int,
      COALESCE(SUM(ur.total_tokens), 0)::int,
      COALESCE(SUM(ur.credits_deducted), 0)::int,
      COALESCE(SUM(CASE WHEN ur.status = 'error' THEN 1 ELSE 0 END), 0)::int,
      COALESCE(SUM(ur.actual_cost_usd), 0)::numeric,
      now()
    FROM usage_records ur
    JOIN subscriptions s ON s.user_id = ur.user_id AND s.status = 'active'
    WHERE ur.created_at >= now() - interval '2 days'
    GROUP BY s.plan_id, date_trunc('day', ur.created_at)::date
    ON CONFLICT (plan_id, day) DO UPDATE SET
      request_count = EXCLUDED.request_count,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      credits_deducted = EXCLUDED.credits_deducted,
      error_count = EXCLUDED.error_count,
      cost_usd = EXCLUDED.cost_usd,
      updated_at = now()
  `,
  );

  await pool.query(
    `
    INSERT INTO usage_hourly_system (
      hour, request_count, input_tokens, output_tokens, total_tokens, credits_deducted, error_count, cost_usd, updated_at
    )
    SELECT
      date_trunc('hour', ur.created_at) AS hour,
      COUNT(*)::int,
      COALESCE(SUM(ur.input_tokens), 0)::int,
      COALESCE(SUM(ur.output_tokens), 0)::int,
      COALESCE(SUM(ur.total_tokens), 0)::int,
      COALESCE(SUM(ur.credits_deducted), 0)::int,
      COALESCE(SUM(CASE WHEN ur.status = 'error' THEN 1 ELSE 0 END), 0)::int,
      COALESCE(SUM(ur.actual_cost_usd), 0)::numeric,
      now()
    FROM usage_records ur
    WHERE ur.created_at >= now() - interval '48 hours'
    GROUP BY date_trunc('hour', ur.created_at)
    ON CONFLICT (hour) DO UPDATE SET
      request_count = EXCLUDED.request_count,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      credits_deducted = EXCLUDED.credits_deducted,
      error_count = EXCLUDED.error_count,
      cost_usd = EXCLUDED.cost_usd,
      updated_at = now()
  `,
  );
}
