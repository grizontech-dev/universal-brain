import type { RequestHandler } from "express";

import { HTML_FIELDS, INJECTION_BURST_THRESHOLD, REPEAT_THRESHOLD, SKIP_ROUTES, defaultPolicy } from "../config/sanitiser.js";
import { sanitiserEvents } from "../events/sanitiser.events.js";
import { abuseCounter, sanitiserService } from "../services/sanitiser.service.js";
import { Errors } from "../utils/errors.js";

function shouldSkip(req: Parameters<RequestHandler>[0]): boolean {
  return (
    SKIP_ROUTES.has(`${req.method} ${req.path}`) ||
    req.path === "/" ||
    req.path === "/health" ||
    req.method === "OPTIONS"
  );
}

function getFiles(req: Parameters<RequestHandler>[0]) {
  if (Array.isArray(req.files)) return req.files;
  const filesBody = (req.body as Record<string, unknown> | undefined)?.files;
  return Array.isArray(filesBody) ? filesBody : [];
}

export const requireStrictInjection: RequestHandler = (_req, res, next) => {
  res.locals.injectionMode = "reject";
  return next();
};

export const sanitiserMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    if (shouldSkip(req)) return next();

    const policy = defaultPolicy({
      maxMessageLength: req.plan?.limits?.maxMessageContentLength,
      maxFileSize: req.plan?.limits?.maxFileSize,
      injectionMode: _res.locals.injectionMode ?? "strip",
    });

    const files = getFiles(req);
    for (const part of files) {
      sanitiserService.validateFilePart(part, policy);
    }

    if (req.body && typeof req.body === "object") {
      const body = req.body as Record<string, unknown>;
      const agentSlug = body.agentSlug;

      if (typeof agentSlug === "string" && agentSlug.trim()) {
        if (req.plan && !req.plan.agentAccess.includes(agentSlug)) {
          return next(Errors.agentNotAllowed({ agentSlug, planId: req.plan.id }));
        }
        const active = await sanitiserService.isAgentActive(agentSlug);
        if (!active) {
          return next(Errors.agentNotAllowed({ agentSlug, planId: req.plan?.id }));
        }
      }

      if (typeof body.content === "string") {
        sanitiserService.enforceMessageLength(body.content, policy.maxMessageLength);
        const { sanitised, patternsMatched } = sanitiserService.stripPromptInjection(body.content);
        if (patternsMatched.length > 0 && req.user?.id) {
          let injectionCount = 0;
          try {
            injectionCount = await abuseCounter.recordInjection(req.user.id, patternsMatched);
          } catch {
            req.log?.warn({ userId: req.user.id }, "sanitiser_redis_unavailable");
          }
          sanitiserEvents.emit("sanitiser.injection_stripped", {
            userId: req.user.id,
            route: req.path,
            patternsMatched,
          });
          if (policy.injectionMode === "reject") return next(Errors.promptInjectionRejected());
          if (injectionCount >= INJECTION_BURST_THRESHOLD.count) {
            sanitiserEvents.emit("sanitiser.abuse_signal", { userId: req.user.id, kind: "injection_burst" });
          }
        }
        body.content = sanitised;
        if (req.user?.id) {
          const hash = sanitiserService.hashContent(req.user.id, sanitised);
          let repeatCount = 1;
          try {
            repeatCount = await abuseCounter.recordRepeat(req.user.id, hash);
          } catch {
            req.log?.warn({ userId: req.user.id }, "sanitiser_redis_unavailable");
          }
          if (repeatCount >= REPEAT_THRESHOLD.count) {
            sanitiserEvents.emit("sanitiser.abuse_signal", { userId: req.user.id, kind: "repeat_message" });
            return next(Errors.repeatMessage());
          }
        }
      }

      for (const key of HTML_FIELDS) {
        if (typeof body[key] === "string") {
          body[key] = sanitiserService.sanitiseHtml(body[key] as string);
        }
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
};
