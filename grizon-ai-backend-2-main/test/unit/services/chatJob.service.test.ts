import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const releaseMock = vi.fn();
const addMock = vi.fn();

const hoisted = vi.hoisted(() => ({
  emitMock: vi.fn(),
}));

vi.mock("../../../src/events/conversation.events.js", () => ({
  conversationEvents: {
    emit: (event: string, payload: unknown) => hoisted.emitMock(event, payload),
  },
}));

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({
    connect: async () => ({
      query: queryMock,
      release: releaseMock,
    }),
  }),
}));

vi.mock("../../../src/queues/chat.queue.js", () => ({
  chatQueue: {
    add: addMock,
  },
}));

const now = new Date().toISOString();

function userMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-msg-1",
    conversation_id: "conv-1",
    user_id: "user-1",
    role: "user",
    content: "hello",
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
    ...overrides,
  };
}

function chatJobRow(id: string, clientMessageId: string) {
  return {
    id,
    user_id: "user-1",
    conversation_id: "conv-1",
    client_message_id: clientMessageId,
    wallet_hold_id: "hold-1",
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    result_message_id: null,
    artifact_ids: [],
    error_code: null,
    error_message: null,
    agent_slug: null,
    model_id: null,
    created_at: now,
    started_at: null,
    completed_at: null,
  };
}

describe("chatJob.service", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    addMock.mockReset();
    hoisted.emitMock.mockReset();
    vi.resetModules();
  });

  it("returns existing job for idempotent replay", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({
        rows: [chatJobRow("job-1", "msg-1")],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const { chatJobService } = await import("../../../src/services/chatJob.service.js");
    const result = await chatJobService.enqueueChat({
      userId: "user-1",
      conversationId: "conv-1",
      messageId: "m-1",
      clientMessageId: "msg-1",
      sessionId: "sess-1",
      platform: "web",
      planSnapshot: {} as any,
      walletHoldId: "hold-1",
      content: "hello",
      attachedFileIds: [],
      agentSlug: null,
      modelId: null,
      options: {},
      estimatedTokens: 10,
    });
    expect(result.replayed).toBe(true);
    expect(addMock).not.toHaveBeenCalled();
    expect(hoisted.emitMock).not.toHaveBeenCalled();
  });

  it("persists user message in same transaction then enqueues job", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no existing job
      .mockResolvedValueOnce({ rows: [{ id: "conv-1" }], rowCount: 1 }) // conversation active
      .mockResolvedValueOnce({ rows: [userMessageRow()], rowCount: 1 }) // INSERT user message
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE conversations
      .mockResolvedValueOnce({
        rows: [chatJobRow("new-job-id", "fresh-client-id")],
        rowCount: 1,
      }) // INSERT chat_jobs
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    addMock.mockResolvedValueOnce(undefined);

    const { chatJobService } = await import("../../../src/services/chatJob.service.js");
    const result = await chatJobService.enqueueChat({
      userId: "user-1",
      conversationId: "conv-1",
      messageId: "m-1",
      clientMessageId: "fresh-client-id",
      sessionId: "sess-1",
      platform: "web",
      planSnapshot: {} as any,
      walletHoldId: "hold-1",
      content: "hello",
      attachedFileIds: [],
      agentSlug: null,
      modelId: null,
      options: {},
      estimatedTokens: 10,
    });

    expect(result.replayed).toBe(false);
    expect(result.job.id).toBe("new-job-id");
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(hoisted.emitMock).toHaveBeenCalledWith(
      "message.finalised",
      expect.objectContaining({
        role: "user",
        messageId: "user-msg-1",
        conversationId: "conv-1",
        userId: "user-1",
      }),
    );
  });
});
