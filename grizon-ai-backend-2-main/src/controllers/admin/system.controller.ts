import type { RequestHandler } from "express";

import { getPool } from "../../db/pool.js";
import { getRedisClient } from "../../infra/redis.js";
import { snapshotAllQueues } from "../../queues/queueMetrics.js";
import { providerHealth } from "../../router/providerHealth.js";
import { ok } from "../../utils/response.js";

export const systemController = {
  getHealth: (async (_req, res, next) => {
    try {
      let postgresOk = false;
      try {
        await getPool().query("SELECT 1");
        postgresOk = true;
      } catch {
        postgresOk = false;
      }

      let redisOk = false;
      try {
        const redis = await getRedisClient();
        if (redis) {
          const pong = await redis.ping();
          redisOk = pong === "PONG";
        }
      } catch {
        redisOk = false;
      }

      type QueueSnap = Awaited<ReturnType<typeof snapshotAllQueues>>;
      let queues: QueueSnap | null = null;
      let queuesOk = false;
      try {
        queues = await snapshotAllQueues();
        queuesOk = true;
      } catch {
        queuesOk = false;
      }

      const providerMap = await providerHealth.snapshot();
      const providers = [...providerMap.values()];

      return ok(
        res,
        {
          postgres: { ok: postgresOk },
          redis: { ok: redisOk },
          bullmq: { ok: queuesOk, queues: queues ?? [] },
          providers,
        },
        "System health loaded.",
      );
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
