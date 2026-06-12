import type { RequestHandler } from "express";
import { z } from "zod";

import { auditService } from "../../services/audit.service.js";
import { walletService } from "../../services/wallet.service.js";
import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";

const adjustBody = z.object({
  delta: z.number().int(),
  reason: z.string().min(10),
  force: z.boolean().optional(),
});

const listQuery = z.object({
  q: z.string().optional(),
  balance_below: z.coerce.number().int().optional(),
  balance_above: z.coerce.number().int().optional(),
  pending_above: z.coerce.number().int().optional(),
  sort: z.enum(["balance", "-balance", "lifetime_spent", "-lifetime_spent", "updated_at", "-updated_at"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
});

export const walletsAdminController = {
  adjustWallet: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(adjustBody, req.body);
      if (body.force && req.user.role !== "superadmin") return next(Errors.superadminRequired());
      const { wallet, transaction } = await walletService.adjust(
        req.params.id,
        body.delta,
        body.reason,
        req.user.id,
        Boolean(body.force),
      );
      await auditService.record({
        eventType: "admin_wallet_adjusted",
        userId: req.params.id,
        actorId: req.user.id,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
        fingerprint: req.session?.fingerprint ?? null,
        success: true,
        metadata: { delta: body.delta, force: Boolean(body.force) },
      });
      return ok(res, { wallet, transaction }, "Wallet adjusted.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listWallets: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      const out = await walletService.listWalletsAdmin({
        q: q.q,
        balanceBelow: q.balance_below,
        balanceAbove: q.balance_above,
        pendingAbove: q.pending_above,
        sort: q.sort,
        page: q.page,
        pageSize: q.page_size,
      });
      return ok(
        res,
        { wallets: out.rows, pagination: { page: q.page, page_size: q.page_size, total: out.total } },
        "Wallets loaded.",
      );
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,
};
