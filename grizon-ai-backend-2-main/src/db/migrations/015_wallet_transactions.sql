CREATE TABLE wallet_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id          UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type               TEXT NOT NULL CHECK (type IN ('grant','deduct','topup','rollover','refund','adjustment','hold')),
  amount             INTEGER NOT NULL,
  balance_after      INTEGER NOT NULL,
  hold_amount        INTEGER,

  message_id         TEXT,
  job_id             TEXT,
  agent_slug         TEXT,
  model_id           TEXT,

  input_tokens       INTEGER,
  output_tokens      INTEGER,
  credit_rate        NUMERIC(10,4),
  agent_multiplier   NUMERIC(10,4),
  plan_discount      NUMERIC(10,4),

  actor_id           UUID REFERENCES users(id),
  description        TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_tx_wallet_created ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX idx_wallet_tx_job_id ON wallet_transactions(job_id);
CREATE INDEX idx_wallet_tx_type_created ON wallet_transactions(type, created_at DESC);
CREATE UNIQUE INDEX idx_wallet_tx_topup_job_unique ON wallet_transactions(job_id) WHERE type = 'topup' AND job_id IS NOT NULL;
