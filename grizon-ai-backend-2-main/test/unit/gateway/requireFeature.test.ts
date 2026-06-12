import { describe, expect, it, vi } from "vitest";

import { requireFeature } from "../../../src/gateway/requireFeature.js";

describe("requireFeature (unit)", () => {
  it("returns internal error when req.plan is missing", () => {
    const next = vi.fn();
    const middleware = requireFeature("webSearch");
    middleware({} as any, {} as any, next);
    const error = next.mock.calls[0][0];
    expect(error.code).toBe("INTERNAL_ERROR");
  });

  it("returns feature-not-available when flag is off", () => {
    const next = vi.fn();
    const middleware = requireFeature("webSearch");
    middleware(
      {
        plan: { featureFlags: { webSearch: false } },
      } as any,
      {} as any,
      next,
    );
    const error = next.mock.calls[0][0];
    expect(error.code).toBe("FEATURE_NOT_AVAILABLE");
  });

  it("calls next with no error when flag is enabled", () => {
    const next = vi.fn();
    const middleware = requireFeature("webSearch");
    middleware(
      {
        plan: { featureFlags: { webSearch: true } },
      } as any,
      {} as any,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});
