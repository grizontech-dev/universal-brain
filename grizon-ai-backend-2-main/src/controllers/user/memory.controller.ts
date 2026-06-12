import type { RequestHandler } from "express";
import { z } from "zod";

import { getPool } from "../../db/pool.js";
import { deleteFactVector, purgeUserMemoryCollection } from "../../memory/vector.memory.js";
import { Errors, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";

const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const uuidParam = z.string().uuid();

export const memoryController = {
  listFacts: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      const offset = (q.page - 1) * q.limit;
      const pool = getPool();
      const [rows, count] = await Promise.all([
        pool.query(
          `
            SELECT id, fact, confidence, created_at
            FROM memory_facts
            WHERE user_id = $1 AND superseded_by IS NULL
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
          `,
          [req.user.id, q.limit, offset],
        ),
        pool.query(`SELECT COUNT(*)::int AS total FROM memory_facts WHERE user_id = $1 AND superseded_by IS NULL`, [
          req.user.id,
        ]),
      ]);
      return ok(
        res,
        {
          facts: rows.rows,
          total: Number((count.rows[0] as { total?: number }).total ?? 0),
          page: q.page,
          limit: q.limit,
        },
        "Memory facts loaded.",
      );
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  deleteFact: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const parsed = uuidParam.safeParse(req.params.id);
      if (!parsed.success) return next(Errors.validation([{ path: "id", code: "INVALID_VALUE", message: "Invalid UUID." }]));

      const pool = getPool();
      const deleted = await pool.query(
        `DELETE FROM memory_facts WHERE id = $1 AND user_id = $2 RETURNING fact`,
        [parsed.data, req.user.id],
      );
      if (!deleted.rowCount) return next(Errors.notFound("memory_fact"));
      const fact = String((deleted.rows[0] as { fact: string }).fact);
      await deleteFactVector(req.user.id, fact);
      return ok(res, { deleted: true }, "Memory fact deleted.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  purgeAllFacts: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const pool = getPool();
      await pool.query(`DELETE FROM memory_facts WHERE user_id = $1`, [req.user.id]);
      await purgeUserMemoryCollection(req.user.id);
      return ok(res, { purged: true }, "Memory facts purged.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
