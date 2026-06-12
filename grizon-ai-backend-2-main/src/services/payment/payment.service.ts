import { randomUUID } from "crypto";
import { getPool } from "../../db/pool.js";
import { Errors } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { walletService } from "../wallet.service.js";
import { subscriptionService } from "../subscription.service.js";
import { planConfig } from "../../config/plan.js";
import { phonepeAdapter } from "./phonepe.adapter.js";
import type { BillingCycle, Plan } from "../../types/plan.js";

// ─── DB helpers ────────────────────────────────────────────────────────────

type DbPool = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  connect(): Promise<DbClient>;
};
type DbClient = DbPool & { release(): void };

function db(): DbPool {
  return getPool() as DbPool;
}

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505");
}

function newMerchantOrderId(): string {
  return `ord_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function newMerchantSubscriptionId(): string {
  return `sub_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function newMerchantRefundId(): string {
  return `ref_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function billingCycleToFrequency(cycle: BillingCycle): "MONTHLY" | "YEARLY" {
  return cycle === "monthly" ? "MONTHLY" : "YEARLY";
}

function planPriceInPaise(plan: Plan, cycle: BillingCycle): number {
  const price = cycle === "monthly" ? plan.pricing.monthly : plan.pricing.annual;
  return Math.round(price * 100);
}

// ─── Webhook event deduplication ───────────────────────────────────────────

async function isWebhookAlreadyProcessed(eventId: string): Promise<boolean> {
  const res = await db().query(
    `SELECT 1 FROM pg_webhook_events WHERE event_id = $1 LIMIT 1`,
    [eventId],
  );
  return Boolean(res.rowCount);
}

async function recordWebhookEvent(eventId: string, event: string, payload: unknown): Promise<void> {
  try {
    await db().query(
      `INSERT INTO pg_webhook_events (event_id, event, payload) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, event, JSON.stringify(payload)],
    );
  } catch {
    // Non-fatal; idempotency check is best-effort
  }
}

// ─── Payment order helpers ─────────────────────────────────────────────────

type PaymentOrderRow = Record<string, unknown>;

async function getOrderByMerchantId(merchantOrderId: string): Promise<PaymentOrderRow | null> {
  const res = await db().query(
    `SELECT * FROM payment_orders WHERE merchant_order_id = $1 LIMIT 1`,
    [merchantOrderId],
  );
  return res.rowCount ? (res.rows[0] as PaymentOrderRow) : null;
}

async function markOrderCompleted(
  merchantOrderId: string,
  pgOrderId: string,
  pgTransactionId?: string,
): Promise<void> {
  await db().query(
    `UPDATE payment_orders
     SET status = 'completed', pg_order_id = $1, pg_transaction_id = $2, updated_at = now()
     WHERE merchant_order_id = $3 AND status = 'pending'`,
    [pgOrderId, pgTransactionId ?? null, merchantOrderId],
  );
}

async function markOrderFailed(merchantOrderId: string): Promise<void> {
  await db().query(
    `UPDATE payment_orders SET status = 'failed', updated_at = now()
     WHERE merchant_order_id = $1 AND status NOT IN ('completed','refunded')`,
    [merchantOrderId],
  );
}

// ─── TOPUP FLOW ────────────────────────────────────────────────────────────

export async function initiateTopup(args: {
  userId: string;
  packageId: string;
  plan: Plan;
  frontendRedirectUrlBuilder: (merchantOrderId: string) => string;
}): Promise<{ merchantOrderId: string; redirectUrl: string; creditsToAdd: number; amountPaise: number }> {
  if (!args.plan.credits.topupEnabled) {
    throw Errors.topupsDisabledOnPlan();
  }

  const pkg = args.plan.credits.topupPackages.find(
    (p) => p.id === args.packageId || `${p.credits}_${p.price}` === args.packageId,
  );
  if (!pkg) throw Errors.invalidPackage();

  const merchantOrderId = newMerchantOrderId();
  const amountPaise = Math.round(pkg.price * 100);

  await db().query(
    `INSERT INTO payment_orders
       (merchant_order_id, user_id, type, amount_paise, credits, status, expire_at)
     VALUES ($1,$2,'topup',$3,$4,'pending', now() + interval '30 minutes')`,
    [merchantOrderId, args.userId, amountPaise, pkg.credits],
  );

  const { redirectUrl } = await phonepeAdapter.createTopupOrder({
    merchantOrderId,
    amountPaise,
    redirectUrl: args.frontendRedirectUrlBuilder(merchantOrderId),
  });

  return {
    merchantOrderId,
    redirectUrl,
    creditsToAdd: pkg.credits,
    amountPaise,
  };
}

