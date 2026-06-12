import type { RequestHandler } from "express";

import { walletService } from "../../services/wallet.service.js";
import { Errors, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";
import { z } from "zod";

const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
  type: z.enum(["grant", "deduct", "topup", "rollover", "refund", "adjustment"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const walletController = {
  getWallet: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const wallet = await walletService.getBalance(req.user.id);
      res.setHeader("X-Wallet-Balance", String(wallet.balance));
      res.setHeader("X-Wallet-Pending", String(wallet.pending));
      res.setHeader("X-Wallet-Spendable", String(wallet.balance - wallet.pending));
      return ok(
        res,
        {
          balance: wallet.balance,
          pending: wallet.pending,
          spendable: wallet.balance - wallet.pending,
          lifetimeEarned: wallet.lifetimeEarned,
          lifetimeSpent: wallet.lifetimeSpent,
          currency: "credits",
          updatedAt: wallet.updatedAt,
        },
        "Wallet loaded.",
      );
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listTransactions: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const q = parseQuery(listQuery, req.query);
      const { transactions, total } = await walletService.listTransactions({
        userId: req.user.id,
        page: q.page,
        pageSize: q.page_size,
        type: q.type,
        from: q.from,
        to: q.to,
      });
      return ok(
        res,
        {
          transactions,
          pagination: { page: q.page, page_size: q.page_size, total },
        },
        "Transactions loaded.",
      );
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getTransactionById: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const tx = await walletService.getTransactionById(req.user.id, req.params.id);
      if (!tx) return next(Errors.notFound("Wallet transaction"));
      return ok(res, { transaction: tx }, "Transaction loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

};
