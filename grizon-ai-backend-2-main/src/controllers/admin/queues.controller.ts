import type { RequestHandler } from "express";
import { z } from "zod";

import { chatQueue } from "../../queues/chat.queue.js";
import { fileQueue } from "../../queues/file.queue.js";
import { notificationQueue } from "../../queues/notification.queue.js";
import { snapshotAllQueues } from "../../queues/queueMetrics.js";
import { Errors, parseBody } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";

const queueNameSchema = z.enum(["chat", "file", "notification"]);
const retrySchema = z.object({
  reason: z.string().min(3).max(500),
});

export const queuesController = {
  getSnapshot: (async (_req, res, next) => {
    try {
      const queues = await snapshotAllQueues();
      return ok(res, { queues }, "Queue snapshot loaded.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  retryFailed: (async (req, res, next) => {
    try {
      parseBody(retrySchema, req.body);
      const name = queueNameSchema.safeParse(String(req.params.name));
      if (!name.success) return next(Errors.invalidQueueName());

      const selected = name.data === "chat" ? chatQueue : name.data === "file" ? fileQueue : notificationQueue;
      const retried = await selected.retryJobs({ state: "failed" });
      return ok(res, { retried }, "Failed jobs retried.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
