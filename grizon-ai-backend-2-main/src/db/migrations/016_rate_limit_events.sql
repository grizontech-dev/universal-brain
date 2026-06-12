CREATE TABLE rate_limit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  limit_type  TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_limit_events_user_created ON rate_limit_events(user_id, created_at DESC);
CREATE INDEX idx_rate_limit_events_type_created ON rate_limit_events(event_type, created_at DESC);
