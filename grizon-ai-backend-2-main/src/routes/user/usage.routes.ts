import { Router } from "express";

import { usageController } from "../../controllers/user/usage.controller.js";

export const usageUserRoutes = Router();

usageUserRoutes.get("/summary", usageController.getSummary);
usageUserRoutes.get("/history", usageController.getHistory);
usageUserRoutes.get("/rate-limit", usageController.getRateLimitUsage);
