import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";

import { adminMiddleware } from "./gateway/admin.middleware.js";
import { authMiddleware } from "./gateway/auth.middleware.js";
import { corsMiddleware } from "./gateway/cors.middleware.js";
import { creditBudgetMiddleware } from "./gateway/creditBudget.middleware.js";
import { errorHandler } from "./gateway/errorHandler.middleware.js";
import { featureFlagMiddleware } from "./gateway/featureFlag.middleware.js";
import { requestLogger } from "./gateway/logger.middleware.js";
import { planMiddleware } from "./gateway/plan.middleware.js";
import { rateLimitMiddleware } from "./gateway/rateLimit.middleware.js";
import { requestId } from "./gateway/requestId.middleware.js";
import { sanitiserMiddleware } from "./gateway/sanitiser.middleware.js";
import { rootRouter } from "./routes/index.js";

export function buildApp() {
  const app = express();

  app.use(requestId);
  app.use((req, res, next) => {
    if (req.path === "/payments/webhook" || req.path === "/payments/webhook/") {
      return next();
    }

    return corsMiddleware(req, res, next);
  });
  app.use(authMiddleware);
  app.use(adminMiddleware);
  app.use(requestLogger);
  app.use(helmet());
  // Capture the raw body for /payments/webhook so the exact bytes PhonePe sent are
  // available to the handler (parsed only after signature auth passes).
  app.use("/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json({ limit: `${env.MAX_BODY_SIZE_KB}kb` }));
  app.use(planMiddleware);
  app.use(featureFlagMiddleware);
  app.use(rateLimitMiddleware);
  app.use(creditBudgetMiddleware);
  app.use(sanitiserMiddleware);
  app.use(rootRouter);
  app.use(errorHandler);

  return app;
}
