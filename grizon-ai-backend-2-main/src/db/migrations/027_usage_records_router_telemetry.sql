-- Module 10 Smart Router — extend usage_records for router telemetry

ALTER TABLE usage_records RENAME COLUMN provider TO model_provider;

ALTER TABLE usage_records
  ADD COLUMN router_latency_ms INTEGER,
  ADD COLUMN cache_hit_layer TEXT,
  ADD COLUMN web_search_engine TEXT,
  ADD COLUMN web_search_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN web_search_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN code_execution_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN code_execution_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN input_tokens_fresh INTEGER,
  ADD COLUMN input_tokens_cached INTEGER,
  ADD COLUMN cache_write_tokens INTEGER,
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
