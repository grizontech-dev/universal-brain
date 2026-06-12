import { Router } from "express";

import { chatController } from "../../controllers/user/chat.controller.js";

export const chatUserRoutes = Router();

chatUserRoutes.post("/", chatController.enqueue);
chatUserRoutes.get("/stream/:jobId", chatController.stream);
chatUserRoutes.get("/job/:jobId", chatController.getStatus);
chatUserRoutes.post("/:conversationId/cancel", chatController.cancelLatest);
