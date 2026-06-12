import { describe, expect, it } from "vitest";

import { startChatWorker } from "../../../src/workers/chat.worker.js";

describe("chat worker", () => {
  it("creates a BullMQ worker instance", () => {
    const worker = startChatWorker();
    expect(worker).toBeTruthy();
    worker.close();
  });
});
