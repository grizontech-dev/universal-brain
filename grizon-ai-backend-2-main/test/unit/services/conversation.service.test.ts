import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
}));

describe("conversationService", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("lists with keyset limit+1 and returns cursor", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: "00000000-0000-0000-0000-000000000001", user_id: "u1", title: "A", status: "active", tags: [], platform: "web", total_tokens_used: 0, message_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() },
        { id: "00000000-0000-0000-0000-000000000002", user_id: "u1", title: "B", status: "active", tags: [], platform: "web", total_tokens_used: 0, message_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() },
      ],
      rowCount: 2,
    });
    const { conversationService } = await import("../../../src/services/conversation.service.js");
    const out = await conversationService.list({ userId: "u1", limit: 1 });
    expect(out.items).toHaveLength(1);
    expect(out.hasMore).toBe(true);
    expect(out.nextCursor).toBeTruthy();
  });
});
