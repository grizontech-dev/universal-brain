import 'dotenv/config';

import { Pool } from 'pg';

/**
 * Resolve a usable Postgres connection string.
 *
 * Prod (Docker/CI): DATABASE_URL is set with credentials and the correct host
 *   (e.g. the "postgres" compose service) → used verbatim, no rewriting.
 * Local dev: DATABASE_URL in .env often lacks credentials, so we fall back to
 *   PGWEB_DATABASE_URL (which has app:app) and rewrite the Docker-only host
 *   "postgres" → "localhost" since the container publishes 5432 there.
 * Set DB_HOST to override the host in either case.
 */
function resolveDbUrl(): string {
  const dbUrl = process.env.DATABASE_URL?.trim();
  const pgweb = process.env.PGWEB_DATABASE_URL?.trim();
  const hasCreds = (u?: string) => !!u && /:\/\/[^/@]+:[^/@]+@/.test(u);
  const override = process.env.DB_HOST?.trim();

  // Prod path: a credentialed DATABASE_URL is authoritative — don't touch its host.
  if (hasCreds(dbUrl)) {
    if (!override) return dbUrl!;
    try {
      const u = new URL(dbUrl!);
      u.hostname = override;
      return u.toString();
    } catch {
      return dbUrl!;
    }
  }

  // Dev fallback: use PGWEB creds and map the docker host to localhost.
  const chosen = pgweb ?? dbUrl;
  if (!chosen) {
    throw new Error('Neither DATABASE_URL nor PGWEB_DATABASE_URL is set. Add one to .env.');
  }
  try {
    const u = new URL(chosen);
    if (override) u.hostname = override;
    else if (u.hostname === 'postgres') u.hostname = 'localhost';
    return u.toString();
  } catch {
    return chosen; // not a parseable URL — pass through unchanged
  }
}

const DATABASE_URL = resolveDbUrl();

// Typed as any to match src/db/pool.ts — the project's pg types are minimal.
const pool: any = new Pool({ connectionString: DATABASE_URL });

/**
 * Reset the agent catalogue so `npm run seed` can rebuild it cleanly.
 *
 * Why: seedAgents() / seedAgentModelPriorities() use INSERT ... ON CONFLICT
 * DO NOTHING, so any agent slug that already exists keeps its OLD config. This
 * script clears agents (cascading to agent_model_priorities) so the new
 * 17-agent catalogue + fallback chains are recreated on the next seed.
 *
 * Safe by design:
 *  - agent_model_priorities.agent_id is ON DELETE CASCADE → cleared automatically.
 *  - ai_models.model_id is referenced by agents only as plain text (no FK).
 *  - plans / messages / wallet_transactions are NOT touched (apply plan changes
 *    via migration 059 instead; historical agent_slug columns are plain text).
 *
 * Usage:
 *   npm run reset-agents            # delete all agents (+ priorities), drop stale gpt-4o-mini
 *   npm run reset-agents -- --all   # also delete ALL ai_models (seedModels re-inserts all 25)
 *   npm run reset-agents -- --dry   # print what would be deleted, change nothing
 *
 * Then run:  npm run migrate  &&  npm run seed
 */

// Models removed from the new June-2026 roster (not re-seeded). Pruned by default.
const STALE_MODEL_IDS = ['gpt-4o-mini'];

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const resetAllModels = args.has('--all');
  const dryRun = args.has('--dry');

  // Report current counts first.
  const counts = await pool.query(`
    SELECT
      (SELECT count(*) FROM agents)                  AS agents,
      (SELECT count(*) FROM agent_model_priorities)  AS priorities,
      (SELECT count(*) FROM ai_models)               AS models
  `);
  const { agents, priorities, models } = counts.rows[0] as {
    agents: string;
    priorities: string;
    models: string;
  };
  console.info(
    `Reset: current state → agents=${agents}, agent_model_priorities=${priorities}, ai_models=${models}.`,
  );

  if (dryRun) {
    console.info('Reset: --dry — no changes made. Would:');
    console.info('  • DELETE FROM agents  (cascades to agent_model_priorities)');
    if (resetAllModels) {
      console.info('  • DELETE FROM ai_models  (all rows)');
    } else {
      console.info(`  • DELETE FROM ai_models WHERE model_id IN (${STALE_MODEL_IDS.join(', ')})`);
    }
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clearing agents cascades to agent_model_priorities (ON DELETE CASCADE).
    const delAgents = await client.query('DELETE FROM agents');
    console.info(`Reset: deleted ${delAgents.rowCount} agents (+ their model priorities via cascade).`);

    if (resetAllModels) {
      const delModels = await client.query('DELETE FROM ai_models');
      console.info(`Reset: deleted ${delModels.rowCount} ai_models (full model reset).`);
    } else {
      const delStale = await client.query(
        `DELETE FROM ai_models WHERE model_id = ANY($1::text[])`,
        [STALE_MODEL_IDS],
      );
      console.info(`Reset: deleted ${delStale.rowCount} stale ai_models (${STALE_MODEL_IDS.join(', ')}).`);
    }

    await client.query('COMMIT');
    console.info('Reset: done. Now run: npm run migrate && npm run seed');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

try {
  await main();
} catch (err) {
  console.error('Reset failed:', err);
  process.exitCode = 1;
} finally {
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
}
