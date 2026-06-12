import { Queue } from "bullmq";

import { env } from "../config/env.js";
import type { BenchmarkJobPayload } from "../types/benchmarkJob.js";

export const benchmarkQueue = new Queue<BenchmarkJobPayload>("benchmark", {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});
