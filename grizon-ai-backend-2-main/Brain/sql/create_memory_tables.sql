-- BuilderBrain Memory Architecture - Table Creation
-- Run against PostgreSQL 16
-- Note: All tables use memory_ prefix to avoid conflicts with Prisma-created tables

CREATE TABLE IF NOT EXISTS memory_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  frontend        TEXT,
  backend         TEXT,
  database        TEXT,
  css_framework   TEXT,
  auth_method     TEXT,
  folder_structure JSONB,
  requirements    TEXT[],
  roadmap         JSONB,
  status          TEXT DEFAULT 'active',
  owner_id        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_projects_owner ON memory_projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_memory_projects_status ON memory_projects(status);

CREATE TABLE IF NOT EXISTS memory_project_decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    TEXT NOT NULL,
  category      TEXT NOT NULL,
  decision_key  TEXT NOT NULL,
  decision_val  TEXT NOT NULL,
  reason        TEXT,
  approved_at   TIMESTAMPTZ DEFAULT now(),
  approved_by   TEXT DEFAULT 'user',
  overridden_at TIMESTAMPTZ,
  overridden_by TEXT,
  is_active     BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_memory_decisions_project ON memory_project_decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_decisions_active ON memory_project_decisions(project_id, is_active);

CREATE TABLE IF NOT EXISTS memory_execution_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    TEXT NOT NULL,
  todo_id       TEXT,
  task_name     TEXT NOT NULL,
  task_type     TEXT,
  agent         TEXT,
  status        TEXT DEFAULT 'pending',
  output_files  TEXT[],
  error_message TEXT,
  retry_count   INT DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  duration_ms   INT,
  token_count   INT,
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_memory_exec_project_status ON memory_execution_logs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_exec_task_name ON memory_execution_logs(project_id, task_name);

CREATE TABLE IF NOT EXISTS memory_artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  version       INT DEFAULT 1,
  content_hash  TEXT,
  dependencies  TEXT[],
  exports       TEXT[],
  language      TEXT,
  size_bytes    INT,
  is_active     BOOLEAN DEFAULT true,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_artifacts_path ON memory_artifacts(project_id, file_path, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_memory_artifacts_type ON memory_artifacts(project_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_memory_artifacts_name ON memory_artifacts(project_id, name);

CREATE TABLE IF NOT EXISTS memory_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    TEXT NOT NULL,
  artifact_id   TEXT,
  reviewed_by   TEXT,
  quality_score INT,
  issues        JSONB,
  passed        BOOLEAN,
  review_type   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_reviews_project ON memory_reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_reviews_artifact ON memory_reviews(artifact_id);

CREATE TABLE IF NOT EXISTS memory_known_errors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_pattern    TEXT NOT NULL,
  error_type       TEXT,
  framework        TEXT,
  occurrence_count INT DEFAULT 1,
  fix_description  TEXT NOT NULL,
  fix_code         TEXT,
  success_rate     FLOAT DEFAULT 1.0,
  last_seen        TIMESTAMPTZ DEFAULT now(),
  first_seen       TIMESTAMPTZ DEFAULT now(),
  tags             TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_memory_errors_framework ON memory_known_errors(framework, error_type);

CREATE TABLE IF NOT EXISTS memory_skill_performance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_name      TEXT NOT NULL UNIQUE,
  version         TEXT DEFAULT '1.0',
  total_uses      INT DEFAULT 0,
  successful_uses INT DEFAULT 0,
  failed_uses     INT DEFAULT 0,
  avg_score       FLOAT DEFAULT 0,
  avg_token_cost  INT DEFAULT 0,
  avg_duration_ms INT DEFAULT 0,
  projects_used   TEXT[],
  last_used       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_architecture_patterns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_name   TEXT NOT NULL,
  frontend       TEXT,
  backend        TEXT,
  database       TEXT,
  auth_method    TEXT,
  css_framework  TEXT,
  times_used     INT DEFAULT 0,
  success_count  INT DEFAULT 0,
  success_rate   FLOAT DEFAULT 0,
  avg_build_time_min INT,
  project_ids    TEXT[],
  tags           TEXT[],
  last_used      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_change_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       TEXT NOT NULL,
  request_text     TEXT NOT NULL,
  affected_files   TEXT[],
  affected_components TEXT[],
  status           TEXT DEFAULT 'pending',
  created_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
