import { Router } from "express";

import { ratelimitsAdminController, ratelimitsAdminGuard } from "../../controllers/admin/ratelimits.controller.js";

export const rateLimitsAdminRoutes = Router();

rateLimitsAdminRoutes.get("/ratelimits/events", ratelimitsAdminGuard, ratelimitsAdminController.getEvents);
rateLimitsAdminRoutes.get("/ratelimits/users", ratelimitsAdminGuard, ratelimitsAdminController.listActiveUsers);
rateLimitsAdminRoutes.post("/ratelimits/:userId/clear", ratelimitsAdminGuard, ratelimitsAdminController.clearUser);
rateLimitsAdminRoutes.post(
  "/ratelimits/:userId/reset-window",
  ratelimitsAdminGuard,
  ratelimitsAdminController.resetWindow,
);
rateLimitsAdminRoutes.post(
  "/ratelimits/:userId/cooldown",
  ratelimitsAdminGuard,
  ratelimitsAdminController.setCooldown,
);
rateLimitsAdminRoutes.get("/ratelimits/flagged", ratelimitsAdminGuard, ratelimitsAdminController.listFlagged);
rateLimitsAdminRoutes.patch(
  "/ratelimits/flagged/:userId",
  ratelimitsAdminGuard,
  ratelimitsAdminController.resolveFlagged,
);
