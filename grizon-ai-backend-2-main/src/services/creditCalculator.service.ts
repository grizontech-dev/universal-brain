import { agentMultiplierFor } from "../config/credits.js";
import type { ModelRates } from "./modelRates.service.js";

export const creditCalculator = {
  multiplierFor(agentSlug: string): number {
    return agentMultiplierFor(agentSlug);
  },

  /**
   * Single billing formula (plan §4.3):
   *
   *   rawCost    = (inputFresh/1k)·inputRate + (inputCached/1k)·inputCachedRate
   *              + (output/1k)·outputRate          // per-1k rates from ai_models
   *   billedCost = ceil(rawCost × agents.cost_multiplier)
   *
   * `cost_multiplier` is the ONLY multiplier — no planDiscount, no per-model
   * credit-rate map.
   */
  calculateCost(args: {
    inputFreshTokens: number;
    inputCachedTokens: number;
    outputTokens: number;
    rates: ModelRates;
    agentSlug: string;
  }): number {
    const inFresh = Math.max(0, args.inputFreshTokens);
    const inCached = Math.max(0, args.inputCachedTokens);
    const out = Math.max(0, args.outputTokens);

    const rawCost =
      (inFresh / 1000) * args.rates.inputRate +
      (inCached / 1000) * args.rates.inputCachedRate +
      (out / 1000) * args.rates.outputRate;

    const multiplier = agentMultiplierFor(args.agentSlug);
    return Math.ceil(rawCost * multiplier);
  },
};
