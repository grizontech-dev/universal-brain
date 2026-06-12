import { Router } from "express";

import { requireAdmin } from "../../gateway/admin.middleware.js";
import { queuesController } from "../../controllers/admin/queues.controller.js";

export const queuesAdminRoutes = Router();

queuesAdminRoutes.get("/system/queues", requireAdmin, queuesController.getSnapshot);
queuesAdminRoutes.post("/system/queues/:name/retry-failed", requireAdmin, queuesController.retryFailed);
