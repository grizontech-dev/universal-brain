-- Migration 045: track all tool usage counts in usage_records.

ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS web_fetch_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tool_count_total INTEGER NOT NULL DEFAULT 0;

UPDATE usage_records
SET tool_count_total = COALESCE(web_search_count, 0) + COALESCE(code_execution_count, 0)
WHERE tool_count_total = 0;
