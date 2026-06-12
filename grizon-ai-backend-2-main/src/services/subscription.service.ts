import { getPool } from "../db/pool.js";
import { planConfig } from "../config/plan.js";
import { Errors } from "../utils/errors.js";
import { planRowToPlan, toIso } from "../utils/planSerialize.js";
import { planEvents } from "../events/plan.events.js";
import { logger } from "../utils/logger.js";
import { walletService } from "./wallet.service.js";
import type {
  BillingCycle,
  Plan,
  PlanCredits,
  SubscriptionAdmin,
  SubscriptionPublic,
  SubscriptionHistoryEvent,
  SubscriptionStatus,
} from "../types/plan.js";

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number | null };

interface DbQueryable {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

interface DbSession extends DbQueryable {
  release(): void;
}

interface DbPool extends DbQueryable {
  connect(): Promise<DbSession>;
}

function db(): DbPool {
  return getPool() as DbPool;
}

/** Pool or borrowed transaction/session client */
type DbExec = DbQueryable;

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505");
}

export function computePeriodWindow(
  billingCycle: BillingCycle,
  startAt: Date,
): { start: Date; end: Date } {
  const start = new Date(startAt);
  const end = new Date(start);
  if (billingCycle === "monthly") {
    end.setMonth(end.getMonth() + 1);
  } else {
    end.setFullYear(end.getFullYear() + 1);
  }
  return { start, end };
}

export function computeRolloverGrant(planCredits: PlanCredits, unusedCredits: number): number {
  if (!planCredits.rollover) return 0;
  const cap = planCredits.maxRollover ?? Number.POSITIVE_INFINITY;
  return Math.min(unusedCredits, cap);
}

function mapSubscriptionAdminRow(row: Record<string, unknown>): SubscriptionAdmin {
  const snap = row.plan_snapshot as Plan;
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    planSnapshot: snap,
    billingCycle: row.billing_cycle as BillingCycle,
    status: row.status as SubscriptionStatus,
    currentPeriodStart: toIso(row.current_period_start as string),
    currentPeriodEnd: toIso(row.current_period_end as string),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    creditsGranted: Number(row.credits_granted ?? 0),
    creditsRolledOver: Number(row.credits_rolled_over ?? 0),
    createdAt: toIso(row.created_at as string),
    pgProvider: (row.pg_provider as "phonepe" | null) ?? null,
    pgSubscriptionId: (row.pg_subscription_id as string | null) ?? null,
    pgMerchantTransactionId: (row.pg_merchant_transaction_id as string | null) ?? null,
    pgCustomerRef: (row.pg_customer_ref as string | null) ?? null,
  };
}

export function toSubscriptionPublic(row: Record<string, unknown>): SubscriptionPublic {
  const full = mapSubscriptionAdminRow(row);
  const {
    pgProvider: _pg,
    pgSubscriptionId: _ps,
    pgMerchantTransactionId: _pm,
    pgCustomerRef: _pc,
    ...pub
  } = full;
  return pub;
}

