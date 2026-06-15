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

rootRouter.get("/debug/memory", (_req, res) => {
  const mem = process.memoryUsage();
  ok(res, {
    process: {
      rss: `${Math.round(mem.rss / 1024 / 1024 * 100) / 100} MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100} MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100} MB`,
      external: `${Math.round(mem.external / 1024 / 1024 * 100) / 100} MB`,
      arrayBuffers: `${Math.round(mem.arrayBuffers / 1024 / 1024 * 100) / 100} MB`,
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    }
  }, "Memory stats retrieved successfully.");
});

// Payment webhooks — no auth middleware, verified by HMAC internally
rootRouter.use("/payments", phonePeWebhookRouter);

rootRouter.use("/api/v1", userRoutes);
rootRouter.use("/api/v1/admin", adminRoutes);
