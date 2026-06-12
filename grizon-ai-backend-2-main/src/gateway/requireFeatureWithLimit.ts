import type { RequestHandler } from "express";

import { checkAndIncrement } from "../services/featureLimit.service.js";
import type { FeatureName } from "../types/feature.js";
import { logger } from "../utils/logger.js";
import { Errors } from "../utils/errors.js";

export const requireFeatureWithLimit = (feature: FeatureName): RequestHandler => {
  return async (req, res, next) => {
    try {
      if (!req.plan) {
        return next(Errors.internal("plan_not_loaded"));
      }
      if (!req.user?.id) {
        return next(Errors.internal("user_not_loaded"));
      }
      if (!req.plan.featureFlags[feature]) {
        return next(Errors.featureNotAvailable(feature));
      }

      const limits = req.plan.featureLimits?.[feature];
      if (limits === null) {
        return next(Errors.featureNotAvailable(feature));
      }

      const result = await checkAndIncrement(req.user.id, feature, req.plan.featureLimits);
      if (result.allowed) {
        if (result.degraded) {
          logger.warn(
            {
              event: "feature_limit_redis_unavailable",
              feature,
              userId: req.user?.id,
              req_id: req.id,
            },
            "feature limit checks degraded",
          );
        }
        for (const header of result.headers) {
          res.setHeader(header.key, header.value);
        }
        return next();
      }

      return next(
        Errors.featureLimitExceeded({
          feature: result.denial.feature,
          window: result.denial.window,
          limit: result.denial.limit,
          used: result.denial.used,
          resetAt: result.denial.resetAt,
        }),
      );
    } catch (error) {
      return next(error);
    }
  };
};
