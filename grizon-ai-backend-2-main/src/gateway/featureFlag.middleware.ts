import type { RequestHandler } from "express";

/** Reserved pipeline slot for module-level feature gate hooks. */
export const featureFlagMiddleware: RequestHandler = (_req, _res, next) => {
  next();
};
