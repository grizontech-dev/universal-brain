import { describe, expect, it } from "vitest";

import { streamTimeoutsForPlan } from "../../../src/config/streamLimits.js";
import type { Plan } from "../../../src/types/plan.js";

function mkPlan(limits: Partial<Plan["limits"]>, slug = "free"): Plan {
  return {
    id: "p1",
    name: "Plan",
    slug,
    status: "active",
    isPublic: true,
    isIntroductory: false,
    pricing: { monthly: 0, annual: 0, currency: "inr" },
    credits: { included: 0, rollover: false, maxRollover: null, topupEnabled: false, topupPackages: [] },
    limits: {
      hourly: 1,
      daily: 1,
      weekly: 1,
      monthly: 1,
      maxContextMessages: 20,
      maxFileSize: 1,
      maxFilesPerChat: 1,
      maxArtifactVersions: 1,
      ...limits,
    },
    agentAccess: [],
    featureFlags: {},
    createdAt: "",
    archivedAt: null,
    createdBy: "",
  };
}

describe("streamTimeoutsForPlan", () => {
  it("returns post-first-chunk defaults by plan slug", () => {
    const out = streamTimeoutsForPlan(mkPlan({}, "free"));
    expect(out.streamTimeoutMs).toBe(60000);
    expect(out.streamInactivityTimeoutMs).toBe(20000);
    expect(out.streamPostFirstChunkTimeoutMs).toBe(180000);
  });

  it("respects explicit plan override for post-first-chunk timeout", () => {
    const out = streamTimeoutsForPlan(mkPlan({ streamPostFirstChunkTimeoutMs: 222000 }, "starter"));
    expect(out.streamPostFirstChunkTimeoutMs).toBe(222000);
  });
});
