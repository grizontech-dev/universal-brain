import type { RequestHandler } from "express";
import { z } from "zod";

import { getPool } from "../../db/pool.js";
import { benchmarkQueue } from "../../queues/benchmark.queue.js";
import { parseQuery } from "../../utils/errors.js";
import { ok, created, fail } from "../../utils/response.js";

// ─── Schemas ────────────────────────────────────────────────────────────────

const createSuiteBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  agentSlug: z.string().min(1),
  modelId: z.string().optional().nullable(),
  concurrency: z.coerce.number().int().min(1).max(20).default(5),
});

const addCaseBody = z.object({
  prompt: z.string().min(1).max(10_000),
});

const importCasesBody = z.object({
  prompts: z.array(z.string().min(1).max(10_000)).min(1).max(500),
});

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Controller ─────────────────────────────────────────────────────────────

export const benchmarkController = {
  // GET /benchmark/suites
  listSuites: (async (_req, res, next) => {
    try {
      const pool = getPool();
      const { rows } = await pool.query(`
        SELECT
          s.id, s.name, s.description, s.agent_slug, s.model_id, s.concurrency, s.created_at,
          COUNT(DISTINCT c.id)::text AS case_count,
          (SELECT r.status FROM benchmark_runs r WHERE r.suite_id = s.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_status,
          (SELECT r.created_at FROM benchmark_runs r WHERE r.suite_id = s.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_at
        FROM benchmark_suites s
        LEFT JOIN benchmark_cases c ON c.suite_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC
      `);
      return ok(res, { suites: rows }, "Suites loaded.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // POST /benchmark/suites
  createSuite: (async (req, res, next) => {
    try {
      const body = createSuiteBody.parse(req.body);
      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO benchmark_suites (name, description, agent_slug, model_id, concurrency)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [body.name, body.description ?? null, body.agentSlug, body.modelId ?? null, body.concurrency],
      );
      const row = rows[0] as { id: string };
      return created(res, { id: row.id }, "Suite created.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // GET /benchmark/suites/:id
  getSuite: (async (req, res, next) => {
    try {
      const pool = getPool();
      const [suiteRes, casesRes] = await Promise.all([
        pool.query(
          `SELECT id, name, description, agent_slug, model_id, concurrency, created_at
           FROM benchmark_suites WHERE id = $1`,
          [req.params.id],
        ),
        pool.query(
          `SELECT id, prompt, order_index, created_at
           FROM benchmark_cases WHERE suite_id = $1 ORDER BY order_index ASC, created_at ASC`,
          [req.params.id],
        ),
      ]);
      if (!suiteRes.rows[0]) return fail(res, 404, "NOT_FOUND", "Suite not found.");
      return ok(res, { suite: suiteRes.rows[0], cases: casesRes.rows }, "Suite loaded.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // DELETE /benchmark/suites/:id
  deleteSuite: (async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.query(`DELETE FROM benchmark_suites WHERE id = $1`, [req.params.id]);
      return ok(res, {}, "Suite deleted.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // POST /benchmark/suites/:id/cases
  addCase: (async (req, res, next) => {
    try {
      const body = addCaseBody.parse(req.body);
      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO benchmark_cases (suite_id, prompt, order_index)
         SELECT $1, $2, COALESCE((SELECT MAX(order_index) FROM benchmark_cases WHERE suite_id = $1), 0) + 1
         RETURNING id`,
        [req.params.id, body.prompt],
      );
      const row = rows[0] as { id: string };
      return created(res, { id: row.id }, "Case added.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // POST /benchmark/suites/:id/cases/import
  importCases: (async (req, res, next) => {
    try {
      const body = importCasesBody.parse(req.body);
      const pool = getPool();
      const maxRes = await pool.query(
        `SELECT COALESCE(MAX(order_index), 0) AS max FROM benchmark_cases WHERE suite_id = $1`,
        [req.params.id],
      );
      const base = Number((maxRes.rows[0] as { max: string }).max ?? 0);
      const placeholders = body.prompts
        .map((_, i) => `($1, $${i + 2}, ${base + i + 1})`)
        .join(", ");
      await pool.query(
        `INSERT INTO benchmark_cases (suite_id, prompt, order_index) VALUES ${placeholders}`,
        [req.params.id, ...body.prompts],
      );
      return created(res, { imported: body.prompts.length }, `${body.prompts.length} cases imported.`);
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // DELETE /benchmark/cases/:caseId
  deleteCase: (async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.query(`DELETE FROM benchmark_cases WHERE id = $1`, [req.params.caseId]);
      return ok(res, {}, "Case deleted.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // POST /benchmark/suites/:id/runs  — trigger a new run
  triggerRun: (async (req, res, next) => {
    try {
      const pool = getPool();
      const suiteRes = await pool.query(
        `SELECT id, agent_slug, model_id, concurrency FROM benchmark_suites WHERE id = $1`,
        [req.params.id],
      );
      if (!suiteRes.rows[0]) return fail(res, 404, "NOT_FOUND", "Suite not found.");
      const suite = suiteRes.rows[0] as {
        id: string; agent_slug: string; model_id: string | null; concurrency: number;
      };

      const casesRes = await pool.query(
        `SELECT id, prompt FROM benchmark_cases WHERE suite_id = $1 ORDER BY order_index ASC, created_at ASC`,
        [req.params.id],
      );
      if (casesRes.rows.length === 0) return fail(res, 400, "NO_CASES", "Suite has no cases.");
      const cases = casesRes.rows as { id: string; prompt: string }[];

      const runRes = await pool.query(
        `INSERT INTO benchmark_runs (suite_id, status, total_cases, started_at)
         VALUES ($1, 'running', $2, now()) RETURNING id`,
        [suite.id, cases.length],
      );
      const runId = (runRes.rows[0] as { id: string }).id;

      const jobs = cases.map((c) => ({
        name: "benchmark-case",
        data: {
          runId,
          caseId: c.id,
          prompt: c.prompt,
          agentSlug: suite.agent_slug,
          modelId: suite.model_id,
        },
        opts: { jobId: `${runId}__${c.id}` },
      }));

      await benchmarkQueue.addBulk(jobs);

      return created(res, { runId }, "Run started.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // GET /benchmark/runs/:runId
  getRun: (async (req, res, next) => {
    try {
      const pool = getPool();
      const runRes = await pool.query(
        `SELECT id, suite_id, status, total_cases, completed_cases, failed_cases,
                started_at, completed_at, created_at
           FROM benchmark_runs WHERE id = $1`,
        [req.params.runId],
      );
      if (!runRes.rows[0]) return fail(res, 404, "NOT_FOUND", "Run not found.");

      const [statsRes, toolRes] = await Promise.all([
        pool.query(
          `SELECT
             ROUND(AVG(latency_ms))::text AS avg_latency,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::text AS p50_latency,
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::text AS p95_latency
           FROM benchmark_results WHERE run_id = $1 AND status = 'success'`,
          [req.params.runId],
        ),
        pool.query(
          `SELECT UNNEST(tools_invoked) AS tool, COUNT(*)::text AS count
           FROM benchmark_results WHERE run_id = $1
           GROUP BY tool ORDER BY count DESC`,
          [req.params.runId],
        ),
      ]);

      return ok(res, {
        run: runRes.rows[0],
        stats: statsRes.rows[0] ?? {},
        toolBreakdown: toolRes.rows,
      }, "Run loaded.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // GET /benchmark/runs/:runId/results
  getRunResults: (async (req, res, next) => {
    try {
      const q = parseQuery(paginationQuery, req.query);
      const pool = getPool();
      const offset = (q.page - 1) * q.pageSize;
      const [resultsRes, countRes] = await Promise.all([
        pool.query(
          `SELECT r.id, r.case_id, r.status, r.model_used, r.tools_invoked, r.tool_rounds,
                  r.input_tokens, r.output_tokens, r.latency_ms, r.error_message, r.created_at,
                  LEFT(r.response_text, 500) AS response_preview,
                  LEFT(c.prompt, 200) AS prompt_preview
             FROM benchmark_results r
             JOIN benchmark_cases c ON c.id = r.case_id
            WHERE r.run_id = $1
            ORDER BY r.created_at ASC
            LIMIT $2 OFFSET $3`,
          [req.params.runId, q.pageSize, offset],
        ),
        pool.query(
          `SELECT COUNT(*)::text AS total FROM benchmark_results WHERE run_id = $1`,
          [req.params.runId],
        ),
      ]);
      const total = Number((countRes.rows[0] as { total: string })?.total ?? 0);
      return ok(res, {
        results: resultsRes.rows,
        total,
        totalPages: Math.ceil(total / q.pageSize),
      }, "Results loaded.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // GET /benchmark/suites/:id/runs
  getSuiteRuns: (async (req, res, next) => {
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, status, total_cases, completed_cases, failed_cases,
                started_at, completed_at, created_at
           FROM benchmark_runs WHERE suite_id = $1
          ORDER BY created_at DESC LIMIT 50`,
        [req.params.id],
      );
      return ok(res, { runs: rows }, "Runs loaded.");
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,

  // POST /benchmark/runs/:runId/cancel
  cancelRun: (async (req, res, next) => {
    try {
      const pool = getPool();

      // Only cancel if currently running
      const runRes = await pool.query(
        `UPDATE benchmark_runs
            SET status = 'cancelled', completed_at = now()
          WHERE id = $1 AND status = 'running'
          RETURNING id, suite_id, total_cases, completed_cases, failed_cases`,
        [req.params.runId],
      );
      if (!runRes.rows[0]) {
        return fail(res, 409, "NOT_RUNNING", "Run is not in running state.");
      }
      const run = runRes.rows[0] as {
        id: string; suite_id: string; total_cases: number;
        completed_cases: number; failed_cases: number;
      };

      // Drain all waiting jobs for this run from the queue
      const waiting = await benchmarkQueue.getWaiting();
      const toRemove = waiting.filter((j) => j.data.runId === req.params.runId);
      await Promise.all(toRemove.map((j) => j.remove()));

      return ok(res, {
        runId: run.id,
        removedJobs: toRemove.length,
        completedCases: run.completed_cases,
        failedCases: run.failed_cases,
        totalCases: run.total_cases,
      }, `Run cancelled. Removed ${toRemove.length} pending jobs.`);
    } catch (e) { return next(e); }
  }) satisfies RequestHandler,
};
