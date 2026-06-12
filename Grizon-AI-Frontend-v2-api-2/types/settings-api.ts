/**
 * DTOs aligned with grizon-ai-backend-2 user APIs (`/api/v1/auth/*`, `/usage/*`, `/wallet/*`).
 * Field names match JSON from the backend envelope `data` payloads.
 */

/** `GET /auth/sessions` list item (see `auth.service.listSessions`). */
export type AuthSessionListItem = {
  id: string;
  platform: string;
  device_name: string;
  device_type: string;
  os: string | null;
  browser: string | null;
  app_version: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  issued_at: string;
  last_used_at: string | null;
  expires_at: string;
  is_current: boolean;
};

export type AuthSessionsListDto = {
  sessions: AuthSessionListItem[];
};

/** `GET /usage/summary` — aggregates from `usage_daily_user` (snake_case keys). */
export type UsageSummaryDto = {
  periodStart: string;
  periodEnd: string;
  requests: number;
  total_tokens: number;
  credits_used: number;
  /** numeric from DB */
  cost_usd: number | string;
};

export type UsageHistoryPointDto = {
  day: string;
  request_count: number;
  total_tokens: number;
  credits_deducted: number;
  cost_usd: number | string;
};

export type UsageHistoryDto = {
  days: number;
  points: UsageHistoryPointDto[];
};

/** `GET /usage/rate-limit` — per-window request limits (Module 5). */
export type RateLimitWindowKey = 'hourly' | 'daily' | 'weekly' | 'monthly';

export type RateLimitWindowDto = {
  used: number;
  limit: number | null;
  remaining: number;
  usagePercent: number | null;
  resetAt: string;
};

export type UsageRateLimitDto = {
  cooldown: {
    active: boolean;
    retryAfterSeconds: number | null;
    cooldownUntil: string | null;
  };
  windows: Partial<Record<RateLimitWindowKey, RateLimitWindowDto>>;
  degraded: boolean;
};

/** Mirrors backend `src/types/wallet.d.ts` `WalletTransaction` for API JSON. */
export type WalletTxType = 'grant' | 'deduct' | 'topup' | 'rollover' | 'refund' | 'adjustment';

export type WalletTransactionDto = {
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
};

export type WalletTransactionsListDto = {
  transactions: WalletTransactionDto[];
  pagination: { page: number; page_size: number; total: number };
};

export type WalletTransactionDetailDto = {
  transaction: WalletTransactionDto;
};

/** `POST /auth/password/forgot` data payload. */
export type PasswordForgotAckDto = { ok: boolean };
