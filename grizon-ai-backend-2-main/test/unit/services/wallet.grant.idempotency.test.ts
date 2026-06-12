import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("../../../src/db/pool.js", () => ({
  getPool: () => ({
    connect: async () => ({ query: queryMock, release: releaseMock }),
  }),
}));

vi.mock("../../../src/events/wallet.events.js", () => ({
  walletEvents: { emit: vi.fn() },
}));

describe("walletService.grant idempotency", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
  });

  it("returns the existing transaction without mutating balance when the idempotency key already exists", async () => {
    const existingTxRow = {
      id: "tx-existing",
      wallet_id: "wallet-1",
      type: "grant",
      amount: 1000,
      balance_after: 1000,
      message_id: null,
      job_id: null,
      agent_slug: null,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
      credit_rate: null,
      agent_multiplier: null,
      plan_discount: null,
      actor_id: null,
      description: "subscription_granted",
      created_at: new Date().toISOString(),
      user_id: "user-1",
    };

    const walletRow = {
      id: "wallet-1",
      user_id: "user-1",
      balance: 1000,
      pending: 0,
      lifetime_earned: 1000,
      lifetime_spent: 0,
      updated_at: new Date().toISOString(),
    };

    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [existingTxRow], rowCount: 1 }) // SELECT idempotency_key
      .mockResolvedValueOnce({ rows: [walletRow], rowCount: 1 }) // SELECT wallet
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const { walletService } = await import("../../../src/services/wallet.service.js");
    const result = await walletService.grant("user-1", 1000, "subscription", {
      idempotencyKey: "subscription_grant:sub-1:created:granted",
      description: "subscription_granted",
    });

    expect(result.alreadyApplied).toBe(true);
    expect(result.transaction.id).toBe("tx-existing");
    expect(queryMock.mock.calls.map((c) => c[0])).not.toContain(
      expect.stringContaining("UPDATE wallets"),
    );
  });

  it("inserts a new transaction with the idempotency_key when none exists yet", async () => {
    const walletForUpdate = {
      id: "wallet-1",
      user_id: "user-1",
      balance: 0,
      pending: 0,
      lifetime_earned: 0,
      lifetime_spent: 0,
      updated_at: new Date().toISOString(),
    };
    const updatedTxRow = {
      id: "tx-new",
      wallet_id: "wallet-1",
      type: "grant",
      amount: 1000,
      balance_after: 1000,
      message_id: null,
      job_id: null,
      agent_slug: null,
      model_id: null,
      input_tokens: null,
      output_tokens: null,
      credit_rate: null,
      agent_multiplier: null,
      plan_discount: null,
      actor_id: null,
      description: "subscription_granted",
      created_at: new Date().toISOString(),
    };
    const updatedWallet = { ...walletForUpdate, balance: 1000, lifetime_earned: 1000 };

    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT idempotency_key (miss)
      .mockResolvedValueOnce({ rows: [walletForUpdate], rowCount: 1 }) // SELECT wallet FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE wallets
      .mockResolvedValueOnce({ rows: [updatedTxRow], rowCount: 1 }) // INSERT wallet_transactions
      .mockResolvedValueOnce({ rows: [updatedWallet], rowCount: 1 }) // SELECT wallet
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const { walletService } = await import("../../../src/services/wallet.service.js");
    const result = await walletService.grant("user-1", 1000, "subscription", {
      idempotencyKey: "subscription_grant:sub-1:created:granted",
      description: "subscription_granted",
    });

    expect(result.alreadyApplied).toBe(false);
    expect(result.transaction.id).toBe("tx-new");
    expect(result.wallet.balance).toBe(1000);
    const insertedKey = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO wallet_transactions"),
    )?.[1];
    expect(insertedKey?.[7]).toBe("subscription_grant:sub-1:created:granted");
  });
});
