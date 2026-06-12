export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  pending: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  updatedAt: string;
}

export type WalletTxType = "grant" | "deduct" | "topup" | "rollover" | "refund" | "adjustment" | "settled" | "released";

export interface WalletHold {
  holdId: string;
  heldAmount: number;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: WalletTxType;
  amount: number;
  balanceAfter: number;
  messageId: string | null;
  jobId: string | null;
  agentSlug: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  creditRate: number | null;
  agentMultiplier: number | null;
  planDiscount: number | null;
  actorId: string | null;
  description: string;
  createdAt: string;
}
