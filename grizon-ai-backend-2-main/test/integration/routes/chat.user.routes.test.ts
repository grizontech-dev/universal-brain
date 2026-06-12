import { describe, expect, it } from "vitest";

import { chatUserRoutes } from "../../../src/routes/user/chat.routes.js";

describe("chat user routes", () => {
  it("registers expected route handlers", () => {
    const routePaths = chatUserRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => Object.keys(layer.route.methods)[0] + " " + layer.route.path);
    expect(routePaths).toContain("post /");
    expect(routePaths).toContain("get /stream/:jobId");
    expect(routePaths).toContain("get /job/:jobId");
    expect(routePaths).toContain("post /:conversationId/cancel");
  });
});
