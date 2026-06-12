-- Bug fix: store the discounted rate for cached input tokens.
-- Anthropic default is 10% of input_cost_per_1k; other providers may differ.
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_cached_cost_per_1k NUMERIC(12,8) NOT NULL DEFAULT 0;

UPDATE ai_models SET input_cached_cost_per_1k = input_cost_per_1k * 0.10
WHERE input_cost_per_1k > 0;
