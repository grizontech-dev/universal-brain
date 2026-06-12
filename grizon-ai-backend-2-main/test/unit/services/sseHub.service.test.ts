import { describe, expect, it } from "vitest";

import { sseHub } from "../../../src/services/sseHub.service.js";

describe("sseHub.service", () => {
  it("publishes to subscribers", () => {
    const received: string[] = [];
    const unsubscribe = sseHub.subscribe("job-1", (event) => {
      received.push(event.event);
    });
    sseHub.publish("job-1", "queued", { position: 1 });
    unsubscribe();
    expect(received).toEqual(["queued"]);
  });

  it("replays buffered events to late subscribers", () => {
    sseHub.publish("job-2", "chunk", { content: "hello" });
    const received: string[] = [];
    const unsubscribe = sseHub.subscribe("job-2", (event) => {
      received.push(event.event);
    });
    unsubscribe();
    expect(received).toContain("chunk");
  });
});
