import { describe, expect, it } from "vitest";

import { heuristicClassifier } from "../../../src/router/classifier.js";

describe("router classifier (heuristic)", () => {
  it("classifies very short prompts as chat/simple", () => {
    const r = heuristicClassifier("Hi", 0, 1);
    expect(r?.intent).toBe("chat");
    expect(r?.complexity).toBe("simple");
    expect(r?.classifierSource).toBe("heuristic");
  });

  it("detects debug intent from stack trace wording", () => {
    const msg =
      "TypeError: undefined is not a function\n    at foo\n    at bar\n    at baz\n" +
      "Something failed after multiple attempts with exception trace.";
    const r = heuristicClassifier(msg, 0, 10);
    expect(r?.intent).toBe("debug");
  });

  it("detects search intent from URL", () => {
    const msg =
      "Please review this documentation at https://example.com/a for architecture notes and deployment guidance.";
    const r = heuristicClassifier(msg, 0, 10);
    expect(r?.intent).toBe("search");
    expect(r?.needsWebSearch).toBe(true);
  });
});
