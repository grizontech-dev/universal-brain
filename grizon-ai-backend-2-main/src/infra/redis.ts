import { createClient } from "redis";

import { env } from "../config/env.js";

let client: any | null = null;
let connecting: Promise<any | null> | null = null;

export async function getRedisClient(): Promise<any | null> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c = createClient({
        url: env.REDIS_URL,
        socket: { connectTimeout: 1000 },
      });
      c.on("error", () => {
        // Swallow connection errors; higher layers fall back to Postgres.
      });

      // Fail fast so unit tests don't hang when Redis isn't running.
      await Promise.race([
        c.connect(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("redis_connect_timeout")), 1500)),
      ]);
      client = c;
      return c;
    } catch {
      client = null;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/** Separate connection for pub/sub (required by node-redis). */
export async function createRedisSubscriber(): Promise<any | null> {
  const base = await getRedisClient();
  if (!base) return null;
  try {
    const sub = base.duplicate();
    await Promise.race([
      sub.connect(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("redis_sub_connect_timeout")), 1500)),
    ]);
    return sub;
  } catch {
    return null;
  }
}

