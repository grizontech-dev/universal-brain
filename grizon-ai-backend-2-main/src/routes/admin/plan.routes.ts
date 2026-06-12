import { Router } from "express";
import { z } from "zod";

import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { ok, created } from "../../utils/response.js";
import { requireAdmin, requireSuperadmin } from "../../gateway/admin.middleware.js";
import { planService } from "../../services/plan.service.js";
import { subscriptionService } from "../../services/subscription.service.js";
import type { SubscriptionStatus } from "../../types/plan.js";

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

const adminPlansQuery = paginationQuery.extend({
  status: z.enum(["active", "archived"]).optional(),
  isPublic: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const creditPackageSchema = z.object({
  id: z.string().min(1).optional(),
  credits: z.number().int().nonnegative(),
  price: z.number().int().nonnegative(),
});

const pricingSchema = z.object({
  monthly: z.number().int().nonnegative(),
  annual: z.number().int().nonnegative(),
  currency: z.literal("inr"),
});

const creditsSchema = z.object({
  included: z.number().int().nonnegative(),
  rollover: z.boolean(),
  maxRollover: z.number().int().nonnegative().nullable(),
  topupEnabled: z.boolean(),
  topupPackages: z.array(creditPackageSchema),
});

const limitsSchema = z.object({
  hourly: z.number().int().nonnegative(),
  daily: z.number().int().nonnegative(),
  weekly: z.number().int().nonnegative(),
  monthly: z.number().int().nonnegative(),
  maxContextMessages: z.number().int().nonnegative(),
  maxFileSize: z.number().int().nonnegative(),
  maxFilesPerChat: z.number().int().nonnegative(),
  maxArtifactVersions: z.number().int().nonnegative(),
});

const nullableLimit = z.number().int().nonnegative().nullable();
const featureLimitsSchema = z.object({
  webSearch: z
    .object({
      dailyLimit: nullableLimit,
      monthlyLimit: nullableLimit,
    })
    .nullable(),
  codeExecution: z
    .object({
      hourlyLimit: nullableLimit,
      dailyLimit: nullableLimit,
    })
    .nullable(),
});

const createPlanBody = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  isPublic: z.boolean().optional(),
  isIntroductory: z.boolean().optional(),
  pricing: pricingSchema,
  credits: creditsSchema,
  limits: limitsSchema,
  agentAccess: z.array(z.string()),
  featureFlags: z.record(z.string(), z.boolean()),
  featureLimits: featureLimitsSchema.optional(),
});

const patchPlanBody = z
  .object({
    pricing: pricingSchema.optional(),
    credits: creditsSchema.optional(),
    limits: limitsSchema.optional(),
    agentAccess: z.array(z.string()).optional(),
    featureFlags: z.record(z.string(), z.boolean()).optional(),
    featureLimits: featureLimitsSchema.optional(),
    isPublic: z.boolean().optional(),
    isIntroductory: z.boolean().optional(),
  })
  .strict();

const subscribersQuery = paginationQuery.extend({
  status: z.enum(["active", "past_due", "cancelled", "paused"]).optional(),
});

const adminSubscriptionsQuery = paginationQuery.extend({
  userId: z.string().uuid().optional(),
  planId: z.string().min(1).optional(),
  status: z.enum(["active", "past_due", "cancelled", "paused"]).optional(),
});

const adminAssignSubscriptionBody = z
  .object({
    userId: z.string().uuid(),
    planId: z.string().min(1),
    billingCycle: z.enum(["monthly", "annual"]),
    reason: z.string().min(1),
  })
  .strict();

const adminCancelSubscriptionBody = z
  .object({
    immediate: z.boolean(),
    reason: z.string().min(1),
  })
  .strict();

const adminPatchSubscriptionBody = z
  .object({
    status: z.enum(["active", "past_due", "cancelled", "paused"]).optional(),
    currentPeriodStart: z.string().min(1).optional(),
    currentPeriodEnd: z.string().min(1).optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    creditsGranted: z.number().int().nonnegative().optional(),
    creditsRolledOver: z.number().int().nonnegative().optional(),
    pgProvider: z.union([z.literal("phonepe"), z.null()]).optional(),
    pgSubscriptionId: z.union([z.string(), z.null()]).optional(),
    pgMerchantTransactionId: z.union([z.string(), z.null()]).optional(),
    pgCustomerRef: z.union([z.string(), z.null()]).optional(),
    reason: z.string().min(1),
  })
  .strict();

