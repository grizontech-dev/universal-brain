import type { RequestHandler } from "express";
import { z } from "zod";
import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";
import { logger } from "../../utils/logger.js";
import {
  initiateTopup,
  pollTopupStatus,
  initiateSubscription,
  cancelSubscriptionWithPG,
} from "../../services/payment/payment.service.js";
import { env } from "../../config/env.js";

const topupBody = z.object({
  packageId: z.string().min(1),
});

const initiateSubscriptionBody = z.object({
  planId: z.string().min(1),
  billingCycle: z.enum(["monthly", "annual"]),
  mobileNumber: z.string().optional(),
});

const cancelBody = z.object({
  immediate: z.boolean().default(false),
});


export const paymentController = {
  initiateTopup: (async (req, res, next) => {
    try {
      if (!req.user || !req.plan) return next(Errors.notAuthenticated());
      const body = parseBody(topupBody, req.body);

      const result = await initiateTopup({
        userId: req.user.id,
        packageId: body.packageId,
        plan: req.plan,
        frontendRedirectUrlBuilder: (orderId) =>
          `${env.PUBLIC_URL}/payment/callback?type=topup&orderId=${orderId}`,
      });

      return ok(res, result, "Top-up initiated.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getTopupStatus: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const merchantOrderId = req.params.orderId;
      if (!merchantOrderId) return next(Errors.validation([{ path: "orderId", code: "INVALID_VALUE", message: "Required." }]));

      const result = await pollTopupStatus({
        userId: req.user.id,
        merchantOrderId,
      });

      return ok(res, result, "Order status loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  initiateSubscription: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(initiateSubscriptionBody, req.body);

      const result = await initiateSubscription({
        userId: req.user.id,
        planId: body.planId,
        billingCycle: body.billingCycle,
        frontendRedirectUrlBuilder: (orderId) =>
          `${env.PUBLIC_URL}/payment/callback?type=subscription&orderId=${orderId}`,
        mobileNumber: body.mobileNumber,
      });

      logger.info({ result }, "subscription_initiate_response");

      return ok(res, result, "Subscription setup initiated.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  cancelSubscription: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(cancelBody, req.body);

      const result = await cancelSubscriptionWithPG({
        userId: req.user.id,
        immediate: body.immediate,
        actorUserId: req.user.id,
      });

      return ok(res, result, "Subscription cancel processed.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,
};
