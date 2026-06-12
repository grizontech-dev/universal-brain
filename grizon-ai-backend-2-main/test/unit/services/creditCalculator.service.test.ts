import { describe, expect, it } from "vitest";

import { creditCalculator } from "../../../src/services/creditCalculator.service.js";

// agentMultiplierFor() reads from the live agent cache, which is empty in unit
// tests, so the multiplier defaults to 1.0 for any slug below.
describe("creditCalculator.service (unit)", () => {
  it("returns zero for zero tokens", () => {
    const cost = creditCalculator.calculateCost({
      inputFreshTokens: 0,
      inputCachedTokens: 0,
      outputTokens: 0,
      rates: { inputRate: 0.00014, inputCachedRate: 0.0000028, outputRate: 0.00028 },
      agentSlug: "general",
    });
    expect(cost).toBe(0);
  });

  it("bills rate-aware rawCost with ceiling (cheap model -> 1 credit)", () => {
    // general on deepseek-v4-flash, 1000 fresh in / 500 out:
    // rawCost = 1*0.00014 + 0.5*0.00028 = 0.00028 -> ceil = 1
    const cost = creditCalculator.calculateCost({
      inputFreshTokens: 1000,
      inputCachedTokens: 0,
      outputTokens: 500,
      rates: { inputRate: 0.00014, inputCachedRate: 0.0000028, outputRate: 0.00028 },
      agentSlug: "general",
    });
    expect(cost).toBe(1);
  });

  it("scales with expensive models and large token counts", () => {
    // 100k fresh in / 50k out on opus-class rates:
    // rawCost = 100*0.005 + 50*0.025 = 0.5 + 1.25 = 1.75 -> ceil = 2
    const cost = creditCalculator.calculateCost({
      inputFreshTokens: 100_000,
      inputCachedTokens: 0,
      outputTokens: 50_000,
      rates: { inputRate: 0.005, inputCachedRate: 0.0005, outputRate: 0.025 },
      agentSlug: "claude",
    });
    expect(cost).toBe(2);
  });

  it("applies the cheaper cached-input rate to cached tokens", () => {
    // 10k cached in only, cached rate 0.0000028 -> rawCost ~ 0.000028 -> ceil = 1
    const cost = creditCalculator.calculateCost({
      inputFreshTokens: 0,
      inputCachedTokens: 10_000,
      outputTokens: 0,
      rates: { inputRate: 0.00014, inputCachedRate: 0.0000028, outputRate: 0.00028 },
      agentSlug: "general",
    });
    expect(cost).toBe(1);
  });
});
