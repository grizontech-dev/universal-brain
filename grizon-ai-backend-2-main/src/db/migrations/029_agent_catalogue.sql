CREATE TABLE IF NOT EXISTS providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  display_name    TEXT NOT NULL,
  icon_url        TEXT,
  api_base_url    TEXT NOT NULL,
  env_key_name    TEXT NOT NULL,
  is_key_present  BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_models (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id            TEXT UNIQUE NOT NULL,
  provider_id         UUID REFERENCES providers(id),
  provider            TEXT,
  display_name        TEXT NOT NULL,
  tier                TEXT NOT NULL,
  credit_rate         NUMERIC NOT NULL DEFAULT 1,
  context_window      INT,
  max_output_tokens   INT,
  capabilities        JSONB NOT NULL DEFAULT '[]',
  icon_url            TEXT,
  short_description   TEXT NOT NULL DEFAULT '',
  long_description    TEXT NOT NULL DEFAULT '',
  tags                TEXT[] NOT NULL DEFAULT '{}',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  health_status       TEXT NOT NULL DEFAULT 'healthy',
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  icon_url        TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  display_name          TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  system_prompt         TEXT NOT NULL DEFAULT '',
  default_model_id      TEXT,
  agent_multiplier      NUMERIC NOT NULL DEFAULT 1.0,
  allowed_features      TEXT[] NOT NULL DEFAULT '{}',
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS agent_type           TEXT NOT NULL DEFAULT 'specialized',
  ADD COLUMN IF NOT EXISTS category_id          UUID REFERENCES agent_categories(id),
  ADD COLUMN IF NOT EXISTS icon_url             TEXT,
  ADD COLUMN IF NOT EXISTS short_description    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS long_description     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS example_prompts      JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS tags                 TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_order           INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_visible           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_auto_eligible     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cost_multiplier      NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS max_context_tokens   INT NOT NULL DEFAULT 80000,
  ADD COLUMN IF NOT EXISTS max_context_messages INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS direct_model_id      TEXT;

CREATE TABLE IF NOT EXISTS agent_model_priorities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL,
  priority    INT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_amp_agent_priority ON agent_model_priorities (agent_id, priority);

CREATE TABLE IF NOT EXISTS system_model_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier        TEXT UNIQUE NOT NULL,
  models      JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_model_config (tier, models)
VALUES ('light', '[]'::jsonb), ('medium', '[]'::jsonb), ('high', '[]'::jsonb)
ON CONFLICT (tier) DO NOTHING;

ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS interaction_mode TEXT NOT NULL DEFAULT 'auto';
