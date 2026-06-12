import type { RequestHandler } from "express";
import { z } from "zod";

import { fileService } from "../../services/file.service.js";
import { fileQueue } from "../../queues/file.queue.js";
import { storageService } from "../../services/storage.service.js";
import { Errors, parseBody } from "../../utils/errors.js";
import { created, ok } from "../../utils/response.js";

const uploadBody = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  fileName: z.string().min(1).max(260),
  fileType: z.string().min(1).max(120),
  fileSize: z.coerce.number().int().positive(),
  contentBase64: z.string().min(1),
});

const allowedTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  // video/mp4 — disabled until video processing is implemented
];

export const fileController = {
  upload: (async (req, res, next) => {
    try {
      if (!req.user || !req.plan) return next(Errors.notAuthenticated());
      const body = parseBody(uploadBody, req.body);
      if (!allowedTypes.includes(body.fileType)) {
        return next(Errors.fileTypeNotAllowed(allowedTypes));
      }
      if (body.fileSize > req.plan.limits.maxFileSize) {
        return next(Errors.fileTooLarge(req.plan.limits.maxFileSize));
      }
      if (body.conversationId) {
        const count = await fileService.countActiveForConversation(req.user.id, body.conversationId);
        if (count >= req.plan.limits.maxFilesPerChat) {
          return next(Errors.fileLimitPerChat(req.plan.limits.maxFilesPerChat));
        }
      }
      const binary = Buffer.from(body.contentBase64, "base64");
      const stored = await storageService.write(binary, { userId: req.user.id, fileType: body.fileType });
      const file = await fileService.create({
        userId: req.user.id,
        conversationId: body.conversationId ?? null,
        fileName: body.fileName,
        fileType: body.fileType,
        fileSize: body.fileSize,
        storagePath: stored.path,
      });
      await fileQueue.add(
        "ingest",
        {
          userId: req.user.id,
          fileId: file.id,
          storagePath: file.storagePath,
          fileType: file.fileType,
          fileSize: file.fileSize,
        },
        { jobId: file.id },
      );
      return created(res, { file }, "File uploaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  status: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const file = await fileService.getByIdForUser(req.user.id, req.params.id);
      return ok(res, { file }, "File status loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  download: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const file = await fileService.getByIdForUser(req.user.id, req.params.id);
      const bytes = await storageService.readUploadedBytes(file.storagePath);
      res.setHeader("Content-Type", file.fileType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.fileName)}"`);
      res.setHeader("Content-Length", bytes.length);
      return res.send(bytes);
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  remove: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      await fileService.deleteForUser(req.user.id, req.params.id);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
