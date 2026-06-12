import { Router } from "express";

import { benchmarkController } from "../../controllers/admin/benchmark.controller.js";
import { requireAdmin } from "../../gateway/admin.middleware.js";

export const benchmarkAdminRoutes = Router();

benchmarkAdminRoutes.get("/benchmark/suites", requireAdmin, benchmarkController.listSuites);
benchmarkAdminRoutes.post("/benchmark/suites", requireAdmin, benchmarkController.createSuite);
benchmarkAdminRoutes.get("/benchmark/suites/:id", requireAdmin, benchmarkController.getSuite);
benchmarkAdminRoutes.delete("/benchmark/suites/:id", requireAdmin, benchmarkController.deleteSuite);
benchmarkAdminRoutes.post("/benchmark/suites/:id/cases", requireAdmin, benchmarkController.addCase);
benchmarkAdminRoutes.post("/benchmark/suites/:id/cases/import", requireAdmin, benchmarkController.importCases);
benchmarkAdminRoutes.delete("/benchmark/cases/:caseId", requireAdmin, benchmarkController.deleteCase);
benchmarkAdminRoutes.post("/benchmark/suites/:id/runs", requireAdmin, benchmarkController.triggerRun);
benchmarkAdminRoutes.get("/benchmark/suites/:id/runs", requireAdmin, benchmarkController.getSuiteRuns);
benchmarkAdminRoutes.get("/benchmark/runs/:runId", requireAdmin, benchmarkController.getRun);
benchmarkAdminRoutes.get("/benchmark/runs/:runId/results", requireAdmin, benchmarkController.getRunResults);
benchmarkAdminRoutes.post("/benchmark/runs/:runId/cancel", requireAdmin, benchmarkController.cancelRun);
