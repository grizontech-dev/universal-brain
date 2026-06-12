import type { RequestHandler } from "express";
import { z } from "zod";
import { Errors, parseBody, parseQuery } from "../../utils/errors.js";
import { ok } from "../../utils/response.js";
import {
  initiateRefund,
  listPaymentOrders,
  notifyDueRedemptions,
  executeDueRedemptions,
} from "../../services/payment/payment.service.js";
import { phonepeAdapter } from "../../services/payment/phonepe.adapter.js";
import { getPool } from "../../db/pool.js";

const webhookEventsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
  event: z.string().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25),
  user_id: z.string().uuid().optional(),
  type: z.enum(["topup", "subscription_setup", "redemption"]).optional(),
  status: z.enum(["pending", "completed", "failed", "expired", "refunded"]).optional(),
});

const refundBody = z.object({
  merchantOrderId: z.string().min(1),
  amountPaise: z.number().int().positive(),
});

export const paymentAdminController = {
  listOrders: (async (req, res, next) => {
    try {
      const q = parseQuery(listQuery, req.query);
      const result = await listPaymentOrders({
        userId: q.user_id,
        type: q.type,
        status: q.status,
        page: q.page,
        pageSize: q.page_size,
      });
      return ok(res, { orders: result.orders, pagination: { page: q.page, page_size: q.page_size, total: result.total } }, "Orders loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  initiateRefund: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const body = parseBody(refundBody, req.body);
      const result = await initiateRefund({
        merchantOrderId: body.merchantOrderId,
        amountPaise: body.amountPaise,
        actorUserId: req.user.id,
      });
      return ok(res, result, "Refund initiated.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  triggerNotify: (async (_req, res, next) => {
    try {
      const result = await notifyDueRedemptions();
      return ok(res, result, "Redemption notify batch complete.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  triggerExecute: (async (_req, res, next) => {
    try {
      const result = await executeDueRedemptions();
      return ok(res, result, "Redemption execute batch complete.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  getSubscriptionStatus: (async (req, res, next) => {
    try {
      const merchantSubscriptionId = req.params.merchantSubscriptionId;
      if (!merchantSubscriptionId) {
        return next(Errors.validation([{ path: "merchantSubscriptionId", code: "INVALID_VALUE", message: "Required." }]));
      }
      const result = await phonepeAdapter.getSubscriptionStatus(merchantSubscriptionId);
      return ok(res, result, "Subscription status loaded.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  cancelOrder: (async (req, res, next) => {
    try {
      if (!req.user) return next(Errors.notAuthenticated());
      const merchantOrderId = req.params.merchantOrderId;
      if (!merchantOrderId) {
        return next(Errors.validation([{ path: "merchantOrderId", code: "INVALID_VALUE", message: "Required." }]));
      }

      const pool = getPool();
      const res2 = await pool.query(
        `UPDATE payment_orders
         SET status = 'expired', updated_at = now()
         WHERE merchant_order_id = $1 AND status = 'pending'
         RETURNING *`,
        [merchantOrderId],
      );

      if (!res2.rowCount) {
        return next(Errors.validation([{
          path: "merchantOrderId",
          code: "INVALID_VALUE",
          message: "Order not found or is not in pending status.",
        }]));
      }

      return ok(res, { order: res2.rows[0] }, "Order cancelled.");
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,

  listWebhookEvents: (async (req, res, next) => {
    try {
      const q = parseQuery(webhookEventsQuery, req.query);
      const pool = getPool();
      const offset = (q.page - 1) * q.page_size;

      const conditions: string[] = [];
      const values: unknown[] = [];

      if (q.event) {
        conditions.push(`event = $${values.length + 1}`);
        values.push(q.event);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const countValues = [...values];
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM pg_webhook_events ${where}`,
        countValues,
      );
      const total = countResult.rows[0]?.total ?? 0;

      values.push(q.page_size, offset);
      const rows = await pool.query(
        `SELECT id, event_id, event, payload, processed_at
         FROM pg_webhook_events
         ${where}
         ORDER BY processed_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );

      return ok(
        res,
        {
          items: rows.rows,
          pagination: { page: q.page, page_size: q.page_size, total },
        },
        "Webhook events loaded.",
      );
    } catch (e) {
      return next(e);
    }
  }) satisfies RequestHandler,
};
