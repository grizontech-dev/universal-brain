import type { RequestHandler } from "express";
import { z } from "zod";

import { requireAdmin } from "../../gateway/admin.middleware.js";
import { rateLimitService } from "../../services/rateLimit.service.js";
import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";

const eventsQuery = z.object({
  user_id: z.string().uuid().optional(),
  event_type: z.enum(["hit", "cooldown", "flagged", "cleared", "flag_resolved"]).optional(),
  limit_type: z.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});

const clearBody = z.object({
  reason: z.string().min(10),
});

const cooldownBody = z.object({
  action: z.enum(["apply", "remove"]),
  duration: z.number().int().positive().optional(),
  reason: z.string().min(10),
});

const resolveBody = z.object({
  action: z.enum(["resolve_no_action", "whitelist_24h", "escalate_ban"]),
  notes: z.string().min(1),
});

const usersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().trim().optional(),
  plan_slug: z.string().trim().optional(),
});

const resetWindowBody = z.object({
  window: z.enum(["hourly", "daily", "weekly", "monthly"]),
  reason: z.string().min(10),
});

export const ratelimitsAdminController = {
  getEvents: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(eventsQuery, req.query);
      const out = await rateLimitService.listEvents({
        userId: q.user_id,
        eventType: q.event_type,
        limitType: q.limit_type,
        from: q.from,
        to: q.to,
        page: q.page,
        pageSize: q.page_size,
      });
      return ok(
        res,
        { events: out.events, page: q.page, page_size: q.page_size, total: out.total },
        "Rate limit events loaded.",
      );
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  clearUser: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(clearBody, req.body);
      await rateLimitService.clear(req.params.userId, req.user.id, body.reason);
      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  setCooldown: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(cooldownBody, req.body);
      if (body.action === "remove") {
        await rateLimitService.removeCooldown(req.params.userId, req.user.id, body.reason);
        return ok(res, { cooldownUntil: null }, "Cooldown removed.");
      }
      const cooldownUntil = await rateLimitService.applyCooldown(
        req.params.userId,
        body.duration ?? 900,
        body.reason,
      );
      return ok(res, { cooldownUntil: cooldownUntil.toISOString() }, "Cooldown applied.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listFlagged: (async (_req, res, next) => {
    try {
      const flagged = await rateLimitService.listFlagged();
      return ok(res, { flagged }, "Flagged users loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  resolveFlagged: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(resolveBody, req.body);
      await rateLimitService.resolveFlag(req.params.userId, body.action, body.notes, req.user.id);
      if (body.action === "escalate_ban") {
        // Placeholder: Module 1 ban call can be wired here once an admin-facing ban service endpoint is exposed.
      }
      return ok(res, { userId: req.params.userId, action: body.action }, "Flag resolved.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listActiveUsers: (async (req, res, next) => {
    try {
      const q = parseQuery(usersQuery, req.query);
      const out = await rateLimitService.listActiveUsersUsage({
        page: q.page,
        pageSize: q.page_size,
        search: q.search,
        planSlug: q.plan_slug,
      });
      return ok(
        res,
        {
          users: out.users,
          page: q.page,
          page_size: q.page_size,
          total: out.total,
          degraded: out.degraded,
        },
        out.degraded ? "Rate limit usage unavailable (Redis degraded)." : "Active rate limit usage loaded.",
      );
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  resetWindow: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(resetWindowBody, req.body);
      await rateLimitService.resetWindow(req.params.userId, body.window, req.user.id, body.reason);
      return ok(res, { userId: req.params.userId, window: body.window }, "Rate limit window reset.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,
};

export const ratelimitsAdminGuard = requireAdmin;