export async function pollTopupStatus(args: {
  userId: string;
  merchantOrderId: string;
}): Promise<{ status: string; creditsToAdd: number }> {
  const order = await getOrderByMerchantId(args.merchantOrderId);
  if (!order) throw Errors.paymentOrderNotFound();
  if (String(order.user_id) !== args.userId) throw Errors.paymentOrderNotFound();

  if (order.status === "completed") {
    return { status: "completed", creditsToAdd: Number(order.credits) };
  }

  // Re-check with PhonePe
  let pgState: string;
  let pgTransactionId: string | undefined;
  try {
    const remote = await phonepeAdapter.getTopupOrderStatus(args.merchantOrderId);
    pgState = remote.state;
    pgTransactionId = remote.pgTransactionId;
  } catch (e) {
    logger.warn({ err: e, merchantOrderId: args.merchantOrderId }, "topup_status_poll_failed");
    return { status: String(order.status), creditsToAdd: Number(order.credits) };
  }

  if (pgState === "COMPLETED" && order.status === "pending") {
    await handleTopupCompleted({
      merchantOrderId: args.merchantOrderId,
      pgOrderId: String(order.pg_order_id ?? args.merchantOrderId),
      pgTransactionId,
      userId: args.userId,
      credits: Number(order.credits),
    });
    return { status: "completed", creditsToAdd: Number(order.credits) };
  }

  if (pgState === "FAILED" || pgState === "EXPIRED") {
    await markOrderFailed(args.merchantOrderId);
    return { status: pgState.toLowerCase(), creditsToAdd: 0 };
  }

  return { status: "pending", creditsToAdd: Number(order.credits) };
}

// ─── SUBSCRIPTION SETUP FLOW ───────────────────────────────────────────────

