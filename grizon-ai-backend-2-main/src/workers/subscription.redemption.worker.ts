import { notifyDueRedemptions, executeDueRedemptions } from "../services/payment/payment.service.js";
import { logger } from "../utils/logger.js";

const DEFAULT_BATCH_SIZE = 50;

export async function runRedemptionNotifyOnce(batchSize = DEFAULT_BATCH_SIZE): Promise<{
  notified: number;
  failed: number;
}> {
  try {
    const result = await notifyDueRedemptions({ batchSize });
    if (result.notified > 0 || result.failed > 0) {
      logger.info(result, "subscription_redemption_notify_batch");
    }
    return result;
  } catch (e) {
    logger.error({ err: e }, "subscription_redemption_notify_batch_failed");
    return { notified: 0, failed: 0 };
  }
}

export async function runRedemptionExecuteOnce(batchSize = DEFAULT_BATCH_SIZE): Promise<{
  executed: number;
  failed: number;
}> {
  try {
    const result = await executeDueRedemptions({ batchSize });
    if (result.executed > 0 || result.failed > 0) {
      logger.info(result, "subscription_redemption_execute_batch");
    }
    return result;
  } catch (e) {
    logger.error({ err: e }, "subscription_redemption_execute_batch_failed");
    return { executed: 0, failed: 0 };
  }
}
