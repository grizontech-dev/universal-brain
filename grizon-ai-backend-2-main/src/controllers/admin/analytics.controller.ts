import type { RequestHandler } from "express";
import { z } from "zod";

import { requireAdmin } from "../../gateway/admin.middleware.js";
import { analyticsService } from "../../services/analytics.service.js";
import { getJourney, listUserJourneys, listConversationJourneys, listAllJourneys } from "../../services/messageJourney.service.js";
import { getPromptCapture, listPromptCaptures } from "../../services/promptCapture.service.js";
import { getRouterCapture, listRouterCaptures } from "../../services/routerCapture.service.js";
import type { RouterComponent, RouterCaptureStatus } from "../../services/routerCapture.service.js";
import { getPool } from "../../db/pool.js";
import { parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";
import { deriveToolInvocationMode } from "../../utils/toolInvocationMode.js";

const windowQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const usersQuery = z.object({
  sort: z.enum(["requests_desc", "credits_desc"]).default("requests_desc"),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const cacheRoiQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const analyticsAdminController = {
  getOverview: (async (req, res, next) => {
    try {
      const q = parseQuery(windowQuery, req.query);
      const overview = await analyticsService.getOverview(q.from, q.to);
      return ok(res, { overview }, "Overview loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getUsers: (async (req, res, next) => {
    try {
      const q = parseQuery(usersQuery, req.query);
      const users = await analyticsService.getTopUsers(q.sort, q.limit);
      return ok(res, { users, sort: q.sort, limit: q.limit }, "Top users loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getModels: (async (_req, res, next) => {
    try {
      const models = await analyticsService.getModelDistribution();
      return ok(res, { models }, "Model distribution loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getCostsOverview: (async (_req, res, next) => {
    try {
      const overview = await analyticsService.getCostsOverview();
      return ok(res, overview, "Cost overview loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getCostsByModel: (async (_req, res, next) => {
    try {
      const models = await analyticsService.getCostsByModel();
      return ok(res, models, "Costs by model loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getCostsByAgent: (async (_req, res, next) => {
    try {
      const agents = await analyticsService.getCostsByAgent();
      return ok(res, agents, "Costs by agent loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getCacheRoi: (async (req, res, next) => {
    try {
      const q = parseQuery(cacheRoiQuery, req.query);
      const to = new Date();
      const from = new Date(to.getTime() - q.days * 86_400_000);
      const data = await analyticsService.getCacheRoi({ from, to });
      return ok(res, data, "Cache ROI loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getLiveMetrics: (async (_req, res, next) => {
    try {
      const data = await analyticsService.getLiveMetrics();
      return ok(res, data, "Live metrics loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getErrors: (async (req, res, next) => {
    try {
      const q = parseQuery(windowQuery, req.query);
      const errors = await analyticsService.getErrors(q.from, q.to);
      return ok(res, { errors }, "Error analytics loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getRatelimits: (async (req, res, next) => {
    try {
      const q = parseQuery(windowQuery, req.query);
      const ratelimits = await analyticsService.getRatelimits(q.from, q.to);
      return ok(res, { ratelimits }, "Rate limit analytics loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getToolInvocations: (async (req, res, next) => {
    try {
      const q = parseQuery(
        z.object({
          page:      z.coerce.number().int().positive().default(1),
          page_size: z.coerce.number().int().positive().max(200).default(50),
          tool_name: z.string().optional(),
          status:    z.enum(["success", "error", "timeout"]).optional(),
          user_id:   z.string().uuid().optional(),
          from:      z.string().datetime().optional(),
          to:        z.string().datetime().optional(),
        }),
        req.query,
      );

      const pool = getPool();
      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (q.tool_name) { conditions.push(`tool_name = $${idx++}`); values.push(q.tool_name); }
      if (q.status)    { conditions.push(`status = $${idx++}`);    values.push(q.status); }
      if (q.user_id)   { conditions.push(`user_id = $${idx++}`);   values.push(q.user_id); }
      if (q.from)      { conditions.push(`created_at >= $${idx++}::timestamptz`); values.push(q.from); }
      if (q.to)        { conditions.push(`created_at <= $${idx++}::timestamptz`); values.push(q.to); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const offset = (q.page - 1) * q.page_size;

      const [rowsRes, countRes] = await Promise.all([
        pool.query(
          `SELECT id, trace_id, call_id, user_id, conversation_id, message_id,
                  agent_slug, model_id, tool_name, status, error_message,
                  duration_ms, started_at, created_at,
                  request_args, response_output
           FROM tool_invocations
           ${where}
           ORDER BY created_at DESC
           LIMIT $${idx++} OFFSET $${idx++}`,
          [...values, q.page_size, offset],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM tool_invocations ${where}`,
          values,
        ),
      ]);

      const total = Number((countRes.rows[0] as { total: number }).total);
      type ToolInvRow = {
        tool_name: string;
        response_output: unknown;
        request_args?: unknown;
        [key: string]: unknown;
      };
      const items = (rowsRes.rows as ToolInvRow[]).map((row) => ({
        ...row,
        tool_mode: deriveToolInvocationMode({
          tool_name: row.tool_name,
          response_output: row.response_output,
          request_args: row.request_args,
        }),
      }));
      return ok(res, {
        items,
        pagination: { page: q.page, page_size: q.page_size, total, total_pages: Math.ceil(total / q.page_size) },
      }, "Tool invocations loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getJourneyByTrace: (async (req, res, next) => {
    try {
      const { traceId } = req.params as { traceId: string };
      const journey = await getJourney(traceId);
      if (!journey) {
        return ok(res, null, "Journey not found (may have expired).");
      }
      return ok(res, journey, "Journey loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listAllJourneys: (async (req, res, next) => {
    try {
      const q = parseQuery(
        z.object({ limit: z.coerce.number().int().positive().max(200).default(50) }),
        req.query,
      );
      const journeys = await listAllJourneys(q.limit);
      return ok(res, { journeys, total: journeys.length }, "All recent journeys loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listJourneys: (async (req, res, next) => {
    try {
      const q = parseQuery(
        z.object({
          user_id:         z.string().uuid().optional(),
          conversation_id: z.string().uuid().optional(),
          limit:           z.coerce.number().int().positive().max(200).default(50),
        }),
        req.query,
      );
      let traceIds: string[] = [];
      if (q.user_id) {
        traceIds = await listUserJourneys(q.user_id, q.limit);
      } else if (q.conversation_id) {
        traceIds = await listConversationJourneys(q.conversation_id, q.limit);
      }
      return ok(res, { trace_ids: traceIds, total: traceIds.length }, "Journey index loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listPromptCaptures: (async (req, res, next) => {
    try {
      const q = parseQuery(
        z.object({
          user_id: z.string().uuid().optional(),
          conversation_id: z.string().uuid().optional(),
          limit: z.coerce.number().int().positive().max(200).default(50),
        }),
        req.query,
      );
      const items = await listPromptCaptures({
        userId: q.user_id,
        conversationId: q.conversation_id,
        limit: q.limit,
      });
      return ok(res, { items, total: items.length }, "Prompt captures loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getPromptCapture: (async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const capture = await getPromptCapture(id);
      if (!capture) {
        return ok(res, null, "Prompt capture not found (may have expired).");
      }
      return ok(res, capture, "Prompt capture loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listRouterCaptures: (async (req, res, next) => {
    try {
      const q = parseQuery(
        z.object({
          component: z.enum(["classifier", "rewriter", "search_planner"]).optional(),
          source:    z.string().optional(),
          user_id:   z.string().uuid().optional(),
          status:    z.enum(["completed", "skipped", "error", "timeout"]).optional(),
          from:      z.string().datetime().optional(),
          to:        z.string().datetime().optional(),
          page:      z.coerce.number().int().positive().default(1),
          page_size: z.coerce.number().int().positive().max(200).default(50),
        }),
        req.query,
      );
      const { items, total } = await listRouterCaptures({
        component: q.component as RouterComponent | undefined,
        source:    q.source,
        userId:    q.user_id,
        status:    q.status as RouterCaptureStatus | undefined,
        from:      q.from,
        to:        q.to,
        page:      q.page,
        pageSize:  q.page_size,
      });
      return ok(res, {
        items,
        pagination: { page: q.page, page_size: q.page_size, total, total_pages: Math.ceil(total / q.page_size) },
      }, "Router captures loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getRouterCapture: (async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const capture = await getRouterCapture(id);
      if (!capture) {
        return ok(res, null, "Router capture not found (may have expired from Redis).");
      }
      return ok(res, capture, "Router capture loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,
};

export const analyticsAdminGuard = requireAdmin;