export async function initiateSubscription(args: {
  userId: string;
  planId: string;
  billingCycle: BillingCycle;
  frontendRedirectUrlBuilder: (merchantOrderId: string) => string;
  mobileNumber?: string;
}): Promise<{ merchantOrderId: string; merchantSubscriptionId: string; redirectUrl: string }> {
  const pool = db();

  // Load plan
  const planRes = await pool.query(`SELECT * FROM plans WHERE id = $1 AND status = 'active' LIMIT 1`, [args.planId]);
  if (!planRes.rowCount) throw Errors.planNotFound();

  const planRow = planRes.rows[0] as Record<string, unknown>;
  if (!planRow.is_public) throw Errors.planNotPublic();
  if (String(planRow.id) === planConfig.freePlanId) throw Errors.invalidUpgradeTarget();

  // Check existing subscription
  const existing = await pool.query(
    `SELECT plan_id, pg_provider FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [args.userId],
  );
  if (existing.rowCount) {
    const cur = existing.rows[0] as Record<string, unknown>;
    if (String(cur.plan_id) !== planConfig.freePlanId) {
      throw Errors.subscriptionAlreadyActive();
    }
  }

  // Check for pending subscription setup order
  const pendingSetup = await pool.query(
    `SELECT id FROM payment_orders
     WHERE user_id = $1 AND type = 'subscription_setup' AND status = 'pending'
       AND expire_at > now()
     LIMIT 1`,
    [args.userId],
  );
  if (pendingSetup.rowCount) {
    throw Errors.paymentAlreadyCompleted();
  }

  const plan = planRow as unknown as { pricing: { monthly: number; annual: number }; credits: { included: number } };
  const snapshot = planRow as unknown as Plan;
  const amountPaise = planPriceInPaise(snapshot, args.billingCycle);
  const merchantOrderId = newMerchantOrderId();
  const merchantSubscriptionId = newMerchantSubscriptionId();

  // Expire at: 1 year from now for the mandate
  const subscriptionExpireAt = Date.now() + 365 * 24 * 60 * 60 * 1000;

  await pool.query(
    `INSERT INTO payment_orders
       (merchant_order_id, user_id, type, amount_paise, credits, status,
        merchant_subscription_id, expire_at, metadata)
     VALUES ($1,$2,'subscription_setup',$3,$4,'pending',$5, now() + interval '1 hour', $6::jsonb)`,
    [
      merchantOrderId,
      args.userId,
      amountPaise,
      (plan.credits as { included: number }).included,
      merchantSubscriptionId,
      JSON.stringify({ planId: args.planId, billingCycle: args.billingCycle }),
    ],
  );

  const { redirectUrl } = await phonepeAdapter.createSubscriptionOrder({
    merchantOrderId,
    merchantSubscriptionId,
    amountPaise,
    frequency: billingCycleToFrequency(args.billingCycle),
    redirectUrl: args.frontendRedirectUrlBuilder(merchantOrderId),
    subscriptionExpireAt,
    mobileNumber: args.mobileNumber,
  });

  return { merchantOrderId, merchantSubscriptionId, redirectUrl };
}

export async function cancelSubscriptionWithPG(args: {
  userId: string;
  immediate: boolean;
  actorUserId: string;
}): Promise<ReturnType<typeof subscriptionService.cancelSubscription>> {
  const pool = db();

  const subRes = await pool.query(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [args.userId],
  );
  if (!subRes.rowCount) throw Errors.subscriptionNotFound();

  const sub = subRes.rows[0] as Record<string, unknown>;

  // Cancel mandate at PhonePe if this is a PG-managed subscription
  if (args.immediate && sub.pg_provider === "phonepe" && sub.pg_customer_ref) {
    try {
      await phonepeAdapter.cancelSubscription(String(sub.pg_customer_ref));
    } catch (e) {
      logger.warn({ err: e, userId: args.userId }, "phonepe_cancel_subscription_failed");
      // Continue with DB cancellation even if PG call fails
    }
  }

  return subscriptionService.cancelSubscription(args);
}

// ─── WEBHOOK HANDLERS ──────────────────────────────────────────────────────

export interface PhonePeWebhookPayload {
  event: string;
  payload: {
    state: string;
    merchantId?: string;
    merchantOrderId?: string;
    orderId?: string;
    amount?: number;
    expireAt?: number;
    metaInfo?: Record<string, unknown>;
  };
  paymentFlow?: {
    type?: string;
    merchantSubscriptionId?: string;
    subscriptionId?: string;
    amountType?: string;
    maxAmount?: number;
    frequency?: string;
  };
}

export async function handleWebhook(rawBody: Buffer, authHeader: string): Promise<void> {
  if (!phonepeAdapter.verifyWebhookSignature(authHeader, rawBody)) {
    throw Errors.webhookSignatureInvalid();
  }

  let payload: PhonePeWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as PhonePeWebhookPayload;
  } catch {
    throw Errors.validation([{ path: "body", code: "INVALID_TYPE", message: "Invalid JSON" }]);
  }

  const event = payload.event;
  const orderId = payload.payload?.orderId ?? "";
  const merchantOrderId = payload.payload?.merchantOrderId ?? "";
  const eventId = `${orderId}:${event}`;

  // Idempotency check
  if (await isWebhookAlreadyProcessed(eventId)) {
    logger.info({ eventId }, "webhook_duplicate_ignored");
    return;
  }
  await recordWebhookEvent(eventId, event, payload);

  logger.info({ event, merchantOrderId, orderId }, "phonepe_webhook_received");

  switch (event) {
    case "checkout.order.completed":
      await handleCheckoutOrderCompleted(payload);
      break;
    case "checkout.order.failed":
      await handleCheckoutOrderFailed(payload);
      break;
    case "subscription.redemption.transaction.completed":
      await handleRedemptionCompleted(payload);
      break;
    case "subscription.redemption.transaction.failed":
    case "subscription.redemption.order.failed":
      await handleRedemptionFailed(payload);
      break;
    case "subscription.revoked":
      await handleSubscriptionRevoked(payload);
      break;
    case "subscription.cancelled":
      await handleSubscriptionCancelled(payload);
      break;
    case "subscription.paused":
      await handleSubscriptionPaused(payload);
      break;
    case "subscription.unpaused":
      await handleSubscriptionUnpaused(payload);
      break;
    case "pg.refund.completed":
      await handleRefundCompleted(payload);
      break;
    default:
      logger.info({ event }, "phonepe_webhook_unhandled_event");
  }
}

async function handleCheckoutOrderCompleted(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantOrderId = payload.payload.merchantOrderId ?? "";
  if (!merchantOrderId) return;

  const order = await getOrderByMerchantId(merchantOrderId);
  if (!order) {
    logger.warn({ merchantOrderId }, "webhook_order_not_found");
    return;
  }
  if (order.status !== "pending") return;

  const pgOrderId = payload.payload.orderId ?? merchantOrderId;

  if (order.type === "topup") {
    await handleTopupCompleted({
      merchantOrderId,
      pgOrderId,
      userId: String(order.user_id),
      credits: Number(order.credits),
    });
  } else if (order.type === "subscription_setup") {
    await handleSubscriptionSetupCompleted(order, payload, pgOrderId);
  }
}

async function handleTopupCompleted(args: {
  merchantOrderId: string;
  pgOrderId: string;
  pgTransactionId?: string;
  userId: string;
  credits: number;
}): Promise<void> {
  // Acquire row-level lock to prevent double-credit
  const pool = db();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      `SELECT * FROM payment_orders WHERE merchant_order_id = $1 AND status = 'pending' FOR UPDATE`,
      [args.merchantOrderId],
    );
    if (!lockRes.rowCount) {
      // Already processed by a concurrent path
      await client.query("ROLLBACK");
      return;
    }

    await client.query(
      `UPDATE payment_orders
       SET status = 'completed', pg_order_id = $1, pg_transaction_id = $2, updated_at = now()
       WHERE merchant_order_id = $3`,
      [args.pgOrderId, args.pgTransactionId ?? null, args.merchantOrderId],
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // Grant credits outside the transaction (idempotent)
  try {
    await walletService.topup(args.userId, args.credits, args.merchantOrderId);
    logger.info({ userId: args.userId, credits: args.credits, merchantOrderId: args.merchantOrderId }, "topup_completed");
  } catch (e) {
    logger.error({ err: e, userId: args.userId, merchantOrderId: args.merchantOrderId }, "topup_grant_failed");
    throw e;
  }
}

async function handleSubscriptionSetupCompleted(
  order: PaymentOrderRow,
  payload: PhonePeWebhookPayload,
  pgOrderId: string,
): Promise<void> {
  const metadata = (order.metadata as Record<string, unknown>) ?? {};
  const planId = String(metadata.planId ?? "");
  const billingCycle = (metadata.billingCycle ?? "monthly") as BillingCycle;
  const merchantSubscriptionId = String(order.merchant_subscription_id ?? "");
  const pgSubscriptionId = payload.paymentFlow?.subscriptionId ?? "";

  if (!planId) {
    logger.warn({ order }, "subscription_setup_webhook_missing_plan");
    return;
  }

  const pool = db();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      `SELECT * FROM payment_orders WHERE merchant_order_id = $1 AND status = 'pending' FOR UPDATE`,
      [String(order.merchant_order_id)],
    );
    if (!lockRes.rowCount) {
      await client.query("ROLLBACK");
      return;
    }

    await client.query(
      `UPDATE payment_orders
       SET status = 'completed', pg_order_id = $1, updated_at = now()
       WHERE merchant_order_id = $2`,
      [pgOrderId, String(order.merchant_order_id)],
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // Upgrade subscription outside DB transaction (subscriptionService manages its own)
  try {
    const sub = await subscriptionService.upgradeSubscription({
      userId: String(order.user_id),
      planId,
      billingCycle,
      actorUserId: String(order.user_id),
    });

    // Store PG identifiers on the subscription
    await db().query(
      `UPDATE subscriptions
       SET pg_provider = 'phonepe',
           pg_subscription_id = $1,
           pg_merchant_transaction_id = $2,
           pg_customer_ref = $3
       WHERE id = $4`,
      [pgSubscriptionId, String(order.merchant_order_id), merchantSubscriptionId, sub.id],
    );

    // Back-link payment_orders → subscriptions
    await db().query(
      `UPDATE payment_orders SET subscription_id = $1 WHERE merchant_order_id = $2`,
      [sub.id, String(order.merchant_order_id)],
    );

    logger.info({ userId: order.user_id, planId, billingCycle }, "subscription_setup_completed");
  } catch (e) {
    logger.error({ err: e, order }, "subscription_setup_upgrade_failed");
    throw e;
  }
}

async function handleCheckoutOrderFailed(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantOrderId = payload.payload.merchantOrderId ?? "";
  if (!merchantOrderId) return;
  await markOrderFailed(merchantOrderId);
  logger.info({ merchantOrderId }, "checkout_order_failed");
}

async function handleRedemptionCompleted(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantOrderId = payload.payload.merchantOrderId ?? "";
  const merchantSubscriptionId = payload.paymentFlow?.merchantSubscriptionId ?? "";
  if (!merchantOrderId) return;

  const order = await getOrderByMerchantId(merchantOrderId);
  if (!order) {
    logger.warn({ merchantOrderId }, "redemption_order_not_found");
    return;
  }
  if (order.status !== "pending") return;

  const pool = db();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      `SELECT * FROM payment_orders WHERE merchant_order_id = $1 AND status = 'pending' FOR UPDATE`,
      [merchantOrderId],
    );
    if (!lockRes.rowCount) {
      await client.query("ROLLBACK");
      return;
    }

    await client.query(
      `UPDATE payment_orders SET status = 'completed', updated_at = now() WHERE merchant_order_id = $1`,
      [merchantOrderId],
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // Advance subscription period
  if (merchantSubscriptionId) {
    try {
      await advanceSubscriptionPeriod(merchantSubscriptionId, String(order.user_id));
    } catch (e) {
      logger.error({ err: e, merchantSubscriptionId }, "redemption_advance_period_failed");
    }
  }
}

async function advanceSubscriptionPeriod(
  merchantSubscriptionId: string,
  userId: string,
): Promise<void> {
  const pool = db();
  const res = await pool.query(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND pg_customer_ref = $2 AND status = 'active' LIMIT 1`,
    [userId, merchantSubscriptionId],
  );
  if (!res.rowCount) {
    logger.warn({ userId, merchantSubscriptionId }, "advance_period_subscription_not_found");
    return;
  }

  // Delegate to subscriptionService renewal logic
  const sub = res.rows[0] as Record<string, unknown>;
  await subscriptionService.renewDueSubscriptions({ batchSize: 1 });
  logger.info({ subscriptionId: sub.id, userId }, "subscription_period_advanced");
}

