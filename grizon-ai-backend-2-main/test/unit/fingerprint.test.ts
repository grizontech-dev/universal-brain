import { describe, expect, it } from "vitest";

import { fingerprintFromParts } from "../../src/utils/fingerprint.js";

describe("fingerprintFromParts", () => {
  it("is deterministic and 32 hex chars", () => {
    const fp1 = fingerprintFromParts({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0",
      ip: "203.0.113.42",
      acceptLanguage: "en-US,en;q=0.9",
    });
    const fp2 = fingerprintFromParts({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124.0",
      ip: "203.0.113.42",
      acceptLanguage: "en-US,en;q=0.9",
    });

    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(32);
    expect(fp1).toMatch(/^[a-f0-9]{32}$/);
  });
});

