import { getPool } from "../db/pool.js";
import { providerHealth } from "./providerHealth.js";
import { Errors } from "../utils/errors.js";
import type { Plan } from "../types/plan.js";
import type { ModelDescriptor, ProviderHealth, ProviderId } from "../types/router.js";

function healthRank(provider: ProviderId, healthMap: Map<ProviderId, ProviderHealth>): number {
  const h = healthMap.get(provider);
  if (!h || h.state === "disabled") return 99;
  if (h.state === "closed") return 0;
  if (h.state === "half_open") return 1;
  if (h.state === "open") return 3;
  return 2;
}

function dedupeProviders(models: ModelDescriptor[]): ModelDescriptor[] {
  const seen = new Set<ProviderId>();
  const out: ModelDescriptor[] = [];
  for (const m of models) {
    if (seen.has(m.provider)) continue;
    seen.add(m.provider);
    out.push(m);
  }
  return out;
}

export interface SelectModelOptions {
  forceModelId?: string | null;
  toolsRequired?: boolean;
  agentSlug?: string;
}

export async function selectModel(
  tier: ModelDescriptor["tier"],
  plan: Plan,
  options: SelectModelOptions = {},
): Promise<{ primary: ModelDescriptor; fallbackChain: ModelDescriptor[] }> {
  if (!options.agentSlug) {
    throw Errors.modelNotAllowed({ planId: plan.id, tier: "Agent configuration required" });
  }

  const dbResolved = await resolveModelFromDB(options.agentSlug, {
    toolsRequired: Boolean(options.toolsRequired),
    forceModelId: options.forceModelId ?? null,
  });
  if (dbResolved) {
    return dbResolved;
  }

  // Agent exists but has no model priorities configured — fall back to any active standard model.
  const fallback = await resolveDefaultModel(Boolean(options.toolsRequired));
  if (fallback) {
    return fallback;
  }

  throw Errors.modelNotAllowed({
    planId: plan.id,
    agentSlug: options.agentSlug,
  });
}

async function resolveModelFromDB(
  agentSlug: string,
  options: { toolsRequired: boolean; forceModelId: string | null },
): Promise<{ primary: ModelDescriptor; fallbackChain: ModelDescriptor[] } | null> {
  const pool = getPool();
  const agentRes = await pool.query(
    `SELECT id, agent_type, direct_model_id FROM agents WHERE slug = $1 AND is_active = true LIMIT 1`,
    [agentSlug],
  );
  if (!agentRes.rowCount) return null;
  const agent = agentRes.rows[0] as {
    id: string;
    agent_type: "specialized" | "direct";
    direct_model_id: string | null;
  };

  if (options.forceModelId) {
    const forced = await mapModelRows([options.forceModelId], options.toolsRequired);
    return forced ? { primary: forced[0], fallbackChain: [] } : null;
  }

  if (agent.agent_type === "direct") {
    if (!agent.direct_model_id) return null;
    const single = await mapModelRows([agent.direct_model_id], options.toolsRequired);
    return single ? { primary: single[0], fallbackChain: [] } : null;
  }

  const priRes = await pool.query(
    `
      SELECT amp.model_id
      FROM agent_model_priorities amp
      WHERE amp.agent_id = $1 AND amp.is_active = true
      ORDER BY amp.priority ASC
    `,
    [agent.id],
  );
  const orderedModelIds = (priRes.rows as Array<{ model_id: string }>).map((r) => r.model_id);
  if (!orderedModelIds.length) return null;
  const mapped = await mapModelRows(orderedModelIds, options.toolsRequired);
  if (!mapped || !mapped.length) return null;
  return { primary: mapped[0], fallbackChain: mapped.slice(1, 4) };
}

async function resolveDefaultModel(toolsRequired: boolean): Promise<{ primary: ModelDescriptor; fallbackChain: ModelDescriptor[] } | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT model_id, provider, tier, context_window, capabilities, is_active, health_status
     FROM ai_models
     WHERE is_active = true AND tier = 'standard'
     ORDER BY model_id
     LIMIT 5`,
  );
  if (!res.rowCount) return null;
  const healthMap = await providerHealth.snapshot();
  const mapped = (res.rows as Array<Record<string, unknown>>)
    .map((row) => toModelDescriptor(row))
    .filter((m): m is ModelDescriptor => m !== null)
    .filter((m) => m.active)
    .filter((m) => !toolsRequired || m.supportsTools)
    .filter((m) => healthRank(m.provider, healthMap) < 3);
  if (!mapped.length) return null;
  const deduped = dedupeProviders(mapped);
  return { primary: deduped[0], fallbackChain: deduped.slice(1, 4) };
}

async function mapModelRows(modelIds: string[], toolsRequired: boolean): Promise<ModelDescriptor[] | null> {
  const pool = getPool();
  const res = await pool.query(
    `
      SELECT model_id, provider, tier, context_window, capabilities, is_active, health_status
      FROM ai_models
      WHERE model_id = ANY($1::text[])
      ORDER BY array_position($1::text[], model_id)
    `,
    [modelIds],
  );
  if (!res.rowCount) return null;

  const healthMap = await providerHealth.snapshot();
  const mapped = (res.rows as Array<Record<string, unknown>>)
    .map((row) => toModelDescriptor(row))
    .filter((m): m is ModelDescriptor => m !== null)
    .filter((m) => m.active)
    .filter((m) => !toolsRequired || m.supportsTools)
    .filter((m) => healthRank(m.provider, healthMap) < 3);

  if (!mapped.length) return null;
  return dedupeProviders(mapped);
}

function toModelDescriptor(row: Record<string, unknown>): ModelDescriptor | null {
  const provider = String(row.provider ?? "") as ProviderId;
  if (!provider || !["anthropic", "openai", "google", "xai", "deepseek"].includes(provider)) return null;
  const tier = String(row.tier ?? "standard") as ModelDescriptor["tier"];
  const capabilities = Array.isArray(row.capabilities) ? row.capabilities.map(String) : [];
  return {
    id: String(row.model_id),
    provider,
    tier: ["nano", "standard", "premium", "frontier", "reasoning"].includes(tier) ? tier : "standard",
    contextWindow: Number(row.context_window ?? 80000),
    supportsTools: capabilities.includes("tools"),
    supportsStreaming: true,
    supportsPromptCache: capabilities.includes("prompt_cache"),
    supportsVision: capabilities.includes("vision"),
    active: Boolean(row.is_active),
  };
}

