import type { ErrorRequestHandler } from "express";

import { AppError, Errors } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { fail } from "../utils/response.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = err instanceof AppError ? err : Errors.internal(err);

  const log = req.log ?? logger;

  log.error(
    {
      err: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        code: appErr.code,
        cause: appErr.cause,
      },
      req_id: req.id,
      user_id: req.user?.id,
      path: req.path,
      method: req.method,
    },
    "request_failed",
  );

  fail(res, appErr.status, appErr.code, appErr.userMessage, appErr.details);
};
