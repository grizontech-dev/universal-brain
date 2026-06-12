import { Router } from "express";

import { memoryController } from "../../controllers/user/memory.controller.js";

export const memoryUserRoutes = Router();

memoryUserRoutes.get("/", memoryController.listFacts);
memoryUserRoutes.delete("/:id", memoryController.deleteFact);
memoryUserRoutes.delete("/", memoryController.purgeAllFacts);
