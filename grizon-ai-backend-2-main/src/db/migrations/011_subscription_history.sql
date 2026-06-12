CREATE TABLE subscription_history (
  id                  BIGSERIAL PRIMARY KEY,
  subscription_id     UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  event               TEXT NOT NULL,
  from_plan_id        TEXT REFERENCES plans(id),
  to_plan_id          TEXT REFERENCES plans(id),
  actor_user_id       UUID REFERENCES users(id),
  payload             JSONB NOT NULL DEFAULT '{}',
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sub_hist_sub_time ON subscription_history(subscription_id, occurred_at DESC);
