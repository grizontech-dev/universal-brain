import { Router } from "express";

import { adminConversationsController } from "../../controllers/admin/conversations.controller.js";
import { requireAdmin } from "../../gateway/admin.middleware.js";

export const conversationsAdminRoutes = Router();

conversationsAdminRoutes.get("/conversations", requireAdmin, adminConversationsController.listAll);
conversationsAdminRoutes.get("/users/:id/conversations", requireAdmin, adminConversationsController.listForUser);
