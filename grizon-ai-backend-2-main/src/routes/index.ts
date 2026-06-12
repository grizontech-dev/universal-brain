import { Router } from "express";

import { adminRoutes } from "./admin/index.js";
import { userRoutes } from "./user/index.js";
import { phonePeWebhookRouter } from "./webhook/phonepe.routes.js";
import { ok } from "../utils/response.js";

export const rootRouter = Router();

rootRouter.get("/", (_req, res) => {
  ok(res, { service: "grizon-ai-backend-2" }, "API is running.");
});

rootRouter.get("/health", (_req, res) => {
  ok(res, { status: "ok" }, "Service is healthy.");
});

// Payment webhooks — no auth middleware, verified by HMAC internally
rootRouter.use("/payments", phonePeWebhookRouter);

rootRouter.use("/api/v1", userRoutes);
rootRouter.use("/api/v1/admin", adminRoutes);
