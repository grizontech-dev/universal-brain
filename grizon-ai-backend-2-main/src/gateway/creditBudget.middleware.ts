import type { RequestHandler } from "express";
import { creditCalculator } from "../services/creditCalculator.service.js";
import { getAgentPrimaryRates } from "../services/modelRates.service.js";
import { walletService } from "../services/wallet.service.js";
import { Errors } from "../utils/errors.js";

const EXEMPT_PATH_PREFIXES = ["/api/v1/wallet", "/api/v1/admin/wallets"];

export const creditBudgetMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    if (req.method === "GET") return next();
    if (!req.user?.id || !req.plan) return next();
    if (EXEMPT_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();
    if (!req.creditEstimate) return next();

    const wallet = await walletService.getBalance(req.user.id);
    const cost = creditCalculator.calculateCost({
      inputFreshTokens: req.creditEstimate.inputTokens,
      inputCachedTokens: 0,
      outputTokens: req.creditEstimate.outputTokens,
      rates: await getAgentPrimaryRates(req.creditEstimate.agentSlug),
      agentSlug: req.creditEstimate.agentSlug,
    });
    const spendable = wallet.balance - wallet.pending;
    if (spendable < cost) {
      return next(
        Errors.insufficientCredits({
          creditsNeeded: cost,
          creditsAvailable: spendable,
          topupUrl: "/wallet/topup",
        }),
      );
    }

    const holdId = await walletService.holdPending(req.user.id, cost, {
      agentSlug: req.creditEstimate.agentSlug,
      description: "credit_budget_hold",
    });
    req.wallet = { holdId, heldAmount: cost };
    return next();
  } catch (error) {
    return next(error);
  }
};
