import type { Request, RequestHandler } from "express";

import { subscriptionService } from "../services/subscription.service.js";
import type { SubscriptionPublic } from "../types/plan.js";

const memo = new WeakMap<Request, SubscriptionPublic>();

const PLAN_SKIP_PATHS = new Set([
  "/health",
  "/",
  "/api/v1/ping",
  "/api/v1/error",
  "/api/v1/plans",
]);

export const planMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) return next();

    if (PLAN_SKIP_PATHS.has(req.path)) return next();
    if (req.path.startsWith("/api/v1/auth")) return next();

    const hit = memo.get(req);
    if (hit) {
      req.subscription = hit;
      req.plan = hit.planSnapshot;
      return next();
    }

    let sub = await subscriptionService.getActiveSubscriptionForUser(req.user.id);
    if (!sub) {
      sub = await subscriptionService.assignFreePlan(req.user.id);
    } else if (sub.creditsGranted > 0 || sub.creditsRolledOver > 0) {
      // Reconcile any missed wallet grant (e.g. failed mid-registration) on the
      // next authenticated request. Idempotent via wallet_transactions.idempotency_key.
      await subscriptionService.ensureGrantsForUser(req.user.id).catch((err) => {
        req.log?.warn({ err, userId: req.user!.id }, "subscription_grant_reconcile_failed");
      });
    }

    memo.set(req, sub);
    req.subscription = sub;
    req.plan = sub.planSnapshot;
    return next();
  } catch (e) {
    return next(e);
  }
};
