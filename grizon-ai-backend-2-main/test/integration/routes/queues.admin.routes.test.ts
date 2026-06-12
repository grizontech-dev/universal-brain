import { describe, expect, it } from "vitest";

import { queuesAdminRoutes } from "../../../src/routes/admin/queues.routes.js";

describe("queues admin routes", () => {
  it("registers expected route handlers", () => {
    const routePaths = queuesAdminRoutes.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => Object.keys(layer.route.methods)[0] + " " + layer.route.path);
    expect(routePaths).toContain("get /system/queues");
    expect(routePaths).toContain("post /system/queues/:name/retry-failed");
  });
});
