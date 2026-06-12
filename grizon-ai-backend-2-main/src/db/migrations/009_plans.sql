CREATE TABLE plans (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','archived')),
  is_public         BOOLEAN NOT NULL DEFAULT false,
  is_introductory   BOOLEAN NOT NULL DEFAULT false,

  pricing           JSONB NOT NULL,
  credits           JSONB NOT NULL,
  limits            JSONB NOT NULL,

  model_access      TEXT[] NOT NULL DEFAULT '{}',
  agent_access      TEXT[] NOT NULL DEFAULT '{}',
  feature_flags     JSONB NOT NULL DEFAULT '{}',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at       TIMESTAMPTZ,
  created_by        UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_plans_status_public ON plans(status, is_public);
