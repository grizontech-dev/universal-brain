import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { runWalletJanitorOnce } from "./wallet.janitor.worker.js";
import { runUsageCleanupOnce } from "./usage.cleanup.worker.js";
import { runUsageRollupOnce } from "./usage.rollup.worker.js";
import { runFileJanitorOnce } from "./file.janitor.worker.js";
import { runRedemptionNotifyOnce, runRedemptionExecuteOnce } from "./subscription.redemption.worker.js";
import { runSubscriptionRenewalOnce } from "./subscription.renewal.worker.js";

const TEN_MIN_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let intervals: ReturnType<typeof setInterval>[] = [];

/**
 * In-process periodic jobs (wallet orphan holds + stale chat jobs).
 * Disable with `ENABLE_BACKGROUND_SCHEDULERS=false` (e.g. in tests).
 */
export function startBackgroundSchedulers(): void {
  if (!env.ENABLE_BACKGROUND_SCHEDULERS) {
    return;
  }
  if (intervals.length) return;

  const tick = () => {
    void runWalletJanitorOnce().catch((e) => logger.warn({ err: e }, "wallet_janitor_tick_failed"));
    void runUsageCleanupOnce().catch((e) => logger.warn({ err: e }, "usage_cleanup_tick_failed"));
    void runUsageRollupOnce().catch((e) => logger.warn({ err: e }, "usage_rollup_tick_failed"));
    void runFileJanitorOnce().catch((e) => logger.warn({ err: e }, "file_janitor_tick_failed"));
    void runSubscriptionRenewalOnce().catch((e) => logger.warn({ err: e }, "subscription_renewal_tick_failed"));
  };

  // Redemption notify: every hour (PhonePe mandate debit window is 9:31PM–9:59AM, 1:01PM–4:59PM)
  const redemptionNotifyTick = () => {
    void runRedemptionNotifyOnce().catch((e) => logger.warn({ err: e }, "redemption_notify_tick_failed"));
  };
  const redemptionExecuteTick = () => {
    void runRedemptionExecuteOnce().catch((e) => logger.warn({ err: e }, "redemption_execute_tick_failed"));
  };

  intervals.push(setInterval(tick, TEN_MIN_MS));
  intervals.push(setInterval(redemptionNotifyTick, ONE_HOUR_MS));
  intervals.push(setInterval(redemptionExecuteTick, ONE_HOUR_MS));

  void tick();
  void redemptionNotifyTick();
  void redemptionExecuteTick();
  logger.info({ intervalMs: TEN_MIN_MS }, "background_schedulers_started");
}

export function stopBackgroundSchedulers(): void {
  for (const id of intervals) clearInterval(id);
  intervals = [];
}
