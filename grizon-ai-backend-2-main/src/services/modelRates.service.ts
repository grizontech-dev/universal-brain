import { getPool } from "../db/pool.js";

/** Per-1K-token rates for a model, read from ai_models. */
export interface ModelRates {
  inputRate: number;
  inputCachedRate: number;
  outputRate: number;
}

export const ZERO_RATES: ModelRates = { inputRate: 0, inputCachedRate: 0, outputRate: 0 };

// TTL-bounded cache so refreshed ai_models prices take effect without a worker
// restart (plan §4.4 — fixes the old no-TTL modelRateCache).
const RATE_TTL_MS = 60_000;
const cache = new Map<string, { rates: ModelRates; at: number }>();

/** Fetch (and cache, with TTL) the per-1K rates for a model id. */
export async function getModelRates(modelId: string): Promise<ModelRates> {
  if (!modelId) return ZERO_RATES;
  const now = Date.now();
  const hit = cache.get(modelId);
  if (hit && now - hit.at < RATE_TTL_MS) return hit.rates;

  const pool = getPool();
  const res = await pool.query(
    `SELECT input_cost_per_1k, input_cached_cost_per_1k, output_cost_per_1k
       FROM ai_models WHERE model_id = $1 LIMIT 1`,
    [modelId],
  );
  const row = res.rows[0] as
    | {
        input_cost_per_1k?: string | number;
        input_cached_cost_per_1k?: string | number;
        output_cost_per_1k?: string | number;
      }
    | undefined;
  const rates: ModelRates = {
    inputRate: Number(row?.input_cost_per_1k ?? 0),
    inputCachedRate: Number(row?.input_cached_cost_per_1k ?? 0),
    outputRate: Number(row?.output_cost_per_1k ?? 0),
  };
  cache.set(modelId, { rates, at: now });
  return rates;
}

/**
 * Resolve the model an agent will most likely run on: the highest-priority
 * active entry in agent_model_priorities, else default_model_id, else
 * direct_model_id. Used by estimate paths that don't yet know the resolved model.
 */
export async function resolveAgentPrimaryModel(agentSlug: string): Promise<string | null> {
  if (!agentSlug) return null;
  const pool = getPool();
  const res = await pool.query(
    `SELECT COALESCE(
        (SELECT amp.model_id FROM agent_model_priorities amp
           WHERE amp.agent_id = a.id AND amp.is_active = true
           ORDER BY amp.priority ASC LIMIT 1),
        a.default_model_id,
        a.direct_model_id
     ) AS model_id
     FROM agents a WHERE a.slug = $1 AND a.is_active = true LIMIT 1`,
    [agentSlug],
  );
  return (res.rows[0]?.model_id as string | undefined) ?? null;
}

/** Convenience: resolve an agent's primary model and return its rates. */
export async function getAgentPrimaryRates(agentSlug: string): Promise<ModelRates> {
  const modelId = await resolveAgentPrimaryModel(agentSlug);
  if (!modelId) return ZERO_RATES;
  return getModelRates(modelId);
}
