import { Router } from "express";

import { artifactController } from "../../controllers/user/artifact.controller.js";
import { requireFeature } from "../../gateway/requireFeature.js";

export const artifactUserRoutes = Router();

artifactUserRoutes.get("/artifacts", requireFeature("artifactVersioning"), artifactController.list);
// /download and /versions must be registered before /:id to avoid shadowing
artifactUserRoutes.get("/artifacts/:id/download", requireFeature("artifactVersioning"), artifactController.download);
artifactUserRoutes.get(
  "/artifacts/:id/versions",
  requireFeature("artifactVersioning"),
  artifactController.listVersions,
);
artifactUserRoutes.get("/artifacts/:id", requireFeature("artifactVersioning"), artifactController.getById);
artifactUserRoutes.post("/artifacts/:id/fork", requireFeature("artifactVersioning"), artifactController.fork);
artifactUserRoutes.delete("/artifacts/:id", requireFeature("artifactVersioning"), artifactController.remove);
