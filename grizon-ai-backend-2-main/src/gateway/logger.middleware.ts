import type { RequestHandler } from "express";

import { reqLogger } from "../utils/logger.js";

function ipPrefix24(ip: string | undefined) {
  if (!ip) return "unknown";
  const normalized = ip.replace("::ffff:", "");
  const parts = normalized.split(".");
  if (parts.length !== 4) return normalized;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  req.log = reqLogger(req.id, req.user?.id);

  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    req.log[level](
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: durationMs,
        user_id: req.user?.id,
        session_id: req.session?.id,
        platform: req.platform,
        ip: ipPrefix24(req.ip),
        user_agent: req.headers["user-agent"],
      },
      "request_completed",
    );
  });

  next();
};
