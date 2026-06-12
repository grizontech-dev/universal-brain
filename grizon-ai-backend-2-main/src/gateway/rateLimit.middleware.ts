import type { RequestHandler } from "express";
import { isSkipped } from "../config/rateLimit.js";
import { rateLimitService } from "../services/rateLimit.service.js";
import { Errors } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const rateLimitMiddleware: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user?.id || !req.plan) return next();
    if (!req.plan.limits) return next(Errors.internal("plan_limits_not_loaded"));

    const result = isSkipped(req.method, req.path)
      ? await rateLimitService.peek(req.user.id, req.plan)
      : await rateLimitService.checkAndRecord(req.user.id, req.plan);

    if (result.degraded) {
      logger.warn(
        { event: "rate_limit_redis_unavailable", userId: req.user.id, req_id: req.id },
        "rate limit checks degraded",
      );
      return next();
    }

    for (const header of result.headers ?? []) {
      res.setHeader(header.key, header.value);
    }

    if (!result.allowed) {
      if (result.deniedBy === "cooldown") {
        const retryAfterSeconds = result.retryAfterSeconds ?? 1;
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return next(
          Errors.rateLimitCooldown({
            cooldownUntil: (result.cooldownUntil ?? new Date(Date.now() + retryAfterSeconds * 1000)).toISOString(),
            retryAfterSeconds,
            reason: "cooldown_active",
          }),
        );
      }
      const retryAfterSeconds = result.retryAfterSeconds ?? 1;
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return next(
        Errors.rateLimitExceeded({
          limitType: result.limitType ?? "hourly",
          limit: result.limit ?? 0,
          resetAt: (result.resetAt ?? new Date(Date.now() + retryAfterSeconds * 1000)).toISOString(),
          retryAfterSeconds,
        }),
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
