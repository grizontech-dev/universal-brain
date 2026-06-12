import { Queue } from "bullmq";

import { JOB_OPTS, QUEUE_NAMES } from "../config/queue.js";
import { env } from "../config/env.js";
import type { FileJobPayload } from "../types/fileJob.js";

export const fileQueue = new Queue<FileJobPayload>(QUEUE_NAMES.file, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: JOB_OPTS.file,
});
