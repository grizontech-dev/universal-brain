import { Pool } from "pg";

import { env } from "../config/env.js";

let pool: any | null = null;

export function getPool(): any {
  if (pool) return pool;
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
  });

  return pool;
}

