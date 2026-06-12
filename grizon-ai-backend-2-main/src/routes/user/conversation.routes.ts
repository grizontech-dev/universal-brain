import { Router } from "express";

import { conversationController } from "../../controllers/user/conversation.controller.js";

export const conversationUserRoutes = Router();

conversationUserRoutes.get("/conversations", conversationController.list);
conversationUserRoutes.post("/conversations", conversationController.create);
conversationUserRoutes.get("/conversations/:id", conversationController.getById);
conversationUserRoutes.patch("/conversations/:id", conversationController.patch);
conversationUserRoutes.delete("/conversations/:id", conversationController.remove);
conversationUserRoutes.post("/conversations/:id/summarise", conversationController.summarise);
conversationUserRoutes.get("/conversations/:id/messages", conversationController.listMessages);
conversationUserRoutes.get("/conversations/:id/messages/:messageId/cost-breakdown", conversationController.getMessageCostBreakdown);
conversationUserRoutes.get("/conversations/:id/artifacts", conversationController.listArtifacts);
conversationUserRoutes.get("/conversations/:id/files", conversationController.listFiles);
