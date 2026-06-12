import { Router } from "express";

import { walletsAdminController } from "../../controllers/admin/wallets.controller.js";
import { requireAdmin } from "../../gateway/admin.middleware.js";

export const walletsAdminRoutes = Router();

walletsAdminRoutes.post("/users/:id/wallet", requireAdmin, walletsAdminController.adjustWallet);
walletsAdminRoutes.get("/wallets", requireAdmin, walletsAdminController.listWallets);
