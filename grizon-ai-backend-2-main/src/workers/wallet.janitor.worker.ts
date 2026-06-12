import { getPool } from "../db/pool.js";
import { walletService } from "../services/wallet.service.js";
import { logger } from "../utils/logger.js";

const HOLD_TTL_MINUTES = 30;

export async function runWalletJanitorOnce() {
  const pool = getPool();
  const stale = await pool.query(
    `
    SELECT id
    FROM wallet_transactions
    WHERE type = 'hold' AND created_at < now() - ($1::text || ' minutes')::interval
    ORDER BY created_at ASC
    LIMIT 200
  `,
    [HOLD_TTL_MINUTES],
  );

  for (const row of stale.rows) {
    try {
      await walletService.releaseHold(String(row.id), "janitor_timeout");
      logger.warn({ holdId: row.id }, "wallet_janitor_released");
    } catch (error) {
      logger.error({ holdId: row.id, err: error }, "wallet_janitor_failed");
    }
  }
}
