CREATE TABLE usage_daily_plan (
  plan_id           TEXT NOT NULL REFERENCES plans(id),
  day               DATE NOT NULL,
  request_count     INTEGER NOT NULL DEFAULT 0,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  credits_deducted  INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, day)
);

CREATE INDEX idx_usage_daily_plan_day ON usage_daily_plan(day DESC);
