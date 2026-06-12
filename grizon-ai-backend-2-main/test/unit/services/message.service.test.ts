import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({
    query: queryMock,
    connect: async () => ({ query: queryMock, release: releaseMock }),
  }),
}));

describe("messageService", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
  });

  it("appends streaming chunks in-place", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { messageService } = await import("../../../src/services/message.service.js");
    await messageService.append("m1", "chunk");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE messages SET content = content ||"),
      ["m1", "chunk"],
    );
  });

  it("createUserMessageWithClient inserts user row and bumps conversation", async () => {
    const now = new Date().toISOString();
    const insertedRow = {
      id: "um-1",
      conversation_id: "c1",
      user_id: "u1",
      role: "user",
      content: "hi",
      attached_file_ids: [],
      input_tokens: 0,
      output_tokens: 0,
      credits_deducted: 0,
      agent_slug: null,
      model_id: null,
      model_provider: null,
      web_search_used: false,
      code_execution_used: false,
      file_analysis_used: false,
      voice_mode_used: false,
      citations: [],
      latency_ms: null,
      status: "complete",
      job_id: null,
      error_message: null,
      is_included_in_summary: false,
      created_at: now,
      updated_at: now,
    };
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: "c1" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [insertedRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const { messageService } = await import("../../../src/services/message.service.js");
    const client = { query: queryMock };
    const msg = await messageService.createUserMessageWithClient(client, {
      conversationId: "c1",
      userId: "u1",
      content: "hi",
      attachedFileIds: [],
    });
    expect(msg.id).toBe("um-1");
    expect(msg.role).toBe("user");
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});
