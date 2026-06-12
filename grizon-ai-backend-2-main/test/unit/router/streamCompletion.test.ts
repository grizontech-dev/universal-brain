import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderEvent, RoutingDecision } from "../../../src/types/router.js";

type MockProvider = {
  streamCompletion: (params: { abortSignal: AbortSignal }) => AsyncIterable<ProviderEvent>;
};

let currentProvider: MockProvider;

vi.mock("../../../src/models/provider.js", () => ({
  getProvider: () => currentProvider,
}));

vi.mock("../../../src/router/providerHealth.js", () => ({
  providerHealth: {
    isOpen: vi.fn(async () => false),
    recordSuccess: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
  },
}));

vi.mock("../../../src/router/tools.js", () => ({
  toolSpecsFor: vi.fn(() => []),
  resolveAllowedTools: vi.fn(() => []),
}));

vi.mock("../../../src/agents/index.js", () => ({
  getAgent: vi.fn(() => ({ maxToolRounds: 10 })),
  getAgentDescriptor: vi.fn(() => ({ slug: "chat", systemPrompt: "x", toolBudgets: {} })),
}));

const { streamCompletion, applyToolBudgets } = await import("../../../src/router/index.js");

function baseDecision(partial?: Partial<RoutingDecision>): RoutingDecision {
  return {
    classification: {
      intent: "chat",
      complexity: "medium",
      needsWebSearch: false,
      needsCodeExecution: false,
      needsFileRead: false,
      needsFileGen: [],
      searchContextSize: "low",
      suggestedAgent: "chat",
      confidence: 1,
      classifierSource: "heuristic",
    },
    agentSlug: "general",
    modelId: "m1",
    modelProvider: "anthropic",
    fallbackChain: [],
    rewrittenQuery: null,
    systemPrompt: "sys",
    allowedTools: ["web_search"],
    toolBudgets: {},
    source: "agent",
    routerLatencyMs: 1,
  };
}

describe("streamCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks over-budget tool calls by tool id", async () => {
    const res = applyToolBudgets(
      [{ toolId: "web_search", arguments: { q: "x" }, callId: "c1" }],
      { web_search: 0 },
      {},
    );
    expect(res.allowed).toHaveLength(0);
    expect(res.blocked).toHaveLength(1);
    expect(res.blocked[0]?.toolId).toBe("web_search");
    expect((res.blocked[0]?.output as { code?: string })?.code).toBe("TOOL_BUDGET_EXCEEDED");
  });

  it("maps stream timeout abort reason to STREAM_TIMEOUT", async () => {
    currentProvider = {
      async *streamCompletion() {
        throw new Error("aborted");
      },
    };
    const ctl = new AbortController();
    ctl.abort("stream_timeout");

    const out: ProviderEvent[] = [];
    for await (const ev of streamCompletion(
      baseDecision(),
      [{ role: "user", content: "hello" }],
      ctl.signal,
      { userId: "u1", conversationId: "c1", attachedFileIds: [], maxArtifactVersions: 1 },
    )) {
      out.push(ev);
    }

    const err = out.find((e) => e.type === "error");
    expect(err && err.type === "error" ? err.code : null).toBe("STREAM_TIMEOUT");
  });
});
