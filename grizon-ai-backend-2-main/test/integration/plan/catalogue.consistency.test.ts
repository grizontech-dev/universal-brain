import { describe, expect, it } from "vitest";

import { AGENT_CATALOGUE } from "../../../src/agents/index.js";
import { MODEL_CATALOGUE } from "../../../src/router/catalogue.js";

describe("plan vs catalogue consistency (static)", () => {
  it("exposes ten agents including mandatory chat and deep_research", () => {
    expect(Object.keys(AGENT_CATALOGUE).length).toBe(10);
    expect(AGENT_CATALOGUE.chat).toBeDefined();
    expect(AGENT_CATALOGUE.deep_research).toBeDefined();
  });

  it("lists thirteen models in the static catalogue", () => {
    expect(MODEL_CATALOGUE.length).toBe(13);
  });
});
