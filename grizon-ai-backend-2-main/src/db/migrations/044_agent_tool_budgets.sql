-- Migration 044: per-agent per-tool invocation budgets.
-- Budgets are applied per assistant turn in streamCompletion.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tool_budgets JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN agents.tool_budgets
  IS 'Per-turn per-tool caps keyed by ToolId (e.g. {"web_search":2,"web_fetch":2}).';

-- System defaults
UPDATE agents
SET tool_budgets = '{"web_search":1,"web_fetch":1}'::jsonb
WHERE slug = 'chat';

UPDATE agents
SET tool_budgets = '{"web_search":4,"web_fetch":4}'::jsonb
WHERE slug = 'research';

UPDATE agents
SET tool_budgets = '{"web_search":6,"web_fetch":6}'::jsonb
WHERE slug = 'deep_research';

UPDATE agents
SET tool_budgets = '{"web_search":2,"web_fetch":2}'::jsonb
WHERE slug = 'architect';

UPDATE agents
SET tool_budgets = '{"code_execution":4}'::jsonb
WHERE slug = 'code';

UPDATE agents
SET tool_budgets = '{"code_execution":4}'::jsonb
WHERE slug = 'debugger';

UPDATE agents
SET tool_budgets = '{"code_execution":4,"chart_generate":3}'::jsonb
WHERE slug = 'analyst';

UPDATE agents
SET tool_budgets = '{}'::jsonb
WHERE slug IN ('writer', 'ui', 'document');

-- Product-facing defaults
UPDATE agents
SET tool_budgets = '{"web_search":2,"web_fetch":2}'::jsonb
WHERE slug = 'general';
