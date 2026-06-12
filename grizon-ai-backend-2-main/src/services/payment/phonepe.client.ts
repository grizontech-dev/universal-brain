import { createHash, timingSafeEqual } from "crypto";
import { env } from "../../config/env.js";
import { getRedisClient } from "../../infra/redis.js";
import { logger } from "../../utils/logger.js";

const SANDBOX_BASE = "https://api-preprod.phonepe.com/apis/pg-sandbox";
const PROD_AUTH_BASE = "https://api.phonepe.com/apis/identity-manager";
const PROD_API_BASE = "https://api.phonepe.com/apis/pg";

const TOKEN_CACHE_KEY = "phonepe:oauth_token";

function authBase(): string {
  return env.PHONEPE_SANDBOX ? SANDBOX_BASE : PROD_AUTH_BASE;
}

function apiBase(): string {
  return env.PHONEPE_SANDBOX ? SANDBOX_BASE : PROD_API_BASE;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function fetchToken(): Promise<string> {
  const url = `${authBase()}/v1/oauth/token`;
  const body = new URLSearchParams({
    client_id: env.PHONEPE_CLIENT_ID ?? "",
    client_secret: env.PHONEPE_CLIENT_SECRET ?? "",
    client_version: String(env.PHONEPE_CLIENT_VERSION),
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`phonepe_token_fetch_failed:${res.status}:${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

export async function getAuthToken(): Promise<string> {
  const redis = await getRedisClient();

  if (redis) {
    try {
      const cached = await redis.get(TOKEN_CACHE_KEY);
      if (cached) return cached;
    } catch {
      // Redis miss — fall through to fresh fetch
    }
  }

  const token = await fetchToken();

  if (redis) {
    try {
      // Cache with 5-minute buffer before expiry (tokens typically valid 1h)
      await redis.set(TOKEN_CACHE_KEY, token, { EX: 3300 });
    } catch {
      // Cache write failure is non-fatal
    }
  }

  return token;
}

async function invalidateToken(): Promise<void> {
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(TOKEN_CACHE_KEY).catch(() => null);
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit,
  retried = false,
): Promise<T> {
  const token = await getAuthToken();
  const url = `${apiBase()}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${token}`,
      ...(env.PHONEPE_MERCHANT_ID ? { "X-MERCHANT-ID": env.PHONEPE_MERCHANT_ID } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 401 && !retried) {
    await invalidateToken();
    return apiFetch<T>(path, options, true);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ path, status: res.status, body: text }, "phonepe_api_error");
    throw new Error(`phonepe_api_error:${res.status}:${text}`);
  }

  // 204 No Content
  if (res.status === 204) return {} as T;

  return res.json() as Promise<T>;
}

// ─── Request / Response types ──────────────────────────────────────────────

export interface CreatePaymentOrderArgs {
  merchantOrderId: string;
  amount: number; // paise
  redirectUrl: string;
  callbackUrl: string;
  mobileNumber?: string;
  subscriptionDetails?: {
    merchantSubscriptionId: string;
    frequency: "MONTHLY" | "YEARLY" | "DAILY" | "WEEKLY" | "QUARTERLY" | "ONDEMAND";
    amountType: "FIXED" | "VARIABLE";
    maxAmount: number; // paise
    expireAt?: number; // epoch ms
  };
}

export interface CreatePaymentOrderResponse {
  orderId: string;
  state: string;
  redirectUrl: string;
  expireAt?: number;
}

export interface OrderStatusResponse {
  merchantOrderId: string;
  orderId: string;
  state: string; // PENDING | COMPLETED | FAILED | EXPIRED
  amount: number;
  paymentDetails?: Array<{
    transactionId: string;
    paymentMode: string;
    errorCode?: string;
    detailedErrorCode?: string;
  }>;
  paymentFlow?: {
    type: string;
    merchantSubscriptionId?: string;
    subscriptionId?: string;
  };
}

export interface SubscriptionStatusResponse {
  merchantSubscriptionId: string;
  subscriptionId: string;
  state: string; // ACTIVE | CANCELLED | REVOKED | PAUSED
  authWorkflowType: string;
  amountType: string;
  currency: string;
  maxAmount: number;
  frequency: string;
  expireAt?: number;
  pauseStartDate?: string | null;
  pauseEndDate?: string | null;
}

export interface NotifyRedemptionArgs {
  merchantOrderId: string;
  amount: number; // paise
  merchantSubscriptionId: string;
  expireAt?: number; // epoch ms (default: 48h from now)
  autoDebit?: boolean;
  redemptionRetryStrategy?: "STANDARD" | "CUSTOM";
}

export interface NotifyRedemptionResponse {
  orderId: string;
  state: string;
  expireAt: number;
}

export interface ExecuteRedemptionResponse {
  transactionId: string;
  state: string;
}

export interface InitiateRefundArgs {
  merchantRefundId: string;
  merchantOrderId: string;
  amount: number; // paise
}

export interface InitiateRefundResponse {
  refundId: string;
  merchantRefundId: string;
  state: string;
}

export interface RefundStatusResponse {
  merchantRefundId: string;
  refundId: string;
  state: string; // PENDING | COMPLETED | FAILED
  amount: number;
}

// ─── API methods ───────────────────────────────────────────────────────────

export const phonePeApiClient = {
  async createPaymentOrder(args: CreatePaymentOrderArgs): Promise<CreatePaymentOrderResponse> {
    const body: Record<string, unknown> = {
      merchantOrderId: args.merchantOrderId,
      amount: args.amount,
    };

    if (args.mobileNumber) body.mobileNumber = args.mobileNumber;

    if (args.subscriptionDetails) {
      // Subscription setup requires paymentFlow wrapper per PhonePe v2 docs
      body.paymentFlow = {
        type: "SUBSCRIPTION_CHECKOUT_SETUP",
        merchantUrls: {
          redirectUrl: args.redirectUrl,
          callbackUrl: args.callbackUrl,
        },
        subscriptionDetails: {
          subscriptionType: "RECURRING",
          authWorkflowType: "TRANSACTION",
          productType: "UPI_MANDATE",
          merchantSubscriptionId: args.subscriptionDetails.merchantSubscriptionId,
          amountType: args.subscriptionDetails.amountType,
          maxAmount: args.subscriptionDetails.maxAmount,
          frequency: args.subscriptionDetails.frequency,
          ...(args.subscriptionDetails.expireAt ? { expireAt: args.subscriptionDetails.expireAt } : {}),
        },
      };
    } else {
      // Regular checkout (topup)
      body.redirectUrl = args.redirectUrl;
      body.callbackUrl = args.callbackUrl;
    }

    return apiFetch<CreatePaymentOrderResponse>("/checkout/v2/pay", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async getOrderStatus(merchantOrderId: string): Promise<OrderStatusResponse> {
    return apiFetch<OrderStatusResponse>(
      `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status`,
      { method: "GET" },
    );
  },

  async getSubscriptionStatus(merchantSubscriptionId: string): Promise<SubscriptionStatusResponse> {
    return apiFetch<SubscriptionStatusResponse>(
      `/checkout/v2/subscriptions/${encodeURIComponent(merchantSubscriptionId)}/status`,
      { method: "GET" },
    );
  },

  async cancelSubscription(merchantSubscriptionId: string): Promise<void> {
    await apiFetch<unknown>(
      `/checkout/v2/subscriptions/${encodeURIComponent(merchantSubscriptionId)}/cancel`,
      { method: "POST", body: "{}" },
    );
  },

  async notifyRedemption(args: NotifyRedemptionArgs): Promise<NotifyRedemptionResponse> {
    const body: Record<string, unknown> = {
      merchantOrderId: args.merchantOrderId,
      amount: args.amount,
      paymentFlow: {
        type: "SUBSCRIPTION_CHECKOUT_REDEMPTION",
        merchantSubscriptionId: args.merchantSubscriptionId,
        redemptionRetryStrategy: args.redemptionRetryStrategy ?? "STANDARD",
        ...(args.autoDebit !== undefined ? { autoDebit: args.autoDebit } : {}),
      },
    };
    if (args.expireAt) body.expireAt = args.expireAt;

    return apiFetch<NotifyRedemptionResponse>("/checkout/v2/subscriptions/notify", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async executeRedemption(merchantOrderId: string): Promise<ExecuteRedemptionResponse> {
    return apiFetch<ExecuteRedemptionResponse>("/checkout/v2/subscriptions/redeem", {
      method: "POST",
      body: JSON.stringify({ merchantOrderId }),
    });
  },

  async initiateRefund(args: InitiateRefundArgs): Promise<InitiateRefundResponse> {
    return apiFetch<InitiateRefundResponse>("/payments/v2/refund", {
      method: "POST",
      body: JSON.stringify({
        merchantRefundId: args.merchantRefundId,
        merchantOrderId: args.merchantOrderId,
        amount: args.amount,
      }),
    });
  },

  async getRefundStatus(merchantRefundId: string): Promise<RefundStatusResponse> {
    return apiFetch<RefundStatusResponse>(
      `/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`,
      { method: "GET" },
    );
  },

  // PhonePe webhook auth: the Authorization header is a STATIC SHA256(username:password)
  // hash of the credentials configured in the PhonePe dashboard — it is NOT an HMAC of
  // the request body. See:
  // https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
  verifyWebhookSignature(authHeader: string, _rawBody: Buffer): boolean {
    const username = env.PHONEPE_WEBHOOK_USERNAME;
    const password = env.PHONEPE_WEBHOOK_PASSWORD;

    let expected: string | undefined;
    if (username && password) {
      expected = createHash("sha256").update(`${username}:${password}`).digest("hex");
    } else if (env.PHONEPE_WEBHOOK_HMAC_KEY) {
      // Backward-compat: treat the configured value as a pre-computed SHA256 hash.
      expected = env.PHONEPE_WEBHOOK_HMAC_KEY;
    }

    if (!expected) {
      logger.warn("phonepe_webhook_credentials_not_configured");
      return false;
    }

    // Normalise: PhonePe may send the header with a "SHA256 " prefix, and hex casing
    // can differ between senders. Compare lower-cased hex with constant-time equality.
    const normalize = (s: string): string =>
      s.trim().replace(/^SHA256\s+/i, "").toLowerCase();

    try {
      const expectedBuf = Buffer.from(normalize(expected), "utf8");
      const actualBuf = Buffer.from(normalize(authHeader ?? ""), "utf8");
      if (expectedBuf.length !== actualBuf.length) return false;
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  },
};
