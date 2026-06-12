import { describe, expect, it } from "vitest";

import { providerHealth } from "../../../src/router/providerHealth.js";

describe("providerHealth", () => {
  it("snapshot returns null-like gracefully when Redis is unavailable", async () => {
    const h = await providerHealth.snapshotOne("openai");
    expect(h === null || h.state === "closed").toBe(true);
  });
});
