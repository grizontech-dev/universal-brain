CREATE TABLE subscriptions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                     TEXT NOT NULL REFERENCES plans(id),
  plan_snapshot               JSONB NOT NULL,

  billing_cycle               TEXT NOT NULL
                                CHECK (billing_cycle IN ('monthly','annual')),
  status                      TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','past_due','cancelled','paused')),

  current_period_start        TIMESTAMPTZ NOT NULL,
  current_period_end          TIMESTAMPTZ NOT NULL,
  cancel_at_period_end        BOOLEAN NOT NULL DEFAULT false,

  credits_granted             INTEGER NOT NULL DEFAULT 0,
  credits_rolled_over         INTEGER NOT NULL DEFAULT 0,

  pg_provider                 TEXT
                                CHECK (pg_provider IS NULL OR pg_provider IN ('phonepe')),
  pg_subscription_id          TEXT,
  pg_merchant_transaction_id  TEXT,
  pg_customer_ref             TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_subscriptions_one_active_per_user
  ON subscriptions(user_id) WHERE status = 'active';

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_period_end ON subscriptions(current_period_end);