async function appendHistory(
  exec: DbExec,
  args: {
    subscriptionId: string;
    event: SubscriptionHistoryEvent;
    fromPlanId?: string | null;
    toPlanId?: string | null;
    actorUserId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await exec.query(
    `
    INSERT INTO subscription_history (subscription_id, event, from_plan_id, to_plan_id, actor_user_id, payload)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
  `,
    [
      args.subscriptionId,
      args.event,
      args.fromPlanId ?? null,
      args.toPlanId ?? null,
      args.actorUserId ?? null,
      JSON.stringify(args.payload ?? {}),
    ],
  );
}

async function loadPlanRow(exec: DbExec, planId: string): Promise<Record<string, unknown> | null> {
  const res = await exec.query(`SELECT * FROM plans WHERE id = $1 LIMIT 1`, [planId]);
  return res.rowCount ? (res.rows[0] as Record<string, unknown>) : null;
}

type SubscriptionLifecycleEvent = "created" | "upgraded" | "renewed" | "immediate_cancel";

/**
 * Apply wallet grants tied to a subscription lifecycle event.
 *
 * Always called *after* the subscription DB transaction has committed so that
 * a wallet failure cannot roll back a successful subscription change. Both the
 * primary grant and any rollover grant are written through `walletService.grant`
 * with deterministic idempotency keys, so re-running this helper for the same
 * (subscriptionId, event) is a safe no-op. This is the single source of truth
 * for translating `subscriptions.credits_granted` / `credits_rolled_over` into
 * `wallets.balance` and `wallet_transactions` rows.
 */
async function applySubscriptionGrants(args: {
  userId: string;
  subscriptionId: string;
  event: SubscriptionLifecycleEvent;
  granted: number;
  rolledOver: number;
  description?: string;
}): Promise<void> {
  if (args.granted <= 0 && args.rolledOver <= 0) return;

  await walletService.createForUser(args.userId);

  const baseKey = `subscription_grant:${args.subscriptionId}:${args.event}`;

  if (args.rolledOver > 0) {
    try {
      await walletService.grant(args.userId, args.rolledOver, "rollover", {
        description: `${args.description ?? args.event}_rollover`,
        idempotencyKey: `${baseKey}:rollover`,
      });
    } catch (e) {
      logger.error(
        { err: e, userId: args.userId, subscriptionId: args.subscriptionId, event: args.event },
        "subscription_rollover_grant_failed",
      );
      throw e;
    }
  }

  if (args.granted > 0) {
    try {
      await walletService.grant(args.userId, args.granted, "subscription", {
        description: `${args.description ?? args.event}_granted`,
        idempotencyKey: `${baseKey}:granted`,
      });
    } catch (e) {
      logger.error(
        { err: e, userId: args.userId, subscriptionId: args.subscriptionId, event: args.event },
        "subscription_grant_failed",
      );
      throw e;
    }
  }
}

export const subscriptionService = {
  computePeriodWindow,
  computeRolloverGrant,

  async getActiveSubscriptionForUser(userId: string): Promise<SubscriptionPublic | null> {
    const pool = db();
    const res = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );
    if (!res.rowCount) return null;
    return toSubscriptionPublic(res.rows[0] as Record<string, unknown>);
  },

  async assignFreePlan(
    userId: string,
    opts?: {
      client?: DbQueryable;
      /** Merged into subscription_history.payload for `created` */
      historyPayload?: Record<string, unknown>;
      /**
       * If true, do NOT call `applySubscriptionGrants` here. Used by callers that
       * own an outer DB transaction (e.g. `auth.service.register`) and must
       * commit first, then run the grant via `ensureGrantsForUser` post-commit.
       */
      deferGrants?: boolean;
    },
  ): Promise<SubscriptionPublic> {
    const exec: DbExec = opts?.client ?? db();

    const existing = await exec.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );
    if (existing.rowCount) {
      const sub = toSubscriptionPublic(existing.rows[0] as Record<string, unknown>);
      if (!opts?.client && !opts?.deferGrants) {
        await applySubscriptionGrants({
          userId,
          subscriptionId: sub.id,
          event: "created",
          granted: sub.creditsGranted,
          rolledOver: sub.creditsRolledOver,
          description: "subscription_granted",
        });
      }
      return sub;
    }

    const planRes = await exec.query(`SELECT * FROM plans WHERE id = $1 AND status = 'active' LIMIT 1`, [
      planConfig.freePlanId,
    ]);
    if (!planRes.rowCount) {
      throw Errors.internal(new Error(`FREE_PLAN_MISSING:${planConfig.freePlanId}`));
    }

    const planRow = planRes.rows[0] as Record<string, unknown>;
    const snapshot = planRowToPlan(planRow);
    const cycle = planConfig.defaultBillingCycle;
    const { start, end } = computePeriodWindow(cycle, new Date());
    const creditsIncluded = snapshot.credits.included;

    let ins;
    try {
      ins = await exec.query(
        `
        INSERT INTO subscriptions (
          user_id, plan_id, plan_snapshot, billing_cycle, status,
          current_period_start, current_period_end, cancel_at_period_end,
          credits_granted, credits_rolled_over
        ) VALUES ($1,$2,$3::jsonb,$4,'active',$5,$6,false,$7,$8)
        RETURNING *
      `,
        [userId, planConfig.freePlanId, JSON.stringify(snapshot), cycle, start, end, creditsIncluded, 0],
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw Errors.subscriptionConflict();
      }
      throw e;
    }

    const subRow = ins.rows[0] as Record<string, unknown>;

    await appendHistory(exec, {
      subscriptionId: String(subRow.id),
      event: "created",
      toPlanId: planConfig.freePlanId,
      payload: { reason: "assign_free", ...(opts?.historyPayload ?? {}) },
    });

    planEvents.emit("subscription.created" as any, {
      userId,
      subscriptionId: String(subRow.id),
      planId: planConfig.freePlanId,
    });

    if (!opts?.client && !opts?.deferGrants && creditsIncluded > 0) {
      await applySubscriptionGrants({
        userId,
        subscriptionId: String(subRow.id),
        event: "created",
        granted: creditsIncluded,
        rolledOver: 0,
        description: "subscription_granted",
      });
    }

    return toSubscriptionPublic(subRow);
  },

  /**
   * Reconciles wallet grants for a user's currently active subscription.
   *
   * Safe to call repeatedly; uses idempotency keys keyed on subscriptionId so
   * grants are applied at most once per (subscription, lifecycle event). Used
   * by `auth.service.register` after committing its outer transaction, and by
   * `planMiddleware` to recover from a missing grant on the very next request.
   */
  async ensureGrantsForUser(userId: string): Promise<void> {
    const pool = db();
    const res = await pool.query(
      `SELECT id, credits_granted, credits_rolled_over FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );
    if (!res.rowCount) return;
    const row = res.rows[0] as Record<string, unknown>;
    await applySubscriptionGrants({
      userId,
      subscriptionId: String(row.id),
      event: "created",
      granted: Number(row.credits_granted ?? 0),
      rolledOver: Number(row.credits_rolled_over ?? 0),
      description: "subscription_granted",
    });
  },

  async upgradeSubscription(args: {
    userId: string;
    planId: string;
    billingCycle: BillingCycle;
    actorUserId: string;
  }): Promise<SubscriptionPublic> {
    const pool = db();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const planRow = await loadPlanRow(client, args.planId);
      if (!planRow) throw Errors.planNotFound();
      if (planRow.status === "archived") throw Errors.planArchived();
      if (!planRow.is_public) throw Errors.planNotPublic();
      if (String(planRow.id) === planConfig.freePlanId) throw Errors.invalidUpgradeTarget();

      const targetPlan = planRowToPlan(planRow);
      const unusedCredits = 0; // Module 4 will supply real unused balance later
      const creditsRolledOver = computeRolloverGrant(targetPlan.credits, unusedCredits);

      const curRes = await client.query(
        `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' FOR UPDATE`,
        [args.userId],
      );
      if (!curRes.rowCount) throw Errors.subscriptionNotFound();
      const current = curRes.rows[0] as Record<string, unknown>;
      const currentPlanId = String(current.plan_id);
      const currentCycle = current.billing_cycle as BillingCycle;

      if (currentPlanId === args.planId && currentCycle === args.billingCycle) {
        throw Errors.alreadyOnPlan();
      }

      const { start, end } = computePeriodWindow(args.billingCycle, new Date());
      const creditsGranted = targetPlan.credits.included;

      await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [current.id]);

      await appendHistory(client, {
        subscriptionId: String(current.id),
        event: "cancelled",
        fromPlanId: currentPlanId,
        toPlanId: args.planId,
        actorUserId: args.actorUserId,
        payload: { reason: "upgraded_away" },
      });

      let ins;
      try {
        ins = await client.query(
          `
          INSERT INTO subscriptions (
            user_id, plan_id, plan_snapshot, billing_cycle, status,
            current_period_start, current_period_end, cancel_at_period_end,
            credits_granted, credits_rolled_over
          ) VALUES ($1,$2,$3::jsonb,$4,'active',$5,$6,false,$7,$8)
          RETURNING *
        `,
          [
            args.userId,
            args.planId,
            JSON.stringify(targetPlan),
            args.billingCycle,
            start,
            end,
            creditsGranted,
            creditsRolledOver,
          ],
        );
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.subscriptionConflict();
        throw e;
      }

      const newRow = ins.rows[0] as Record<string, unknown>;

      await appendHistory(client, {
        subscriptionId: String(newRow.id),
        event: "upgraded",
        fromPlanId: currentPlanId,
        toPlanId: args.planId,
        actorUserId: args.actorUserId,
        payload: { billingCycle: args.billingCycle, creditsRolledOver, unusedCredits },
      });

      await client.query("COMMIT");

      planEvents.emit("subscription.upgraded" as any, {
        userId: args.userId,
        fromPlanId: currentPlanId,
        toPlanId: args.planId,
        billingCycle: args.billingCycle,
        creditsGranted,
        creditsRolledOver,
      });

      await applySubscriptionGrants({
        userId: args.userId,
        subscriptionId: String(newRow.id),
        event: "upgraded",
        granted: creditsGranted,
        rolledOver: creditsRolledOver,
        description: "subscription_upgraded",
      });

      return toSubscriptionPublic(newRow);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async cancelSubscription(args: {
    userId: string;
    immediate: boolean;
    actorUserId: string;
  }): Promise<
    | { mode: "graceful"; subscription: SubscriptionPublic; effectiveAt: string }
    | { mode: "immediate"; subscription: SubscriptionPublic; cancelledSubscriptionId: string }
  > {
    const pool = db();

    const activeRes = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [args.userId],
    );
    if (!activeRes.rowCount) throw Errors.subscriptionNotFound();
    const active = activeRes.rows[0] as Record<string, unknown>;

    if (String(active.plan_id) === planConfig.freePlanId) {
      throw Errors.cannotCancelFreePlan();
    }

    if (!args.immediate) {
      await pool.query(`UPDATE subscriptions SET cancel_at_period_end = true WHERE id = $1`, [active.id]);

      await appendHistory(pool, {
        subscriptionId: String(active.id),
        event: "cancel_scheduled",
        actorUserId: args.actorUserId,
        payload: {},
      });

      const refreshed = await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [active.id]);
      const sub = toSubscriptionPublic(refreshed.rows[0] as Record<string, unknown>);
      const effectiveAt = sub.currentPeriodEnd;

      planEvents.emit("subscription.cancel_scheduled" as any, {
        userId: args.userId,
        effectiveAt,
      });

      return { mode: "graceful", subscription: sub, effectiveAt };
    }

    const conn = db();
    const client = await conn.connect();
    try {
      await client.query("BEGIN");

      const locked = await client.query(
        `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' FOR UPDATE`,
        [args.userId],
      );
      if (!locked.rowCount) throw Errors.subscriptionNotFound();
      const row = locked.rows[0] as Record<string, unknown>;
      if (String(row.plan_id) === planConfig.freePlanId) throw Errors.cannotCancelFreePlan();

      const cancelledId = String(row.id);

      await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [row.id]);

      await appendHistory(client, {
        subscriptionId: cancelledId,
        event: "cancelled",
        fromPlanId: String(row.plan_id),
        actorUserId: args.actorUserId,
        payload: { mode: "immediate" },
      });

      const freeSub = await subscriptionService.assignFreePlan(args.userId, {
        client,
        historyPayload: { reason: "immediate_cancel" },
      });

      await client.query("COMMIT");

      planEvents.emit("subscription.cancelled" as any, {
        userId: args.userId,
        sourcePlanId: String(row.plan_id),
      });

      await applySubscriptionGrants({
        userId: args.userId,
        subscriptionId: freeSub.id,
        event: "immediate_cancel",
        granted: freeSub.creditsGranted,
        rolledOver: freeSub.creditsRolledOver,
        description: "subscription_immediate_cancel",
      });

      return { mode: "immediate", subscription: freeSub, cancelledSubscriptionId: cancelledId };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async listSubscriptions(args: {
    userId?: string;
    planId?: string;
    status?: SubscriptionStatus;
    page: number;
    pageSize: number;
  }): Promise<{ subscriptions: SubscriptionAdmin[]; total: number }> {
    const pool = db();
    const offset = (args.page - 1) * args.pageSize;
    const filters: string[] = [`TRUE`];
    const values: unknown[] = [];
    let i = 1;

    if (args.userId) {
      filters.push(`user_id = $${i++}`);
      values.push(args.userId);
    }
    if (args.planId) {
      filters.push(`plan_id = $${i++}`);
      values.push(args.planId);
    }
    if (args.status) {
      filters.push(`status = $${i++}`);
      values.push(args.status);
    }

    const where = filters.join(" AND ");

    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM subscriptions WHERE ${where}`, values);
    const total = Number((countRes.rows[0] as { c?: number } | undefined)?.c ?? 0);

    values.push(args.pageSize, offset);
    const limIdx = i++;
    const offIdx = i;

    const dataRes = await pool.query(
      `SELECT * FROM subscriptions WHERE ${where} ORDER BY created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
      values,
    );

    const subscriptions = dataRes.rows.map((r: Record<string, unknown>) =>
      mapSubscriptionAdminRow(r),
    );
    return { subscriptions, total };
  },

  async adminAdjustSubscription(args: {
    subscriptionId: string;
    actorUserId: string;
    reason: string;
    patch: {
      status?: SubscriptionStatus;
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
      cancelAtPeriodEnd?: boolean;
      creditsGranted?: number;
      creditsRolledOver?: number;
      pgProvider?: "phonepe" | null;
      pgSubscriptionId?: string | null;
      pgMerchantTransactionId?: string | null;
      pgCustomerRef?: string | null;
    };
  }): Promise<SubscriptionAdmin> {
    const poolOut = db();
    const client = await poolOut.connect();

    try {
      await client.query("BEGIN");

      const subRes = await client.query(`SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE`, [
        args.subscriptionId,
      ]);
      if (!subRes.rowCount) throw Errors.subscriptionNotFound();
      const row = subRes.rows[0] as Record<string, unknown>;
      const userId = String(row.user_id);

      const nextStatus = args.patch.status ?? (row.status as SubscriptionStatus);
      const nextStart = args.patch.currentPeriodStart
        ? new Date(args.patch.currentPeriodStart)
        : new Date(row.current_period_start as string);
      const nextEnd = args.patch.currentPeriodEnd
        ? new Date(args.patch.currentPeriodEnd)
        : new Date(row.current_period_end as string);

      if (!(nextStart.getTime() < nextEnd.getTime())) {
        throw Errors.validation([
          {
            path: "currentPeriod",
            code: "INVALID_VALUE",
            message: "currentPeriodStart must be before currentPeriodEnd.",
          },
        ]);
      }

      if (nextStatus === "active") {
        const other = await client.query(
          `
          SELECT id FROM subscriptions
          WHERE user_id = $1 AND status = 'active' AND id <> $2
          LIMIT 1
        `,
          [userId, args.subscriptionId],
        );
        if (other.rowCount) {
          throw Errors.subscriptionConflict();
        }
      }

      const cancelAt =
        args.patch.cancelAtPeriodEnd !== undefined
          ? args.patch.cancelAtPeriodEnd
          : Boolean(row.cancel_at_period_end);

      const creditsGranted =
        args.patch.creditsGranted !== undefined ? args.patch.creditsGranted : Number(row.credits_granted ?? 0);
      const creditsRolledOver =
        args.patch.creditsRolledOver !== undefined
          ? args.patch.creditsRolledOver
          : Number(row.credits_rolled_over ?? 0);

      if (creditsGranted < 0 || creditsRolledOver < 0) {
        throw Errors.validation([
          { path: "credits", code: "VALUE_TOO_SMALL", message: "Credits must be non-negative." },
        ]);
      }

      const pgProvider =
        args.patch.pgProvider !== undefined ? args.patch.pgProvider : (row.pg_provider as string | null);
      const pgSubscriptionId =
        args.patch.pgSubscriptionId !== undefined ? args.patch.pgSubscriptionId : (row.pg_subscription_id as string | null);
      const pgMerchantTransactionId =
        args.patch.pgMerchantTransactionId !== undefined
          ? args.patch.pgMerchantTransactionId
          : (row.pg_merchant_transaction_id as string | null);
      const pgCustomerRef =
        args.patch.pgCustomerRef !== undefined ? args.patch.pgCustomerRef : (row.pg_customer_ref as string | null);

      await client.query(
        `
        UPDATE subscriptions SET
          status = $1,
          current_period_start = $2,
          current_period_end = $3,
          cancel_at_period_end = $4,
          credits_granted = $5,
          credits_rolled_over = $6,
          pg_provider = $7,
          pg_subscription_id = $8,
          pg_merchant_transaction_id = $9,
          pg_customer_ref = $10
        WHERE id = $11
      `,
        [
          nextStatus,
          nextStart.toISOString(),
          nextEnd.toISOString(),
          cancelAt,
          creditsGranted,
          creditsRolledOver,
          pgProvider,
          pgSubscriptionId,
          pgMerchantTransactionId,
          pgCustomerRef,
          args.subscriptionId,
        ],
      );

      await appendHistory(client, {
        subscriptionId: args.subscriptionId,
        event: "admin_adjusted",
        actorUserId: args.actorUserId,
        payload: { reason: args.reason, patch: args.patch },
      });

      await client.query("COMMIT");

      const out = await poolOut.query(`SELECT * FROM subscriptions WHERE id = $1`, [args.subscriptionId]);
      const mapped = mapSubscriptionAdminRow(out.rows[0] as Record<string, unknown>);

      planEvents.emit("subscription.admin_adjusted" as any, {
        subscriptionId: args.subscriptionId,
        actorUserId: args.actorUserId,
      });

      const prevGranted = Number(row.credits_granted ?? 0);
      const prevRolledOver = Number(row.credits_rolled_over ?? 0);
      const grantedDelta = creditsGranted - prevGranted;
      const rolledOverDelta = creditsRolledOver - prevRolledOver;
      const totalDelta = grantedDelta + rolledOverDelta;

      if (totalDelta !== 0) {
        const reason = `admin_subscription_adjust:${args.subscriptionId}:${args.reason}`.slice(0, 240);
        try {
          await walletService.adjust(userId, totalDelta, reason, args.actorUserId, true);
        } catch (e) {
          logger.error(
            { err: e, userId, subscriptionId: args.subscriptionId, totalDelta },
            "subscription_admin_adjust_wallet_failed",
          );
        }
      }

      return mapped;
    } catch (e) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(e)) throw Errors.subscriptionConflict();
      throw e;
    } finally {
      client.release();
    }
  },

  async adminAssignSubscription(args: {
    userId: string;
    planId: string;
    billingCycle: BillingCycle;
    actorUserId: string;
    reason: string;
  }): Promise<SubscriptionPublic> {
    const pool = db();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const planRow = await loadPlanRow(client, args.planId);
      if (!planRow) throw Errors.planNotFound();
      if (planRow.status === "archived") throw Errors.planArchived();

      const targetPlan = planRowToPlan(planRow);
      const creditsGranted = targetPlan.credits.included;

      const curRes = await client.query(
        `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' FOR UPDATE`,
        [args.userId],
      );

      let currentPlanId: string | null = null;
      if (curRes.rowCount) {
        const current = curRes.rows[0] as Record<string, unknown>;
        currentPlanId = String(current.plan_id);
        await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [current.id]);
        await appendHistory(client, {
          subscriptionId: String(current.id),
          event: "cancelled",
          fromPlanId: currentPlanId,
          toPlanId: args.planId,
          actorUserId: args.actorUserId,
          payload: { reason: args.reason, mode: "admin_assign" },
        });
      }

      const { start, end } = computePeriodWindow(args.billingCycle, new Date());

      let ins;
      try {
        ins = await client.query(
          `INSERT INTO subscriptions (
            user_id, plan_id, plan_snapshot, billing_cycle, status,
            current_period_start, current_period_end, cancel_at_period_end,
            credits_granted, credits_rolled_over
          ) VALUES ($1,$2,$3::jsonb,$4,'active',$5,$6,false,$7,0)
          RETURNING *`,
          [args.userId, args.planId, JSON.stringify(targetPlan), args.billingCycle, start, end, creditsGranted],
        );
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.subscriptionConflict();
        throw e;
      }

      const newRow = ins.rows[0] as Record<string, unknown>;

      await appendHistory(client, {
        subscriptionId: String(newRow.id),
        event: "admin_adjusted",
        fromPlanId: currentPlanId,
        toPlanId: args.planId,
        actorUserId: args.actorUserId,
        payload: { reason: args.reason, billingCycle: args.billingCycle, mode: "admin_assign" },
      });

      await client.query("COMMIT");

      planEvents.emit("subscription.upgraded" as any, {
        userId: args.userId,
        fromPlanId: currentPlanId,
        toPlanId: args.planId,
        billingCycle: args.billingCycle,
        creditsGranted,
        creditsRolledOver: 0,
      });

      await applySubscriptionGrants({
        userId: args.userId,
        subscriptionId: String(newRow.id),
        event: "upgraded",
        granted: creditsGranted,
        rolledOver: 0,
        description: "admin_assign_subscription",
      });

      return toSubscriptionPublic(newRow);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async adminCancelSubscription(args: {
    subscriptionId: string;
    immediate: boolean;
    actorUserId: string;
    reason: string;
  }): Promise<{ mode: "stop" | "cancel"; subscription: SubscriptionPublic }> {
    const pool = db();

    const subRes = await pool.query(`SELECT * FROM subscriptions WHERE id = $1 LIMIT 1`, [args.subscriptionId]);
    if (!subRes.rowCount) throw Errors.subscriptionNotFound();
    const subRow = subRes.rows[0] as Record<string, unknown>;
    const userId = String(subRow.user_id);

    if (String(subRow.plan_id) === planConfig.freePlanId) throw Errors.cannotCancelFreePlan();
    if (subRow.status !== "active") throw Errors.subscriptionNotFound();

    if (!args.immediate) {
      await pool.query(`UPDATE subscriptions SET cancel_at_period_end = true WHERE id = $1`, [args.subscriptionId]);
      await appendHistory(pool, {
        subscriptionId: args.subscriptionId,
        event: "cancel_scheduled",
        actorUserId: args.actorUserId,
        payload: { reason: args.reason },
      });
      const refreshed = await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [args.subscriptionId]);
      return { mode: "stop", subscription: toSubscriptionPublic(refreshed.rows[0] as Record<string, unknown>) };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const locked = await client.query(
        `SELECT * FROM subscriptions WHERE id = $1 AND status = 'active' FOR UPDATE`,
        [args.subscriptionId],
      );
      if (!locked.rowCount) throw Errors.subscriptionNotFound();
      const row = locked.rows[0] as Record<string, unknown>;

      await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [row.id]);
      await appendHistory(client, {
        subscriptionId: args.subscriptionId,
        event: "cancelled",
        fromPlanId: String(row.plan_id),
        actorUserId: args.actorUserId,
        payload: { reason: args.reason, mode: "admin_immediate" },
      });

      const freeSub = await subscriptionService.assignFreePlan(userId, {
        client,
        historyPayload: { reason: "admin_immediate_cancel" },
      });

      await client.query("COMMIT");

      planEvents.emit("subscription.cancelled" as any, { userId, sourcePlanId: String(row.plan_id) });

      await applySubscriptionGrants({
        userId,
        subscriptionId: freeSub.id,
        event: "immediate_cancel",
        granted: freeSub.creditsGranted,
        rolledOver: freeSub.creditsRolledOver,
        description: "admin_cancel_subscription",
      });

      return { mode: "cancel", subscription: freeSub };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Renew subscriptions whose `current_period_end` has passed.
   *
   * For each due subscription:
   *  - If `cancel_at_period_end=true`, cancel and assign the free plan.
   *  - Otherwise, advance `current_period_*` by one cycle, refresh
   *    `credits_granted` (= plan.credits.included) and `credits_rolled_over`
   *    (computed via `computeRolloverGrant` against current wallet balance),
   *    write `subscription_history(event='renewed')`, and apply the matching
   *    grants idempotently via `applySubscriptionGrants`.
   *
   * Designed to be invoked by a cron worker (see
   * `src/workers/subscription.renewal.worker.ts`). Returns the number of
   * subscriptions processed in this batch.
   */
  async renewDueSubscriptions(opts?: { batchSize?: number }): Promise<{
    processed: number;
    renewed: number;
    cancelled: number;
  }> {
    const pool = db();
    const batchSize = opts?.batchSize ?? 50;
    const dueRes = await pool.query(
      `
      SELECT id FROM subscriptions
      WHERE status = 'active' AND current_period_end <= now()
      ORDER BY current_period_end ASC
      LIMIT $1
    `,
      [batchSize],
    );

    let renewed = 0;
    let cancelled = 0;

    for (const due of dueRes.rows) {
      const id = String(due.id);
      try {
        const result = await renewOneSubscription(id);
        if (result === "renewed") renewed += 1;
        if (result === "cancelled") cancelled += 1;
      } catch (e) {
        logger.error({ err: e, subscriptionId: id }, "subscription_renew_failed");
      }
    }

    return { processed: dueRes.rowCount ?? 0, renewed, cancelled };
  },
};

