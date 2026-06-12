import { Queue } from "bullmq";

import { JOB_OPTS, QUEUE_NAMES } from "../config/queue.js";
import { env } from "../config/env.js";
import type { ChatQueueJobData } from "../types/chatJob.js";

export const chatQueue = new Queue<ChatQueueJobData>(QUEUE_NAMES.chat, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: JOB_OPTS.chat,
});
