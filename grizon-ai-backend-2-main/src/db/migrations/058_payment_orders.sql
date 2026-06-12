CREATE TABLE payment_orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_order_id        VARCHAR(63) UNIQUE NOT NULL,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                     TEXT NOT NULL
                             CHECK (type IN ('topup','subscription_setup','redemption')),
  amount_paise             BIGINT NOT NULL,
  credits                  INTEGER NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','completed','failed','expired','refunded')),
  pg_order_id              TEXT,
  pg_transaction_id        TEXT,
  subscription_id          UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  merchant_subscription_id TEXT,
  retry_count              INTEGER NOT NULL DEFAULT 0,
  expire_at                TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_orders_user       ON payment_orders(user_id);
CREATE INDEX idx_payment_orders_status_type ON payment_orders(status, type);
CREATE INDEX idx_payment_orders_sub_id     ON payment_orders(merchant_subscription_id)
  WHERE merchant_subscription_id IS NOT NULL;
CREATE INDEX idx_payment_orders_created    ON payment_orders(created_at DESC);

CREATE TABLE pg_webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     TEXT UNIQUE NOT NULL,
  event        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
