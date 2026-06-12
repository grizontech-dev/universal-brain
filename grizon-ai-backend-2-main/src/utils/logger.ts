import pino from "pino";
import pretty from "pino-pretty";

import { env } from "../config/env.js";
import { getPrettyOptions } from "../config/logger.js";

const loggerOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: "api", version: env.APP_VERSION },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-key"]',
      "req.body.password",
      "req.body.current_password",
      "req.body.new_password",
      "req.body.id_token",
      "req.body.refresh_token",
      "req.body.token",
      "res.body.access_token",
      "res.body.refresh_token",
      "user.password_hash",
      "oauth.id_token",
    ],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const prettyStream = env.LOG_PRETTY ? pretty(getPrettyOptions()) : undefined;

export const logger = pino(loggerOptions, prettyStream);

export function reqLogger(reqId: string, userId?: string) {
  return logger.child({ req_id: reqId, user_id: userId });
}
