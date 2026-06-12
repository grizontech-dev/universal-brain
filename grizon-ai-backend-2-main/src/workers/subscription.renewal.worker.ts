import { subscriptionService } from "../services/subscription.service.js";
import { logger } from "../utils/logger.js";

const DEFAULT_BATCH_SIZE = 50;

/**
 * Run a single batch of subscription renewals.
 *
 * Designed to be invoked on a cron / repeatable BullMQ job (every minute, per
 * the renewal flow sketch in
 * `docs/Layer 2 Modules/Module 2 - Plan and Subscription/07_FLOWS.md` §F).
 *
 * Each call:
 *  - finds at most `batchSize` subscriptions whose `current_period_end` has
 *    elapsed and `status='active'`,
 *  - cancels scheduled-cancel rows and assigns the free plan,
 *  - otherwise advances the period, refreshes `credits_granted` /
 *    `credits_rolled_over`, and applies wallet grants idempotently.
 */
export async function runSubscriptionRenewalOnce(batchSize: number = DEFAULT_BATCH_SIZE): Promise<{
  processed: number;
  renewed: number;
  cancelled: number;
}> {
  try {
    const result = await subscriptionService.renewDueSubscriptions({ batchSize });
    if (result.processed > 0) {
      logger.info(
        { processed: result.processed, renewed: result.renewed, cancelled: result.cancelled },
        "subscription_renewal_batch",
      );
    }
    return result;
  } catch (error) {
    logger.error({ err: error }, "subscription_renewal_batch_failed");
    return { processed: 0, renewed: 0, cancelled: 0 };
  }
}
