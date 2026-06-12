import { describe, expect, it } from "vitest";

import { normaliseJudge0Language, SUPPORTED_CODE_LANGUAGES } from "../../../src/tools/codeExecution.tool.js";

describe("codeExecution language map", () => {
  it("normalises c++ alias to cpp", () => {
    expect(normaliseJudge0Language("C++")).toBe("cpp");
  });

  it("accepts canonical Judge0 language keys", () => {
    for (const lang of SUPPORTED_CODE_LANGUAGES) {
      expect(normaliseJudge0Language(lang)).toBe(lang);
    }
  });

  it("rejects unknown languages", () => {
    expect(normaliseJudge0Language("fortran")).toBeNull();
  });
});
