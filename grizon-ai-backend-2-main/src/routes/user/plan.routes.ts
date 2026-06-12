import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";

import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { ok, created } from "../../utils/response.js";
import { planService } from "../../services/plan.service.js";
import { subscriptionService } from "../../services/subscription.service.js";

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const upgradeBody = z.object({
  planId: z.string().min(1),
  billingCycle: z.enum(["monthly", "annual"]),
});

const cancelBody = z.object({
  immediate: z.boolean().optional(),
});

/** Consumer catalog + subscription endpoints reject `x-platform: admin` (docs §05 / §04). */
export const requireConsumerPlatformForPlansModule: RequestHandler = (req, _res, next) => {
  const p = req.platform;
  if (p !== "web" && p !== "mobile-ios" && p !== "mobile-android") {
    return next(Errors.platformMismatch());
  }
  return next();
};

/** Mounted at `/plans` → `GET /api/v1/plans` */
const publicPlansRouter = Router();

publicPlansRouter.get("/", async (req, res, next) => {
  try {
    const q = parseQuery(paginationQuery, req.query);
    const { plans, total } = await planService.listPublicPlans({ page: q.page, pageSize: q.pageSize });
    return ok(
      res,
      { plans, pagination: { page: q.page, pageSize: q.pageSize, total } },
      "Plans loaded.",
    );
  } catch (e) {
    return next(e);
  }
});

/** Mounted at `/subscription` → `/api/v1/subscription`, `/upgrade`, `/cancel` */
const subscriptionUserRouter = Router();

subscriptionUserRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const sub = req.subscription;
    if (!sub) {
      return next(Errors.internal(new Error("plan_middleware_missing_subscription")));
    }
    return ok(res, { subscription: sub }, "Subscription loaded.");
  } catch (e) {
    return next(e);
  }
});

subscriptionUserRouter.post("/upgrade", async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const body = parseBody(upgradeBody, req.body);
    const sub = await subscriptionService.upgradeSubscription({
      userId: req.user.id,
      planId: body.planId,
      billingCycle: body.billingCycle,
      actorUserId: req.user.id,
    });
    return created(res, { subscription: sub }, "Subscription upgraded.");
  } catch (e) {
    return next(e);
  }
});

subscriptionUserRouter.post("/cancel", async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const body = parseBody(cancelBody, req.body);
    const result = await subscriptionService.cancelSubscription({
      userId: req.user.id,
      immediate: Boolean(body.immediate),
      actorUserId: req.user.id,
    });

    if (result.mode === "graceful") {
      return ok(
        res,
        { subscription: result.subscription, effectiveAt: result.effectiveAt },
        "Cancellation scheduled.",
      );
    }
    return ok(
      res,
      {
        subscription: result.subscription,
        cancelledSubscriptionId: result.cancelledSubscriptionId,
      },
      "Subscription cancelled.",
    );
  } catch (e) {
    return next(e);
  }
});

/** Registers Module 2 user routes without touching unrelated `/api/v1/*` paths. */
export function mountPlanUserRoutes(parent: Router) {
  parent.use("/plans", requireConsumerPlatformForPlansModule, publicPlansRouter);
  parent.use("/subscription", requireConsumerPlatformForPlansModule, subscriptionUserRouter);
}
