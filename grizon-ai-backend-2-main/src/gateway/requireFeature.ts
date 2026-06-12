import type { RequestHandler } from "express";

import type { FeatureFlags } from "../types/feature.js";
import { Errors } from "../utils/errors.js";

export const requireFeature = (flag: keyof FeatureFlags): RequestHandler => {
  return (req, _res, next) => {
    if (!req.plan) {
      return next(Errors.internal("plan_not_loaded"));
    }
    if (!req.plan.featureFlags[flag]) {
      return next(Errors.featureNotAvailable(String(flag)));
    }
    return next();
  };
};
