import { Router } from "express";

import { analyticsAdminRoutes } from "./analytics.routes.js";
import { ok } from "../../utils/response.js";
import { authRoutes } from "./auth.routes.js";
import { planAdminRoutes } from "./plan.routes.js";
import { queuesAdminRoutes } from "./queues.routes.js";
import { rateLimitsAdminRoutes } from "./ratelimits.routes.js";
import { walletsAdminRoutes } from "./wallets.routes.js";
import { conversationsAdminRoutes } from "./conversations.routes.js";
import { catalogueAdminRoutes } from "./catalogue.routes.js";
import { systemAdminRoutes } from "./system.routes.js";
import { benchmarkAdminRoutes } from "./benchmark.routes.js";
import { paymentAdminRoutes } from "./payment.admin.routes.js";

export const adminRoutes = Router();

adminRoutes.get("/ping", (_req, res) => {
  ok(res, { pong: true }, "Admin pong.");
});

adminRoutes.use(planAdminRoutes);
adminRoutes.use(walletsAdminRoutes);
adminRoutes.use(rateLimitsAdminRoutes);
adminRoutes.use(analyticsAdminRoutes);
adminRoutes.use(queuesAdminRoutes);
adminRoutes.use(systemAdminRoutes);
adminRoutes.use(conversationsAdminRoutes);
adminRoutes.use(catalogueAdminRoutes);
adminRoutes.use(benchmarkAdminRoutes);
adminRoutes.use(paymentAdminRoutes);

adminRoutes.use("/auth", authRoutes);
