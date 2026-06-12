import { Router } from "express";

import { fileController } from "../../controllers/user/file.controller.js";
import { requireFeature } from "../../gateway/requireFeature.js";

export const fileUserRoutes = Router();

fileUserRoutes.post("/files/upload", requireFeature("fileUpload"), fileController.upload);
fileUserRoutes.get("/files/:id", requireFeature("fileUpload"), fileController.status);
fileUserRoutes.get("/files/:id/download", requireFeature("fileUpload"), fileController.download);
fileUserRoutes.delete("/files/:id", requireFeature("fileUpload"), fileController.remove);
