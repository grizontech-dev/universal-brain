import { describe, expect, it } from "vitest";

import { deriveToolInvocationMode } from "../../../src/utils/toolInvocationMode.js";

describe("deriveToolInvocationMode", () => {
  it("returns tavily/brave/none for web_search from response_output.engine", () => {
    expect(
      deriveToolInvocationMode({
        tool_name: "web_search",
        response_output: { engine: "tavily", results: [] },
      }),
    ).toBe("tavily");
    expect(
      deriveToolInvocationMode({
        tool_name: "web_search",
        response_output: { engine: "brave", results: [{ url: "x" }] },
      }),
    ).toBe("brave");
    expect(
      deriveToolInvocationMode({
        tool_name: "web_search",
        response_output: { engine: "none", results: [] },
      }),
    ).toBe("none");
  });

  it("returns null for web_search when engine missing or invalid", () => {
    expect(
      deriveToolInvocationMode({
        tool_name: "web_search",
        response_output: { results: [] },
      }),
    ).toBeNull();
    expect(
      deriveToolInvocationMode({
        tool_name: "web_search",
        response_output: { engine: "bing" },
      }),
    ).toBeNull();
    expect(
      deriveToolInvocationMode({
        tool_name: "web_search",
        response_output: null,
      }),
    ).toBeNull();
  });

  it("uses mode, provider, or source for other tools", () => {
    expect(
      deriveToolInvocationMode({
        tool_name: "get_weather",
        response_output: { mode: "forecast" },
      }),
    ).toBe("forecast");
    expect(
      deriveToolInvocationMode({
        tool_name: "stock_data",
        response_output: { provider: "polygon" },
      }),
    ).toBe("polygon");
    expect(
      deriveToolInvocationMode({
        tool_name: "web_fetch",
        response_output: { source: "direct" },
      }),
    ).toBe("direct");
  });

  it("returns null when no known keys", () => {
    expect(
      deriveToolInvocationMode({
        tool_name: "file_read",
        response_output: { path: "/x" },
      }),
    ).toBeNull();
  });
});
