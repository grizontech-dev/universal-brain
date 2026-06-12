ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency_key
  ON wallet_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
