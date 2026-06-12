import { Router } from "express";
import { phonePeWebhookController } from "../../controllers/webhook/phonepe.webhook.controller.js";

export const phonePeWebhookRouter = Router();

phonePeWebhookRouter.post("/webhook", phonePeWebhookController);
