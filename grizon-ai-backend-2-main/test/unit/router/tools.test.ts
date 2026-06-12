import { describe, expect, it } from "vitest";

import { resolveAllowedTools } from "../../../src/router/tools.js";
import { AGENT_CATALOGUE } from "../../../src/agents/index.js";
import type { ClassificationResult } from "../../../src/types/router.js";
import type { Plan } from "../../../src/types/plan.js";

const classification = (partial: Partial<ClassificationResult>): ClassificationResult => ({
  intent: "chat",
  complexity: "medium",
  needsWebSearch: false,
  needsCodeExecution: false,
  needsFileRead: false,
  needsFileGen: [],
  searchContextSize: "low",
  suggestedAgent: "chat",
  confidence: 1,
  classifierSource: "heuristic",
  ...partial,
});

describe("resolveAllowedTools", () => {
  it("enables web_search only when flag and classifier agree", () => {
    const plan = {
      featureFlags: { webSearch: true },
    } as Plan;
    const cls = classification({ needsWebSearch: true });
    const tools = resolveAllowedTools(cls, AGENT_CATALOGUE.research, plan, "auto");
    expect(tools).toContain("web_search");
  });

  it("does not enable web_search when feature flag is off", () => {
    const plan = {
      featureFlags: { webSearch: false },
    } as Plan;
    const cls = classification({ needsWebSearch: true });
    const tools = resolveAllowedTools(cls, AGENT_CATALOGUE.research, plan, "auto");
    expect(tools).not.toContain("web_search");
  });
});
