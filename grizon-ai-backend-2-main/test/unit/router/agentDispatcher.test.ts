import { describe, expect, it, vi } from "vitest";

import type { Plan } from "../../../src/types/plan.js";
import type { AgentDescriptor, ClassificationResult } from "../../../src/types/router.js";

// pickAgent reads agents from the DB-backed cache via getAgentDescriptor, which
// is empty in unit tests. Mock it with deterministic fixtures so we can assert
// the Auto-Mode routing rules (intent map + is_auto_eligible + fallback ladder).
const desc = (
  slug: string,
  isAutoEligible: boolean,
  fallbackAgent: string | null,
): AgentDescriptor =>
  ({
    slug,
    displayName: slug,
    description: "",
    systemPrompt: "",
    allowedTools: [],
    modelPriority: [],
    fallbackAgent,
    costMultiplier: 1,
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: null,
    isSystem: false,
    isAutoEligible,
  }) as AgentDescriptor;

const FIXTURES: Record<string, AgentDescriptor> = {
  general: desc("general", true, null),
  research: desc("research", true, "general"),
  code: desc("code", true, "general"),
  debugger: desc("debugger", true, "code"),
  writer: desc("writer", true, "general"),
  analyst: desc("analyst", true, "general"),
  document: desc("document", true, "general"),
  // manual-only specialists (not auto-eligible)
  architect: desc("architect", false, "code"),
  "deep-research": desc("deep-research", false, "research"),
  ui: desc("ui", false, "code"),
  math: desc("math", false, "general"),
  "fact-check": desc("fact-check", false, "research"),
  // direct model agent (never auto)
  claude: desc("claude", false, "general"),
};

vi.mock("../../../src/services/agentLoader.service.js", () => ({
  getAgentDescriptor: (slug: string) => FIXTURES[slug],
}));

// Dynamic import so FIXTURES is initialised before the mocked module loads.
const { pickAgent } = await import("../../../src/router/agentDispatcher.js");

const complexSearchClassification = (): ClassificationResult => ({
  intent: "search",
  complexity: "complex",
  needsWebSearch: true,
  needsCodeExecution: false,
  needsFileRead: false,
  needsFileGen: [],
  searchContextSize: "medium",
  suggestedAgent: "research",
  confidence: 0.9,
  classifierSource: "heuristic",
});

const planWith = (agentAccess: string[]): Plan =>
  ({
    id: "p1",
    name: "Test",
    slug: "test",
    status: "active",
    isPublic: true,
    isIntroductory: false,
    pricing: { monthly: 0, annual: 0, currency: "inr" },
    credits: { included: 100, rollover: false, maxRollover: null, topupEnabled: false, topupPackages: [] },
    limits: {
      hourly: 100, daily: 1000, weekly: 5000, monthly: 20000,
      maxContextMessages: 24, maxFileSize: 10_000_000, maxFilesPerChat: 5, maxArtifactVersions: 5,
    },
    modelAccess: [],
    agentAccess,
    featureFlags: {},
    createdAt: new Date().toISOString(),
    archivedAt: null,
  }) as Plan;

const FULL = ["general", "research", "writer", "code", "document", "analyst", "debugger"];

describe("agentDispatcher.pickAgent (Auto Mode)", () => {
  it("maps chat intent to general (the universal fallback)", () => {
    expect(pickAgent("chat", planWith(FULL)).slug).toBe("general");
  });

  it("maps search intent to research when auto-eligible and in plan", () => {
    expect(pickAgent("search", planWith(FULL)).slug).toBe("research");
  });

  it("falls back to general when the mapped agent is not in plan", () => {
    expect(pickAgent("search", planWith(["general"])).slug).toBe("general");
  });

  it("never routes to a non-auto-eligible specialist: design -> architect -> code", () => {
    // architect is not auto-eligible, so Auto walks its fallback to code.
    expect(pickAgent("design", planWith(FULL)).slug).toBe("code");
  });

  it("ui (not auto-eligible) falls through to code in Auto", () => {
    expect(pickAgent("ui", planWith(FULL)).slug).toBe("code");
  });

  it("math (not auto-eligible) falls through to general", () => {
    expect(pickAgent("math", planWith(FULL)).slug).toBe("general");
  });

  it("fact (not auto-eligible) falls through to research", () => {
    expect(pickAgent("fact", planWith(FULL)).slug).toBe("research");
  });

  it("does NOT escalate complex search to deep-research (escalation removed)", () => {
    const plan = planWith([...FULL, "deep-research"]);
    expect(pickAgent("search", plan, complexSearchClassification()).slug).toBe("research");
  });
});
