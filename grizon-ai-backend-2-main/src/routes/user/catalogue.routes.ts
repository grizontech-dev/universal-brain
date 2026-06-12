import { Router } from "express";

import { catalogueService } from "../../services/catalogue.service.js";
import { Errors } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";

export const catalogueUserRoutes = Router();

catalogueUserRoutes.get("/catalogue", async (req, res, next) => {
  try {
    if (!req.user || !req.plan) return next(Errors.notAuthenticated());
    const catalogue = await catalogueService.getCatalogue(req.plan);
    return ok(res, catalogue, "Catalogue loaded.");
  } catch (error) {
    return next(error);
  }
});

catalogueUserRoutes.get("/catalogue/agents/:slug", async (req, res, next) => {
  try {
    if (!req.user || !req.plan) return next(Errors.notAuthenticated());
    const agent = await catalogueService.getAgent(req.plan, req.params.slug);
    if (!agent) return next(Errors.agentNotAllowed({ agentSlug: req.params.slug, planId: req.plan.id }));
    return ok(res, { agent }, "Agent detail loaded.");
  } catch (error) {
    return next(error);
  }
});
