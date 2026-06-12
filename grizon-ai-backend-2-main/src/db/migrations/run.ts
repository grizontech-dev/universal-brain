import { readFile, readdir } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

import { getPool } from "../pool.js";

const migrationsDir = fileURLToPath(new URL(".", import.meta.url));

async function ensureSchemaMigrationsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function isApplied(filename: string) {
  const pool = getPool();
  const res = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [filename]);
  return res.rowCount > 0;
}

async function markApplied(filename: string) {
  const pool = getPool();
  await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [filename]);
}

async function runMigrations() {
  const pool = getPool();
  await ensureSchemaMigrationsTable();

  const entries = await readdir(migrationsDir);

  const sqlFiles = entries
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of sqlFiles) {
    if (await isApplied(file)) {
      continue;
    }
    const fullPath = path.join(migrationsDir, file);
    const sql = (await readFile(fullPath, "utf8")).toString();

    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await markApplied(file);
      await pool.query("COMMIT");
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  }
}

// Script entrypoint: `pnpm migrate` runs all pending migrations.
runMigrations()
  .then(() => {
    console.info("Migrations completed.");
  })
  .catch((e) => {
    console.error("Migrations failed.", e);
    process.exit(1);
  });