async function handleRedemptionFailed(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantOrderId = payload.payload.merchantOrderId ?? "";
  if (!merchantOrderId) return;

  const order = await getOrderByMerchantId(merchantOrderId);
  if (!order) return;

  const retryCount = Number(order.retry_count ?? 0);

  if (retryCount >= 3) {
    // All retries exhausted — cancel subscription
    logger.warn({ merchantOrderId, retryCount }, "redemption_all_retries_exhausted");
    await markOrderFailed(merchantOrderId);

    const merchantSubscriptionId = String(order.merchant_subscription_id ?? "");
    if (merchantSubscriptionId) {
      try {
        await cancelSubscriptionWithPG({
          userId: String(order.user_id),
          immediate: true,
          actorUserId: String(order.user_id),
        });
        logger.info({ userId: order.user_id, merchantSubscriptionId }, "subscription_cancelled_after_redemption_failure");
      } catch (e) {
        logger.error({ err: e, userId: order.user_id }, "subscription_cancel_after_failure_failed");
      }
    }
    return;
  }

  // Schedule retry by incrementing counter and resetting to pending
  await db().query(
    `UPDATE payment_orders
     SET retry_count = retry_count + 1, status = 'pending', updated_at = now()
     WHERE merchant_order_id = $1`,
    [merchantOrderId],
  );

  logger.info({ merchantOrderId, nextRetry: retryCount + 1 }, "redemption_scheduled_retry");
}

