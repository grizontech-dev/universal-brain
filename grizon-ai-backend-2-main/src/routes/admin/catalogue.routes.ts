import { Router } from "express";
import { z } from "zod";

import { getPool } from "../../db/pool.js";
import { requireAdmin } from "../../gateway/admin.middleware.js";
import { reloadAgentCache } from "../../services/agentLoader.service.js";
import { catalogueAdminService } from "../../services/catalogueAdmin.service.js";
import { providerCatalogueService } from "../../services/providerCatalogue.service.js";
import { AppError, parseBody } from "../../utils/errors.js";
import { created, ok } from "../../utils/response.js";

const providerCreateBody = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  iconUrl: z.string().nullable().optional(),
  apiBaseUrl: z.string().min(1),
  envKeyName: z.string().min(1),
  isKeyPresent: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
const providerPatch = z.record(z.string(), z.unknown());
const modelImportBody = z.object({ models: z.array(z.record(z.string(), z.unknown())) });
const modelCreateBody = z.object({
  modelId: z.string().min(1, "modelId is required"),
  provider: z.string().optional(),
  providerId: z.string().uuid().nullable().optional(),
  displayName: z.string().min(1, "displayName is required"),
  tier: z.string().min(1),
  creditRate: z.number(),
  contextWindow: z.number().nullable().optional(),
  maxOutputTokens: z.number().nullable().optional(),
  inputCostPer1k: z.number().optional(),
  outputCostPer1k: z.number().optional(),
  inputCachedCostPer1k: z.number().nullable().optional(),
  capabilities: z.array(z.string()).optional(),
  iconUrl: z.string().nullable().optional(),
  shortDescription: z.string().optional(),
  longDescription: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  healthStatus: z.string().optional(),
  sortOrder: z.number().int().optional(),
});
const modelPatchBody = z.record(z.string(), z.unknown());
const categoryCreateBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  iconUrl: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
const categoryPatchBody = z.record(z.string(), z.unknown());
const agentCreateBody = z.record(z.string(), z.unknown());
const agentPatchBody = z.record(z.string(), z.unknown());
const priorityCreateBody = z.object({
  modelId: z.string().min(1),
  priority: z.number().int().positive(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
const priorityPatchBody = z.record(z.string(), z.unknown());
const reorderBody = z.object({
  priorities: z.array(z.object({ id: z.string().uuid(), priority: z.number().int().positive() })),
});
const systemTierBody = z.object({ models: z.array(z.unknown()) });

export const catalogueAdminRoutes = Router();

catalogueAdminRoutes.get("/providers", requireAdmin, async (_req, res, next) => {
  try {
    return ok(res, { providers: await catalogueAdminService.listProviders() }, "Providers loaded.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/providers", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(providerCreateBody, req.body);
    const provider = await catalogueAdminService.createProvider(body);
    return created(res, { provider }, "Provider created.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.patch("/providers/:id", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(providerPatch, req.body);
    const provider = await catalogueAdminService.patchProvider(req.params.id, body);
    return ok(res, { provider }, "Provider updated.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.delete("/providers/:id", requireAdmin, async (req, res, next) => {
  try {
    await catalogueAdminService.deleteProvider(req.params.id);
    return ok(res, { deleted: true }, "Provider deleted.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/providers/:id/fetch-models", requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool();
    const providerRes = await pool.query(
      `SELECT id, slug, api_base_url, env_key_name, is_key_present, is_active
       FROM providers WHERE id = $1`,
      [req.params.id],
    );
    const provider = providerRes.rows[0];
    if (!provider) {
      throw new AppError({
        status: 404,
        code: "PROVIDER_NOT_FOUND",
        message: "Provider not found.",
      });
    }

    const apiKey = process.env[provider.env_key_name]?.trim();
    if (!apiKey || !provider.is_key_present) {
      throw new AppError({
        status: 422,
        code: "PROVIDER_API_KEY_MISSING",
        message: `API key (${provider.env_key_name}) is not configured for provider "${provider.slug}".`,
      });
    }

    const fetched = await providerCatalogueService.listProviderModels(
      provider.slug,
      apiKey,
      provider.api_base_url,
    );

    const existingRes = await pool.query(`SELECT model_id FROM ai_models`);
    const existing = new Set<string>(existingRes.rows.map((r: { model_id: string }) => r.model_id));
    const missing = fetched.filter((m) => !existing.has(m.modelId));

    return ok(
      res,
      {
        providerId: provider.id,
        providerSlug: provider.slug,
        fetched,
        missing,
      },
      "Provider models fetched.",
    );
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.get("/models", requireAdmin, async (_req, res, next) => {
  try {
    return ok(res, { models: await catalogueAdminService.listModels() }, "Models loaded.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/models/import", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(modelImportBody, req.body);
    const models = await catalogueAdminService.importModels(body.models);
    return created(res, { models }, "Models imported.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/models", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(modelCreateBody, req.body);
    const models = await catalogueAdminService.importModels([body]);
    return created(res, { model: models[0] ?? null }, "Model created.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.patch("/models/:id", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(modelPatchBody, req.body);
    const model = await catalogueAdminService.patchModel(req.params.id, body);
    return ok(res, { model }, "Model updated.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.delete("/models/:id", requireAdmin, async (req, res, next) => {
  try {
    await catalogueAdminService.deleteModel(req.params.id);
    return ok(res, { deleted: true }, "Model deleted.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.get("/agent-categories", requireAdmin, async (_req, res, next) => {
  try {
    return ok(res, { categories: await catalogueAdminService.listCategories() }, "Agent categories loaded.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/agent-categories", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(categoryCreateBody, req.body);
    const category = await catalogueAdminService.createCategory(body);
    return created(res, { category }, "Agent category created.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.patch("/agent-categories/:id", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(categoryPatchBody, req.body);
    const category = await catalogueAdminService.patchCategory(req.params.id, body);
    return ok(res, { category }, "Agent category updated.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.get("/agents", requireAdmin, async (_req, res, next) => {
  try {
    return ok(res, { agents: await catalogueAdminService.listAgents() }, "Agents loaded.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/agents", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(agentCreateBody, req.body);
    const agent = await catalogueAdminService.createAgent(body);
    void reloadAgentCache(); // refresh in-memory cache immediately (fire-and-forget)
    return created(res, { agent }, "Agent created.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.patch("/agents/:id", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(agentPatchBody, req.body);
    const agent = await catalogueAdminService.patchAgent(req.params.id, body);
    void reloadAgentCache();
    return ok(res, { agent }, "Agent updated.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.delete("/agents/:id", requireAdmin, async (req, res, next) => {
  try {
    const agent = await catalogueAdminService.patchAgent(req.params.id, { isActive: false });
    void reloadAgentCache();
    return ok(res, { agent }, "Agent archived.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.get("/agents/:id/model-priorities", requireAdmin, async (req, res, next) => {
  try {
    const priorities = await catalogueAdminService.listAgentModelPriorities(req.params.id);
    return ok(res, { priorities }, "Agent model priorities loaded.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/agents/:id/model-priorities", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(priorityCreateBody, req.body);
    const priority = await catalogueAdminService.createAgentModelPriority(req.params.id, body);
    void reloadAgentCache();
    return created(res, { priority }, "Agent model priority created.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.patch("/agents/:id/model-priorities/:pid", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(priorityPatchBody, req.body);
    const priority = await catalogueAdminService.patchAgentModelPriority(req.params.id, req.params.pid, body);
    void reloadAgentCache();
    return ok(res, { priority }, "Agent model priority updated.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.delete("/agents/:id/model-priorities/:pid", requireAdmin, async (req, res, next) => {
  try {
    await catalogueAdminService.deleteAgentModelPriority(req.params.id, req.params.pid);
    void reloadAgentCache();
    return ok(res, { deleted: true }, "Agent model priority deleted.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.post("/agents/:id/model-priorities/reorder", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(reorderBody, req.body);
    await catalogueAdminService.reorderAgentModelPriorities(req.params.id, body.priorities);
    void reloadAgentCache();
    return ok(res, { reordered: true }, "Agent model priorities reordered.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.get("/system-model-config", requireAdmin, async (_req, res, next) => {
  try {
    return ok(res, { tiers: await catalogueAdminService.getSystemModelConfig() }, "System model config loaded.");
  } catch (error) {
    return next(error);
  }
});

catalogueAdminRoutes.patch("/system-model-config/:tier", requireAdmin, async (req, res, next) => {
  try {
    const body = parseBody(systemTierBody, req.body);
    const tier = req.params.tier as "light" | "medium" | "high";
    const config = await catalogueAdminService.patchSystemModelTier(tier, body.models);
    return ok(res, { config }, "System model config updated.");
  } catch (error) {
    return next(error);
  }
});
