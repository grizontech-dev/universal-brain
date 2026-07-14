import { Pool } from "pg";

import { env } from "../config/env.js";

let pool: any | null = null;

/** Connection-level error codes that warrant an automatic retry. */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ECONNREFUSED",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

/**
 * TCP keepalive options to prevent Supabase PgBouncer from killing idle connections.
 * PgBouncer kills connections idle >60s unless keepalive probes are active.
 */
const KEEPALIVE_OPTS = {
  keepalives: 1,
  keepalives_idle: 10,    // Send keepalive after 10s idle (PgBouncer kills at ~60s)
  keepalives_interval: 5, // Retry keepalive every 5s
  keepalives_count: 3,    // Drop after 3 failed probes
};

export function getPool(): any {
  if (pool) return pool;

  const raw = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    // Kill idle connections before PgBouncer does
    idleTimeoutMillis: 25000,
    // Fail fast if we can't get a connection (prevents 60s hangs)
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: false,
    // TCP keepalive to prevent PgBouncer from killing idle connections
    ...KEEPALIVE_OPTS,
  });

  raw.on("error", (err: any) => {
    console.error("[DB-POOL] Idle client error (connection recycled):", err.message);
  });

  // Wrap pool.query to auto-retry once on stale-connection errors.
  // On ECONNRESET the broken client is already evicted by pg; the retry
  // grabs a fresh connection from the pool.
  const originalQuery = raw.query.bind(raw);
  raw.query = async (textOrConfig: any, params?: any) => {
    try {
      return await originalQuery(textOrConfig, params);
    } catch (err: any) {
      if (RETRYABLE_CODES.has(err?.code)) {
        console.warn(`[DB-POOL] Query failed (${err.code}), retrying once with fresh connection...`);
        return originalQuery(textOrConfig, params);
      }
      throw err;
    }
  };

  pool = raw;
  return pool;
}

/**
 * Execute a pool.query with one automatic retry on connection reset.
 * Stale connections from Supabase PgBouncer cause ECONNRESET;
 * the pool discards the dead connection and retries with a fresh one.
 */
export async function retryQuery(text: string, params?: any[], attempts = 2): Promise<any> {
  const pool = getPool();
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await pool.query(text, params);
    } catch (err: any) {
      lastErr = err;
      const code = err?.code;
      if (RETRYABLE_CODES.has(code)) {
        if (i < attempts - 1) {
          console.warn(`[DB-POOL] Query failed (${code}), retrying (${i + 1}/${attempts})...`);
          continue;
        }
      }
      throw err;
    }
  }
  throw lastErr;
}