export const planAdminRoutes = Router();

planAdminRoutes.get("/plans", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const q = parseQuery(adminPlansQuery, req.query);
    const { plans, total } = await planService.listAllPlans({
      status: q.status,
      isPublic: q.isPublic,
      page: q.page,
      pageSize: q.pageSize,
    });
    return ok(res, { plans, pagination: { page: q.page, pageSize: q.pageSize, total } }, "Plans loaded.");
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.post("/plans", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const body = parseBody(createPlanBody, req.body);
    const plan = await planService.createPlan({
      id: body.id,
      name: body.name,
      slug: body.slug,
      isPublic: body.isPublic,
      isIntroductory: body.isIntroductory,
      pricing: body.pricing,
      credits: body.credits,
      limits: body.limits,
      agentAccess: body.agentAccess,
      featureFlags: body.featureFlags,
      featureLimits: body.featureLimits,
      createdBy: req.user.id,
    });
    return created(res, { plan }, "Plan created.");
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.patch("/plans/:id", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const body = parseBody(patchPlanBody, req.body);
    const plan = await planService.updatePlan(req.params.id, body as Record<string, unknown>, req.user.id);
    return ok(res, { plan }, "Plan updated.");
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.post("/plans/:id/archive", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const plan = await planService.archivePlan(req.params.id, req.user.id);
    return ok(res, { plan }, "Plan archived.");
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.post("/plans/:id/publish", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const plan = await planService.publishPlan(req.params.id, req.user.id);
    return ok(res, { plan }, "Plan published.");
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.post("/plans/:id/sync-snapshots", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const result = await planService.syncSnapshots(req.params.id);
    return ok(res, result, `Synced ${result.synced} subscription snapshot(s).`);
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.get("/plans/:id/subscribers", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const q = parseQuery(subscribersQuery, req.query);
    const status = (q.status ?? "active") as SubscriptionStatus;
    const { subscribers, total } = await planService.getSubscribersOfPlan({
      planId: req.params.id,
      status,
      page: q.page,
      pageSize: q.pageSize,
    });
    return ok(
      res,
      { subscribers, pagination: { page: q.page, pageSize: q.pageSize, total } },
      "Subscribers loaded.",
    );
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.get("/subscriptions", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const q = parseQuery(adminSubscriptionsQuery, req.query);
    const { subscriptions, total } = await subscriptionService.listSubscriptions({
      userId: q.userId,
      planId: q.planId,
      status: q.status,
      page: q.page,
      pageSize: q.pageSize,
    });
    return ok(
      res,
      { subscriptions, pagination: { page: q.page, pageSize: q.pageSize, total } },
      "Subscriptions loaded.",
    );
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.post("/subscriptions", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const body = parseBody(adminAssignSubscriptionBody, req.body);
    const subscription = await subscriptionService.adminAssignSubscription({
      userId: body.userId,
      planId: body.planId,
      billingCycle: body.billingCycle,
      actorUserId: req.user.id,
      reason: body.reason,
    });
    return created(res, { subscription }, "Subscription assigned.");
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.post("/subscriptions/:id/cancel", requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const body = parseBody(adminCancelSubscriptionBody, req.body);
    const result = await subscriptionService.adminCancelSubscription({
      subscriptionId: req.params.id,
      immediate: body.immediate,
      actorUserId: req.user.id,
      reason: body.reason,
    });
    const msg = body.immediate ? "Subscription cancelled immediately." : "Subscription set to stop at period end.";
    return ok(res, result, msg);
  } catch (e) {
    return next(e);
  }
});

planAdminRoutes.patch("/subscriptions/:id", requireSuperadmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Errors.notAuthenticated());
    const body = parseBody(adminPatchSubscriptionBody, req.body);
    const { reason, ...patch } = body;
    const subscription = await subscriptionService.adminAdjustSubscription({
      subscriptionId: req.params.id,
      actorUserId: req.user.id,
      reason,
      patch,
    });
    return ok(res, { subscription }, "Subscription adjusted.");
  } catch (e) {
    return next(e);
  }
});
