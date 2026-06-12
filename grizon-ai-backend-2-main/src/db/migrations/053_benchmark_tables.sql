CREATE TABLE benchmark_suites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  agent_slug    TEXT NOT NULL,
  model_id      TEXT,
  concurrency   INT NOT NULL DEFAULT 5,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE benchmark_cases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id      UUID NOT NULL REFERENCES benchmark_suites(id) ON DELETE CASCADE,
  prompt        TEXT NOT NULL,
  order_index   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE benchmark_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id        UUID NOT NULL REFERENCES benchmark_suites(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending',
  total_cases     INT NOT NULL DEFAULT 0,
  completed_cases INT NOT NULL DEFAULT 0,
  failed_cases    INT NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE benchmark_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  case_id         UUID NOT NULL REFERENCES benchmark_cases(id),
  status          TEXT NOT NULL,
  response_text   TEXT,
  model_used      TEXT,
  tools_invoked   TEXT[] NOT NULL DEFAULT '{}',
  tool_rounds     INT NOT NULL DEFAULT 0,
  input_tokens    INT NOT NULL DEFAULT 0,
  output_tokens   INT NOT NULL DEFAULT 0,
  latency_ms      INT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON benchmark_results(run_id);
CREATE INDEX ON benchmark_cases(suite_id);
CREATE INDEX ON benchmark_runs(suite_id);
