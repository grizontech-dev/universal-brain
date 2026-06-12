import type { RequestHandler } from "express";
import { z } from "zod";

import { analyticsService } from "../../services/analytics.service.js";
import { rateLimitService } from "../../services/rateLimit.service.js";
import { Errors, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";

const summaryQuery = z.object({
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
});

const historyQuery = z.object({
  days: z.coerce.number().int().positive().max(90).default(30),
});

export const usageController = {
  getSummary: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(summaryQuery, req.query);
      const periodEnd = q.periodEnd ?? new Date().toISOString().slice(0, 10);
      const periodStart =
        q.periodStart ?? new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const summary = await analyticsService.getUserSummary(req.user.id, periodStart, periodEnd);
      return ok(
        res,
        { periodStart, periodEnd, ...summary },
        "Usage summary loaded.",
      );
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getHistory: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(historyQuery, req.query);
      const history = await analyticsService.getUserHistory(req.user.id, q.days);
      return ok(res, { days: q.days, points: history }, "Usage history loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getRateLimitUsage: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      if (!req.plan) return next(Errors.internal("plan_not_loaded"));
      const usage = await rateLimitService.getUsage(req.user.id, req.plan);
      return ok(res, usage, "Rate limit usage loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,
};
