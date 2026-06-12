// AGENT_SLUG_TO_MULTIPLIER_KEY and AGENT_MULTIPLIERS removed.
// Cost multipliers are now stored in agents.cost_multiplier (DB) and loaded
// into AgentDescriptor.costMultiplier by agentLoader.service.ts.
// agentMultiplierFor() reads from the live cache via getAgentDescriptor().
//
// The stale MODEL_CREDIT_RATES map / modelRateFor() were removed (plan §4.3):
// per-token pricing now comes from ai_models.*_cost_per_1k via
// services/modelRates.service.ts, and cost_multiplier is the only multiplier.

import { getAgentDescriptor } from "../services/agentLoader.service.js";

export const ESTIMATE_OUTPUT_RATIO = 3;

export function agentMultiplierFor(agentSlug: string): number {
  return getAgentDescriptor(agentSlug)?.costMultiplier ?? 1.0;
}