async function handleSubscriptionRevoked(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantSubscriptionId = payload.paymentFlow?.merchantSubscriptionId ?? "";
  if (!merchantSubscriptionId) return;

  const res = await db().query(
    `SELECT user_id FROM subscriptions WHERE pg_customer_ref = $1 AND status = 'active' LIMIT 1`,
    [merchantSubscriptionId],
  );
  if (!res.rowCount) return;

  const userId = String(res.rows[0].user_id);
  try {
    await subscriptionService.cancelSubscription({
      userId,
      immediate: true,
      actorUserId: userId,
    });
    logger.info({ userId, merchantSubscriptionId }, "subscription_revoked_by_user");
  } catch (e) {
    logger.error({ err: e, userId, merchantSubscriptionId }, "subscription_revoke_handling_failed");
  }
}

async function handleSubscriptionCancelled(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantSubscriptionId = payload.paymentFlow?.merchantSubscriptionId ?? "";
  if (!merchantSubscriptionId) return;

  // Mark subscription as cancelled (merchant-initiated, DB may already be updated)
  await db().query(
    `UPDATE subscriptions SET status = 'cancelled' WHERE pg_customer_ref = $1 AND status = 'active'`,
    [merchantSubscriptionId],
  );
  logger.info({ merchantSubscriptionId }, "subscription_cancelled_via_webhook");
}

