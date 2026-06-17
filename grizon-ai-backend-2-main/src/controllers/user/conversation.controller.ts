import type { RequestHandler } from "express";
import { z } from "zod";

import { conversationService } from "../../services/conversation.service.js";
import { fileService } from "../../services/file.service.js";
import { messageService } from "../../services/message.service.js";
import { artifactService } from "../../services/artifact.service.js";
import { buildFilename, sanitizeTitle, specForArtifactType } from "../../artifacts/fileKinds.js";
import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { created, ok } from "../../utils/response.js";
import type { ArtifactMeta } from "../../types/conversation.js";

const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

const createBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  defaultAgentSlug: z.string().nullable().optional(),
  defaultModelId: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

const patchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export const conversationController = {
  list: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      const out = await conversationService.list({
        userId: req.user.id,
        status: "active",
        cursor: q.cursor,
        limit: q.limit,
      });
      return ok(
        res,
        out.items,
        "Conversations loaded.",
        { pagination: { page: 1, page_size: q.limit, total: out.items.length, total_pages: 1 } },
      );
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  create: (async (req, res, next) => {
    try {
      if (!req.user || !req.platform || !req.plan) return next(Errors.notAuthenticated());
      const body = parseBody(createBody, req.body);
      const conversation = await conversationService.create({
        userId: req.user.id,
        platform: req.platform,
        title: body.title,
        defaultAgentSlug: body.defaultAgentSlug,
        defaultModelId: body.defaultModelId,
        tags: body.tags,
      });
      return created(res, { conversation }, "Conversation created.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  getById: (async (req, res, next) => {
    try {
      if (!req.user || !req.plan) return next(Errors.notAuthenticated());
      const conversation = await conversationService.getById(req.user.id, req.params.id);
      const messages = await messageService.listForConversation({
        userId: req.user.id,
        conversationId: req.params.id,
        limit: req.plan.limits.maxContextMessages,
      });

      const allFileIds = [...new Set(messages.items.flatMap((m) => m.attachedFileIds))];
      const filesById = new Map(
        (await fileService.getManyByIds(req.user.id, allFileIds)).map((f) => [f.id, f]),
      );

      // Artifact enrichment — same pattern as attachedFiles above.
      // Artifacts are linked to messages via artifacts.message_id (already set by file_gen tool).
      const allMessageIds = messages.items.map((m) => m.id);
      const artifactList = await artifactService.listByMessageIds(req.user.id, allMessageIds);
      const artifactsByMessageId = new Map<string, ArtifactMeta[]>();
      for (const a of artifactList) {
        if (!a.messageId) continue;
        const bucket = artifactsByMessageId.get(a.messageId) ?? [];
        const spec = specForArtifactType(a.type);
        const safeBase = sanitizeTitle(a.title) || "file";
        const filename = spec
          ? buildFilename(safeBase, spec)
          : safeBase + (a.type === "image" ? ".png" : "");
        const extension = spec?.extension ?? (a.type === "image" ? ".png" : "");
        const mimeType = spec?.mimeType ?? (a.type === "image" ? "image/png" : "application/octet-stream");
        bucket.push({
          id: a.id,
          title: a.title,
          type: a.type,
          filename,
          extension,
          mimeType,
          versionNumber: a.versionNumber,
          isLatest: a.isLatest,
          fileSize: a.fileSize,
          createdAt: a.createdAt,
        });
        artifactsByMessageId.set(a.messageId, bucket);
      }

      const enrichedMessages = messages.items.map((m) => ({
        ...m,
        attachedFiles: m.attachedFileIds.map((id) => filesById.get(id)).filter(Boolean),
        artifacts: artifactsByMessageId.get(m.id) ?? [],
      }));

      const summary = conversation.summaryText
        ? {
            text: conversation.summaryText,
            coversUpToMessageId: conversation.summarisedUpToMsgId,
          }
        : null;
      return ok(res, { conversation, messages: enrichedMessages, summary }, "Conversation loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  patch: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(patchBody, req.body);
      const conversation = await conversationService.patch(req.user.id, req.params.id, body);
      return ok(res, { conversation }, "Conversation updated.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  remove: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      await conversationService.archive(req.user.id, req.params.id);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  summarise: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const out = await conversationService.enqueueSummarise(req.user.id, req.params.id);
      return res.status(202).json({
        success: true,
        message: "Summarise job queued.",
        data: out,
      });
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  listMessages: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      const out = await messageService.listForConversation({
        userId: req.user.id,
        conversationId: req.params.id,
        limit: q.limit,
        cursor: q.cursor,
      });
      return ok(res, out.items, "Messages loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  getMessageCostBreakdown: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const breakdown = await messageService.getCostBreakdown(req.user.id, req.params.messageId);
      return ok(res, breakdown, "Cost breakdown loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  listArtifacts: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      await conversationService.getById(req.user.id, req.params.id);
      const artifacts = await artifactService.listByConversationId(req.user.id, req.params.id, q.limit);
      return ok(res, { artifacts }, "Artifacts loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  listFiles: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      await conversationService.getById(req.user.id, req.params.id);
      const files = await fileService.listByConversationId(req.user.id, req.params.id, q.limit);
      return ok(res, { files }, "Files loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
