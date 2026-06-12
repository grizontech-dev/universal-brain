import YahooFinance from "yahoo-finance2";

import { registerTool } from "./registry.js";
import { logger } from "../utils/logger.js";
import type { StreamContext } from "../types/router.js";

// yahoo-finance2 v3 removed the default singleton — must instantiate explicitly.
const yahooFinance = new YahooFinance();

export type StockDataType = "quote" | "history" | "profile";

type QuoteLike = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  marketCap?: number;
  currency?: string;
};

type ChartLike = {
  quotes?: Array<{ date?: Date; close?: number; open?: number }>;
};

function periodToStartDate(period: string): Date {
  const now = new Date();
  const d = new Date(now);
  switch (period) {
    case "1d":
      d.setDate(d.getDate() - 1);
      return d;
    case "5d":
      d.setDate(d.getDate() - 5);
      return d;
    case "1mo":
      d.setMonth(d.getMonth() - 1);
      return d;
    case "3mo":
      d.setMonth(d.getMonth() - 3);
      return d;
    case "6mo":
      d.setMonth(d.getMonth() - 6);
      return d;
    case "1y":
      d.setFullYear(d.getFullYear() - 1);
      return d;
    case "2y":
      d.setFullYear(d.getFullYear() - 2);
      return d;
    case "5y":
      d.setFullYear(d.getFullYear() - 5);
      return d;
    default:
      d.setMonth(d.getMonth() - 1);
      return d;
  }
}

export async function stockData(
  params: { reason?: string; symbol: string; type: StockDataType; period?: string },
  _ctx: StreamContext,
): Promise<unknown> {
  const symbol = params.symbol.trim().toUpperCase();
  try {
    if (params.type === "quote") {
      const startedAt = Date.now();
      let quote: QuoteLike;
      try {
        quote = (await yahooFinance.quote(symbol)) as QuoteLike;
        logger.info(
          { tool: "stock_data", op: "quote", symbol, durationMs: Date.now() - startedAt },
          "yahoo_finance_call_completed",
        );
      } catch (err) {
        logger.warn(
          { err, tool: "stock_data", op: "quote", symbol, durationMs: Date.now() - startedAt },
          "yahoo_finance_call_failed",
        );
        throw err;
      }
      return {
        symbol: quote.symbol ?? symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        open: quote.regularMarketOpen,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        currency: quote.currency,
        timestamp: new Date().toISOString(),
      };
    }

    if (params.type === "history") {
      const period = params.period ?? "1mo";
      const period1 = periodToStartDate(period);
      const period2 = new Date();
      const startedAt = Date.now();
      let result: ChartLike;
      try {
        result = (await yahooFinance.chart(symbol, {
          period1,
          period2,
          interval: period === "1d" ? "1h" : "1d",
        })) as ChartLike;
        logger.info(
          { tool: "stock_data", op: "history", symbol, period, durationMs: Date.now() - startedAt },
          "yahoo_finance_call_completed",
        );
      } catch (err) {
        logger.warn(
          { err, tool: "stock_data", op: "history", symbol, period, durationMs: Date.now() - startedAt },
          "yahoo_finance_call_failed",
        );
        throw err;
      }
      const quotes = result.quotes ?? [];
      return {
        symbol,
        history: quotes.slice(-30).map((q: { date?: Date; close?: number; open?: number }) => ({
          date: q.date,
          close: q.close,
          open: q.open,
        })),
      };
    }

    if (params.type === "profile") {
      const startedAt = Date.now();
      let summary: unknown;
      try {
        summary = await yahooFinance.quoteSummary(symbol, {
          modules: ["summaryProfile", "financialData"],
        });
        logger.info(
          { tool: "stock_data", op: "profile", symbol, durationMs: Date.now() - startedAt },
          "yahoo_finance_call_completed",
        );
      } catch (err) {
        logger.warn(
          { err, tool: "stock_data", op: "profile", symbol, durationMs: Date.now() - startedAt },
          "yahoo_finance_call_failed",
        );
        throw err;
      }
      return { symbol, profile: summary };
    }

    return { error: "invalid_type" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Yahoo Finance error: ${msg}` };
  }
}

registerTool({
  name: "stock_data",
  description: "Fetch stock quote, historical prices, or company profile via Yahoo Finance.",
  parallelSafe: true,
  estimatedLatencyMs: 1500,
  planRequired: "starter",
  featureFlag: "stockData",
  parametersSchema: {
    type: "object",
    properties: {
      reason: { type: "string" },
      symbol: { type: "string", description: "Ticker e.g. AAPL, BTC-USD" },
      type: { type: "string", enum: ["quote", "history", "profile"] },
      period: {
        type: "string",
        enum: ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"],
        description: "For history only",
      },
    },
    required: ["symbol", "type"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const t = p.type as StockDataType;
    if (t !== "quote" && t !== "history" && t !== "profile") {
      return { error: "invalid_type" };
    }
    return stockData(
      {
        reason: p.reason !== undefined ? String(p.reason) : undefined,
        symbol: String(p.symbol ?? ""),
        type: t,
        period: typeof p.period === "string" ? p.period : undefined,
      },
      ctx,
    );
  },
});
