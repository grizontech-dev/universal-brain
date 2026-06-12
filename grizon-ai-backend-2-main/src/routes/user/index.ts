import { Router } from "express";

import { AppError } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";
import { authRoutes } from "./auth.routes.js";
import { mountPlanUserRoutes } from "./plan.routes.js";
import { chatUserRoutes } from "./chat.routes.js";
import { usageUserRoutes } from "./usage.routes.js";
import { walletUserRoutes } from "./wallet.routes.js";
import { conversationUserRoutes } from "./conversation.routes.js";
import { fileUserRoutes } from "./file.routes.js";
import { artifactUserRoutes } from "./artifact.routes.js";
import { catalogueUserRoutes } from "./catalogue.routes.js";
import { memoryUserRoutes } from "./memory.routes.js";
import { paymentUserRoutes } from "./payment.routes.js";

export const userRoutes = Router();

userRoutes.get("/ping", (_req, res) => {
  ok(res, { pong: true }, "Pong.");
});

mountPlanUserRoutes(userRoutes);
userRoutes.use("/chat", chatUserRoutes);
userRoutes.use("/wallet", walletUserRoutes);
userRoutes.use("/usage", usageUserRoutes);
userRoutes.use(catalogueUserRoutes);
userRoutes.use(conversationUserRoutes);
userRoutes.use(fileUserRoutes);
userRoutes.use(artifactUserRoutes);
userRoutes.use("/memory", memoryUserRoutes);
userRoutes.use(paymentUserRoutes);

userRoutes.use("/auth", authRoutes);

userRoutes.get("/error", () => {
  throw new AppError({
    status: 400,
    code: "VALIDATION_FAILED",
    message: "Please fix the highlighted fields.",
    details: {
      fields: [{ path: "example", code: "INVALID_VALUE", message: "Example validation failure." }],
    },
  });
});
