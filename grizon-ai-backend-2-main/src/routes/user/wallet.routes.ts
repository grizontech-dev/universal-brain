import { Router } from "express";

import { walletController } from "../../controllers/user/wallet.controller.js";

export const walletUserRoutes = Router();

walletUserRoutes.get("/", walletController.getWallet);
walletUserRoutes.get("/transactions", walletController.listTransactions);
walletUserRoutes.get("/transactions/:id", walletController.getTransactionById);
// Topup moved to POST /api/v1/payment/topup (PhonePe v2).
walletUserRoutes.post("/topup", (_req, res) => {
  res.status(301).json({
    success: false,
    code: "MOVED",
    message: "This endpoint has moved to POST /api/v1/payment/topup",
    location: "/api/v1/payment/topup",
  });
});