async function handleSubscriptionPaused(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantSubscriptionId = payload.paymentFlow?.merchantSubscriptionId ?? "";
  if (!merchantSubscriptionId) return;

  await db().query(
    `UPDATE subscriptions SET status = 'paused' WHERE pg_customer_ref = $1 AND status = 'active'`,
    [merchantSubscriptionId],
  );
  logger.info({ merchantSubscriptionId }, "subscription_paused");
}

async function handleSubscriptionUnpaused(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantSubscriptionId = payload.paymentFlow?.merchantSubscriptionId ?? "";
  if (!merchantSubscriptionId) return;

  await db().query(
    `UPDATE subscriptions SET status = 'active' WHERE pg_customer_ref = $1 AND status = 'paused'`,
    [merchantSubscriptionId],
  );
  logger.info({ merchantSubscriptionId }, "subscription_unpaused");
}

async function handleRefundCompleted(payload: PhonePeWebhookPayload): Promise<void> {
  const merchantOrderId = payload.payload.merchantOrderId ?? "";
  logger.info({ merchantOrderId }, "refund_completed");
  // Wallet credit adjustments for refunds are handled by admin manually as needed
}

// ─── REDEMPTION CRON FUNCTIONS ─────────────────────────────────────────────

export async function notifyDueRedemptions(opts?: { batchSize?: number }): Promise<{
  notified: number;
  failed: number;
}> {
  const batchSize = opts?.batchSize ?? 50;
  const notifyWindow = 24 * 60 * 60 * 1000; // 24h before period_end

  const res = await db().query(
    `SELECT s.id, s.user_id, s.plan_snapshot, s.billing_cycle, s.current_period_end, s.pg_customer_ref
     FROM subscriptions s
     WHERE s.status = 'active'
       AND s.pg_provider = 'phonepe'
       AND s.pg_customer_ref IS NOT NULL
       AND s.cancel_at_period_end = false
       AND s.current_period_end BETWEEN now() AND now() + interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM payment_orders po
         WHERE po.merchant_subscription_id = s.pg_customer_ref
           AND po.type = 'redemption'
           AND po.status IN ('pending','completed')
           AND po.created_at > s.current_period_start
       )
     LIMIT $1`,
    [batchSize],
  );

  let notified = 0;
  let failed = 0;

  for (const row of res.rows) {
    const sub = row as Record<string, unknown>;
    try {
      await notifyOneRedemption(sub);
      notified++;
    } catch (e) {
      failed++;
      logger.error({ err: e, subscriptionId: sub.id }, "redemption_notify_failed");
    }
  }

  return { notified, failed };
}

async function notifyOneRedemption(sub: Record<string, unknown>): Promise<void> {
  const snapshot = sub.plan_snapshot as { pricing: { monthly: number; annual: number } };
  const cycle = sub.billing_cycle as BillingCycle;
  const amountPaise = planPriceInPaise(snapshot as unknown as Plan, cycle);
  const merchantOrderId = newMerchantOrderId();
  const merchantSubscriptionId = String(sub.pg_customer_ref);

  // Verify subscription is still ACTIVE at PhonePe before notifying
  const pgStatus = await phonepeAdapter.getSubscriptionStatus(merchantSubscriptionId);
  if (pgStatus.state !== "ACTIVE") {
    logger.warn({ subscriptionId: sub.id, pgState: pgStatus.state }, "redemption_skipped_not_active");
    return;
  }

  const expireAt = Date.now() + 48 * 60 * 60 * 1000; // 48h window

  await db().query(
    `INSERT INTO payment_orders
       (merchant_order_id, user_id, type, amount_paise, credits, status,
        subscription_id, merchant_subscription_id, expire_at)
     VALUES ($1,$2,'redemption',$3,$4,'pending',$5,$6,$7)`,
    [
      merchantOrderId,
      String(sub.user_id),
      amountPaise,
      (sub.plan_snapshot as { credits: { included: number } }).credits.included,
      String(sub.id),
      merchantSubscriptionId,
      new Date(expireAt),
    ],
  );

  await phonepeAdapter.notifyRedemption({
    merchantOrderId,
    amount: amountPaise,
    merchantSubscriptionId,
    expireAt,
  });

  logger.info({ subscriptionId: sub.id, merchantOrderId }, "redemption_notified");
}

