import { Router } from "express";

import { systemController } from "../../controllers/admin/system.controller.js";
import { requireAdmin } from "../../gateway/admin.middleware.js";

export const systemAdminRoutes = Router();

systemAdminRoutes.get("/system/health", requireAdmin, systemController.getHealth);
