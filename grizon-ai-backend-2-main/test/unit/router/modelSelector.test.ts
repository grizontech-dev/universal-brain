import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/router/catalogue.js", () => ({
  activeModelCatalogue: vi.fn(() => [
    {
      id: "gpt-4o-mini",
      provider: "openai",
      tier: "nano",
      contextWindow: 128_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsPromptCache: true,
      supportsVision: true,
      active: true,
    },
    {
      id: "claude-haiku-4-5",
      provider: "anthropic",
      tier: "nano",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsPromptCache: true,
      supportsVision: true,
      active: true,
    },
  ]),
}));

vi.mock("../../../src/router/providerHealth.js", () => ({
  providerHealth: {
    snapshot: vi.fn(async () => new Map()),
    isOpen: vi.fn(async () => false),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  },
}));

import type { Plan } from "../../../src/types/plan.js";

const planWithModels = (ids: string[]): Plan =>
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
      hourly: 100,
      daily: 1000,
      weekly: 5000,
      monthly: 20000,
      maxContextMessages: 24,
      maxFileSize: 10_000_000,
      maxFilesPerChat: 5,
      maxArtifactVersions: 5,
    },
    modelAccess: ids,
    agentAccess: ["chat"],
    featureFlags: {},
    createdAt: new Date().toISOString(),
    archivedAt: null,
  }) as Plan;

describe("modelSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns model from agent DB configuration", async () => {
    const { selectModel } = await import("../../../src/router/modelSelector.js");
    const plan = planWithModels(["gpt-4o-mini", "claude-haiku-4-5"]);
    const out = await selectModel("nano", plan, {
      toolsRequired: false,
      agentSlug: "chat",
    });
    expect(out.primary.id).toBeTruthy();
  });

  it("requires agentSlug for model selection", async () => {
    const { selectModel } = await import("../../../src/router/modelSelector.js");
    const plan = planWithModels(["gpt-4o-mini", "claude-haiku-4-5"]);
    await expect(selectModel("nano", plan, { toolsRequired: false })).rejects.toThrow();
  });
});