export async function executeDueRedemptions(opts?: { batchSize?: number }): Promise<{
  executed: number;
  failed: number;
}> {
  const batchSize = opts?.batchSize ?? 50;

  const res = await db().query(
    `SELECT * FROM payment_orders
     WHERE type = 'redemption' AND status = 'pending' AND retry_count < 4
       AND expire_at > now()
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize],
  );

  let executed = 0;
  let failed = 0;

  for (const row of res.rows) {
    const order = row as PaymentOrderRow;
    try {
      const merchantSubId = String(order.merchant_subscription_id ?? "");
      if (merchantSubId) {
        const pgStatus = await phonepeAdapter.getSubscriptionStatus(merchantSubId);
        if (pgStatus.state !== "ACTIVE") {
          logger.warn({ orderId: order.id, pgState: pgStatus.state }, "execute_redemption_skipped_not_active");
          continue;
        }
      }

      await phonepeAdapter.executeRedemption(String(order.merchant_order_id));
      executed++;
      logger.info({ merchantOrderId: order.merchant_order_id }, "redemption_executed");
    } catch (e) {
      failed++;
      logger.error({ err: e, merchantOrderId: order.merchant_order_id }, "redemption_execute_failed");
    }
  }

  return { executed, failed };
}

// ─── ADMIN: Refund ─────────────────────────────────────────────────────────

export async function initiateRefund(args: {
  merchantOrderId: string;
  amountPaise: number;
  actorUserId: string;
}): Promise<{ merchantRefundId: string }> {
  const order = await getOrderByMerchantId(args.merchantOrderId);
  if (!order) throw Errors.paymentOrderNotFound();
  if (order.status !== "completed") {
    throw Errors.validation([{ path: "merchantOrderId", code: "INVALID_VALUE", message: "Only completed orders can be refunded." }]);
  }

  const merchantRefundId = newMerchantRefundId();

  const result = await phonepeAdapter.initiateRefund({
    merchantRefundId,
    merchantOrderId: args.merchantOrderId,
    amountPaise: args.amountPaise,
  });

  await db().query(
    `UPDATE payment_orders SET status = 'refunded', updated_at = now() WHERE merchant_order_id = $1`,
    [args.merchantOrderId],
  );

  logger.info({ merchantOrderId: args.merchantOrderId, merchantRefundId, actorUserId: args.actorUserId }, "refund_initiated");
  return { merchantRefundId: result.merchantRefundId };
}

export async function listPaymentOrders(args: {
  userId?: string;
  type?: string;
  status?: string;
  page: number;
  pageSize: number;
}): Promise<{ orders: PaymentOrderRow[]; total: number }> {
  const filters: string[] = ["TRUE"];
  const values: unknown[] = [];
  let i = 1;

  if (args.userId) { filters.push(`user_id = $${i++}`); values.push(args.userId); }
  if (args.type) { filters.push(`type = $${i++}`); values.push(args.type); }
  if (args.status) { filters.push(`status = $${i++}`); values.push(args.status); }

  const where = filters.join(" AND ");
  const offset = (args.page - 1) * args.pageSize;

  const countRes = await db().query(`SELECT COUNT(*)::int AS c FROM payment_orders WHERE ${where}`, values);
  const total = Number((countRes.rows[0] as { c?: number })?.c ?? 0);

  values.push(args.pageSize, offset);
  const dataRes = await db().query(
    `SELECT * FROM payment_orders WHERE ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    values,
  );

  return { orders: dataRes.rows as PaymentOrderRow[], total };
}
