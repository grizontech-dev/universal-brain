import { Router } from "express";
import { paymentAdminController } from "../../controllers/admin/payment.admin.controller.js";

export const paymentAdminRoutes = Router();

paymentAdminRoutes.get("/payment/orders", paymentAdminController.listOrders);
paymentAdminRoutes.post("/payment/refund", paymentAdminController.initiateRefund);
paymentAdminRoutes.post("/payment/redemptions/notify", paymentAdminController.triggerNotify);
paymentAdminRoutes.post("/payment/redemptions/execute", paymentAdminController.triggerExecute);
paymentAdminRoutes.get("/payment/subscriptions/:merchantSubscriptionId/status", paymentAdminController.getSubscriptionStatus);
paymentAdminRoutes.post("/payment/orders/:merchantOrderId/cancel", paymentAdminController.cancelOrder);
paymentAdminRoutes.get("/payment/webhook-events", paymentAdminController.listWebhookEvents);
