import { Queue } from "bullmq";

import { JOB_OPTS, QUEUE_NAMES } from "../config/queue.js";
import { env } from "../config/env.js";
import type { NotificationJobPayload } from "../types/notificationJob.js";

export const notificationQueue = new Queue<NotificationJobPayload>(QUEUE_NAMES.notification, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: JOB_OPTS.notification,
});