async function renewOneSubscription(subscriptionId: string): Promise<"renewed" | "cancelled" | "skipped"> {
  const pool = db();
  const client = await pool.connect();

  let outcome: "renewed" | "cancelled" | "skipped" = "skipped";
  let grantArgs: { userId: string; granted: number; rolledOver: number } | null = null;
  let cancelledFreeSub: SubscriptionPublic | null = null;
  let cancelledUserId: string | null = null;
  let cancelledSourcePlanId: string | null = null;

  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      `SELECT * FROM subscriptions WHERE id = $1 AND status = 'active' AND current_period_end <= now() FOR UPDATE`,
      [subscriptionId],
    );
    if (!lockRes.rowCount) {
      await client.query("ROLLBACK");
      return "skipped";
    }

    // PhonePe AutoPay subscriptions are renewed via the redemption worker, not here
    const preCheck = lockRes.rows[0] as Record<string, unknown>;
    if (preCheck.pg_provider === "phonepe" && preCheck.pg_customer_ref) {
      await client.query("ROLLBACK");
      return "skipped";
    }

    const row = lockRes.rows[0] as Record<string, unknown>;
    const userId = String(row.user_id);
    const cycle = row.billing_cycle as BillingCycle;
    const cancelAtPeriodEnd = Boolean(row.cancel_at_period_end);
    const sourcePlanId = String(row.plan_id);

    if (cancelAtPeriodEnd) {
      await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [row.id]);
      await appendHistory(client, {
        subscriptionId,
        event: "cancelled",
        fromPlanId: sourcePlanId,
        payload: { mode: "scheduled_renewal" },
      });

      const freeSub = await subscriptionService.assignFreePlan(userId, {
        client,
        historyPayload: { reason: "scheduled_cancel_renewal" },
      });

      await client.query("COMMIT");
      cancelledFreeSub = freeSub;
      cancelledUserId = userId;
      cancelledSourcePlanId = sourcePlanId;
      outcome = "cancelled";
    } else {
      const snapshot = row.plan_snapshot as Plan;
      const planCredits = snapshot.credits;
      const granted = Number(planCredits.included ?? 0);

      const walletRes = await client.query(
        `SELECT balance FROM wallets WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      const currentBalance = walletRes.rowCount ? Number(walletRes.rows[0].balance ?? 0) : 0;
      const rolledOver = computeRolloverGrant(planCredits, Math.max(0, currentBalance));

      const periodStart = new Date(row.current_period_end as string);
      const { end: nextPeriodEnd } = computePeriodWindow(cycle, periodStart);

      await client.query(
        `
        UPDATE subscriptions SET
          current_period_start = $1,
          current_period_end = $2,
          credits_granted = $3,
          credits_rolled_over = $4
        WHERE id = $5
      `,
        [periodStart.toISOString(), nextPeriodEnd.toISOString(), granted, rolledOver, row.id],
      );

      await appendHistory(client, {
        subscriptionId,
        event: "renewed",
        toPlanId: sourcePlanId,
        payload: { granted, rolledOver, billingCycle: cycle },
      });

      await client.query("COMMIT");
      grantArgs = { userId, granted, rolledOver };
      outcome = "renewed";
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  if (outcome === "renewed" && grantArgs) {
    planEvents.emit("subscription.renewed" as any, {
      userId: grantArgs.userId,
      subscriptionId,
      granted: grantArgs.granted,
      rolledOver: grantArgs.rolledOver,
    });
    await applySubscriptionGrants({
      userId: grantArgs.userId,
      subscriptionId,
      event: "renewed",
      granted: grantArgs.granted,
      rolledOver: grantArgs.rolledOver,
      description: "subscription_renewed",
    });
  }

  if (outcome === "cancelled" && cancelledFreeSub && cancelledUserId && cancelledSourcePlanId) {
    planEvents.emit("subscription.cancelled" as any, {
      userId: cancelledUserId,
      sourcePlanId: cancelledSourcePlanId,
    });
    await applySubscriptionGrants({
      userId: cancelledUserId,
      subscriptionId: cancelledFreeSub.id,
      event: "immediate_cancel",
      granted: cancelledFreeSub.creditsGranted,
      rolledOver: cancelledFreeSub.creditsRolledOver,
      description: "subscription_scheduled_cancel",
    });
  }

  return outcome;
}
