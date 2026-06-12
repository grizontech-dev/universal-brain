import type { RequestHandler } from "express";
import { z } from "zod";

import { auditService } from "../../services/audit.service.js";
import { conversationService } from "../../services/conversation.service.js";
import { Errors, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";

const listQuery = z.object({
  status: z.enum(["active", "archived"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

const listAllQuery = z.object({
  status:    z.enum(["active", "archived"]).optional(),
  user_id:   z.string().uuid().optional(),
  page:      z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});

export const adminConversationsController = {
  listForUser: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      const out = await conversationService.listForAdmin({
        targetUserId: req.params.id,
        status: q.status,
        cursor: q.cursor,
        limit: q.limit,
      });
      await auditService.record({
        eventType: "admin_viewed_conversations",
        userId: req.params.id,
        actorId: req.user.id,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
        fingerprint: req.session?.fingerprint ?? null,
        success: true,
        metadata: { cursor: q.cursor ?? null, limit: q.limit, status: q.status ?? null },
      });
      return ok(res, { conversations: out.items, nextCursor: out.nextCursor, hasMore: out.hasMore }, "Conversations loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  listAll: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listAllQuery, req.query);
      const out = await conversationService.listAllForAdmin({
        userId:   q.user_id,
        status:   q.status,
        page:     q.page,
        pageSize: q.page_size,
      });
      return ok(res, { conversations: out.items, pagination: out.pagination }, "All conversations loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
