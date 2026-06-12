import { env } from "../../config/env.js";
import { phonePeApiClient } from "./phonepe.client.js";
import type {
  CreatePaymentOrderArgs,
  NotifyRedemptionArgs,
} from "./phonepe.client.js";

export type TopupOrderResult = {
  redirectUrl: string;
  pgOrderId: string;
};

export type TopupOrderStatusResult = {
  state: "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED";
  pgTransactionId?: string;
};

export type SubscriptionOrderResult = {
  redirectUrl: string;
  pgOrderId: string;
};

export type SubscriptionStatusResult = {
  state: "ACTIVE" | "CANCELLED" | "REVOKED" | "PAUSED" | string;
};

export type NotifyRedemptionResult = {
  pgOrderId: string;
  state: string;
};

export type ExecuteRedemptionResult = {
  pgTransactionId: string;
  state: string;
};

export type RefundResult = {
  merchantRefundId: string;
};

export type PaymentGatewayAdapter = {
  createTopupOrder(args: {
    merchantOrderId: string;
    amountPaise: number;
    redirectUrl: string;
    mobileNumber?: string;
  }): Promise<TopupOrderResult>;

  getTopupOrderStatus(merchantOrderId: string): Promise<TopupOrderStatusResult>;

  createSubscriptionOrder(args: {
    merchantOrderId: string;
    merchantSubscriptionId: string;
    amountPaise: number;
    frequency: "MONTHLY" | "YEARLY";
    redirectUrl: string;
    subscriptionExpireAt?: number;
    mobileNumber?: string;
  }): Promise<SubscriptionOrderResult>;

  getSubscriptionStatus(merchantSubscriptionId: string): Promise<SubscriptionStatusResult>;

  cancelSubscription(merchantSubscriptionId: string): Promise<void>;

  notifyRedemption(args: NotifyRedemptionArgs): Promise<NotifyRedemptionResult>;

  executeRedemption(merchantOrderId: string): Promise<ExecuteRedemptionResult>;

  initiateRefund(args: {
    merchantRefundId: string;
    merchantOrderId: string;
    amountPaise: number;
  }): Promise<RefundResult>;

  verifyWebhookSignature(authHeader: string, rawBody: Buffer): boolean;
};

function webhookCallbackUrl(): string {
  return `${env.PUBLIC_URL}/payments/webhook`;
}

export const phonepeAdapter: PaymentGatewayAdapter = {
  async createTopupOrder(args) {
    const result = await phonePeApiClient.createPaymentOrder({
      merchantOrderId: args.merchantOrderId,
      amount: args.amountPaise,
      redirectUrl: args.redirectUrl,
      callbackUrl: webhookCallbackUrl(),
      mobileNumber: args.mobileNumber,
    });
    return {
      redirectUrl: result.redirectUrl,
      pgOrderId: result.orderId,
    };
  },

  async getTopupOrderStatus(merchantOrderId) {
    const result = await phonePeApiClient.getOrderStatus(merchantOrderId);
    const state = result.state as TopupOrderStatusResult["state"];
    const pgTransactionId = result.paymentDetails?.[0]?.transactionId;
    return { state, pgTransactionId };
  },

  async createSubscriptionOrder(args) {
    const orderArgs: CreatePaymentOrderArgs = {
      merchantOrderId: args.merchantOrderId,
      amount: args.amountPaise,
      redirectUrl: args.redirectUrl,
      callbackUrl: webhookCallbackUrl(),
      mobileNumber: args.mobileNumber,
      subscriptionDetails: {
        merchantSubscriptionId: args.merchantSubscriptionId,
        frequency: args.frequency,
        amountType: "FIXED",
        maxAmount: args.amountPaise,
        expireAt: args.subscriptionExpireAt,
      },
    };
    const result = await phonePeApiClient.createPaymentOrder(orderArgs);
    return {
      redirectUrl: result.redirectUrl,
      pgOrderId: result.orderId,
    };
  },

  async getSubscriptionStatus(merchantSubscriptionId) {
    const result = await phonePeApiClient.getSubscriptionStatus(merchantSubscriptionId);
    return { state: result.state };
  },

  async cancelSubscription(merchantSubscriptionId) {
    await phonePeApiClient.cancelSubscription(merchantSubscriptionId);
  },

  async notifyRedemption(args) {
    const result = await phonePeApiClient.notifyRedemption(args);
    return { pgOrderId: result.orderId, state: result.state };
  },

  async executeRedemption(merchantOrderId) {
    const result = await phonePeApiClient.executeRedemption(merchantOrderId);
    return {
      pgTransactionId: result.transactionId,
      state: result.state,
    };
  },

  async initiateRefund(args) {
    const result = await phonePeApiClient.initiateRefund({
      merchantRefundId: args.merchantRefundId,
      merchantOrderId: args.merchantOrderId,
      amount: args.amountPaise,
    });
    return { merchantRefundId: result.merchantRefundId };
  },

  verifyWebhookSignature(authHeader, rawBody) {
    return phonePeApiClient.verifyWebhookSignature(authHeader, rawBody);
  },
};
