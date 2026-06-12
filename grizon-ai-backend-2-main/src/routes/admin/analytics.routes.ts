import { Router } from "express";

import {
  analyticsAdminController,
  analyticsAdminGuard,
} from "../../controllers/admin/analytics.controller.js";

export const analyticsAdminRoutes = Router();

analyticsAdminRoutes.get("/analytics/overview", analyticsAdminGuard, analyticsAdminController.getOverview);
analyticsAdminRoutes.get("/analytics/users", analyticsAdminGuard, analyticsAdminController.getUsers);
analyticsAdminRoutes.get("/analytics/models", analyticsAdminGuard, analyticsAdminController.getModels);
analyticsAdminRoutes.get("/analytics/costs/overview", analyticsAdminGuard, analyticsAdminController.getCostsOverview);
analyticsAdminRoutes.get("/analytics/costs/by-model", analyticsAdminGuard, analyticsAdminController.getCostsByModel);
analyticsAdminRoutes.get("/analytics/costs/by-agent", analyticsAdminGuard, analyticsAdminController.getCostsByAgent);
analyticsAdminRoutes.get("/analytics/costs/cache-roi", analyticsAdminGuard, analyticsAdminController.getCacheRoi);
analyticsAdminRoutes.get("/analytics/live", analyticsAdminGuard, analyticsAdminController.getLiveMetrics);
analyticsAdminRoutes.get("/analytics/errors", analyticsAdminGuard, analyticsAdminController.getErrors);
analyticsAdminRoutes.get("/analytics/ratelimits", analyticsAdminGuard, analyticsAdminController.getRatelimits);
analyticsAdminRoutes.get("/analytics/tool-invocations", analyticsAdminGuard, analyticsAdminController.getToolInvocations);
analyticsAdminRoutes.get("/analytics/journeys", analyticsAdminGuard, analyticsAdminController.listJourneys);
analyticsAdminRoutes.get("/analytics/journeys/all", analyticsAdminGuard, analyticsAdminController.listAllJourneys);
analyticsAdminRoutes.get("/analytics/journeys/:traceId", analyticsAdminGuard, analyticsAdminController.getJourneyByTrace);
analyticsAdminRoutes.get("/analytics/prompt-captures", analyticsAdminGuard, analyticsAdminController.listPromptCaptures);
analyticsAdminRoutes.get("/analytics/prompt-captures/:id", analyticsAdminGuard, analyticsAdminController.getPromptCapture);
analyticsAdminRoutes.get("/analytics/router-captures", analyticsAdminGuard, analyticsAdminController.listRouterCaptures);
analyticsAdminRoutes.get("/analytics/router-captures/:id", analyticsAdminGuard, analyticsAdminController.getRouterCapture);
