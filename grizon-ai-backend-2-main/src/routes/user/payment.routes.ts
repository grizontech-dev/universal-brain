import { Router } from "express";
import { paymentController } from "../../controllers/user/payment.controller.js";

export const paymentUserRoutes = Router();

paymentUserRoutes.post("/payment/topup", paymentController.initiateTopup);
paymentUserRoutes.get("/payment/topup/:orderId/status", paymentController.getTopupStatus);
paymentUserRoutes.post("/payment/subscription/initiate", paymentController.initiateSubscription);
paymentUserRoutes.post("/payment/subscription/cancel", paymentController.cancelSubscription);
