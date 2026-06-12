import { describe, expect, it, vi } from "vitest";

const getBalanceMock = vi.fn();
const holdPendingMock = vi.fn();
const calculateCostMock = vi.fn();

vi.mock("../../../src/services/wallet.service.js", () => ({
  walletService: {
    getBalance: getBalanceMock,
    holdPending: holdPendingMock,
  },
}));

vi.mock("../../../src/services/creditCalculator.service.js", () => ({
  creditCalculator: {
    calculateCost: calculateCostMock,
  },
}));

vi.mock("../../../src/services/modelRates.service.js", () => ({
  getAgentPrimaryRates: vi.fn().mockResolvedValue({ inputRate: 0, inputCachedRate: 0, outputRate: 0 }),
}));

describe("creditBudget.middleware (integration)", () => {
  it("returns insufficient credits error when spendable is below estimate", async () => {
    getBalanceMock.mockResolvedValueOnce({ balance: 100, pending: 40 });
    calculateCostMock.mockReturnValueOnce(80);
    const { creditBudgetMiddleware } = await import("../../../src/gateway/creditBudget.middleware.js");
    const next = vi.fn();
    await creditBudgetMiddleware(
      {
        method: "POST",
        path: "/api/v1/chat",
        user: { id: "user-1" },
        plan: { id: "plan_1" },
        creditEstimate: { inputTokens: 1000, outputTokens: 2000, modelId: "gpt-4o-mini", agentSlug: "chat" },
      } as any,
      {} as any,
      next,
    );
    expect(next.mock.calls[0][0].code).toBe("INSUFFICIENT_CREDITS");
  });

  it("sets hold information when budget check passes", async () => {
    getBalanceMock.mockResolvedValueOnce({ balance: 200, pending: 20 });
    calculateCostMock.mockReturnValueOnce(100);
    holdPendingMock.mockResolvedValueOnce("hold-1");
    const { creditBudgetMiddleware } = await import("../../../src/gateway/creditBudget.middleware.js");
    const next = vi.fn();
    const req = {
      method: "POST",
      path: "/api/v1/chat",
      user: { id: "user-1" },
      plan: { id: "plan_1" },
      creditEstimate: { inputTokens: 1000, outputTokens: 2000, modelId: "gpt-4o-mini", agentSlug: "chat" },
    } as any;
    await creditBudgetMiddleware(req, {} as any, next);
    expect(req.wallet).toEqual({ holdId: "hold-1", heldAmount: 100 });
    expect(next).toHaveBeenCalledWith();
  });
});
