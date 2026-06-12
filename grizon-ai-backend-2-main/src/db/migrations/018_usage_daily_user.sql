CREATE TABLE usage_daily_user (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day               DATE NOT NULL,
  request_count     INTEGER NOT NULL DEFAULT 0,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  credits_deducted  INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX idx_usage_daily_user_day ON usage_daily_user(day DESC);
