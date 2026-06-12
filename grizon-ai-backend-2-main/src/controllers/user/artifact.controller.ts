import type { RequestHandler } from "express";
import { z } from "zod";

import { artifactService } from "../../services/artifact.service.js";
import { getArtifactStorage } from "../../artifacts/artifact.storage.js";
import { buildFilename, sanitizeTitle, specForArtifactType } from "../../artifacts/fileKinds.js";
import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { created, ok } from "../../utils/response.js";

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
});

const forkBody = z.object({
  title: z.string().min(1).max(240).optional(),
  contentText: z.string().max(200000).optional(),
});

export const artifactController = {
  list: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      const artifacts = await artifactService.listLatest(req.user.id, q.limit);
      return ok(res, { artifacts }, "Artifacts loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  getById: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const artifact = await artifactService.getById(req.user.id, req.params.id);
      return ok(res, { artifact }, "Artifact loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  listVersions: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const versions = await artifactService.listVersions(req.user.id, req.params.id);
      return ok(res, { versions }, "Artifact versions loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  fork: (async (req, res, next) => {
    try {
      if (!req.user || !req.plan) return next(Errors.notAuthenticated());
      const body = parseBody(forkBody, req.body);
      const artifact = await artifactService.fork({
        userId: req.user.id,
        id: req.params.id,
        title: body.title,
        contentText: body.contentText,
        createdByAgent: "user-fork",
        maxVersions: req.plan.limits.maxArtifactVersions,
      });
      return created(res, { artifact }, "Artifact forked.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  remove: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      await artifactService.deleteForUser(req.user.id, req.params.id);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  download: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const artifact = await artifactService.getById(req.user.id, req.params.id);

      const spec = specForArtifactType(artifact.type);
      const mime = spec?.mimeType ?? (artifact.type === "image" ? "image/png" : "application/octet-stream");
      const safeBase = sanitizeTitle(artifact.title) || "file";
      const safeName = spec
        ? buildFilename(safeBase, spec)
        : safeBase + (artifact.type === "image" ? ".png" : "");

      let buf: Buffer | null = null;

      if (artifact.storagePath) {
        // Binary artifact stored in S3/local — stream raw bytes.
        // getArtifactStorage().get() works for both storage drivers.
        buf = await getArtifactStorage().get(artifact.storagePath);
      } else if (artifact.contentText) {
        // Text-only artifact (inline markdown, short CSV, etc.)
        buf = Buffer.from(artifact.contentText, "utf-8");
      }

      if (!buf) return next(Errors.artifactNotFound());

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("Content-Length", buf.byteLength);
      res.setHeader("Cache-Control", "private, no-cache");
      return res.send(buf);
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
