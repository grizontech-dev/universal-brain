-- Add cost tracking fields to router_llm_calls so each internal router LLM
-- call has its USD cost and credit equivalent recorded.
ALTER TABLE router_llm_calls
  ADD COLUMN IF NOT EXISTS model_provider TEXT,
  ADD COLUMN IF NOT EXISTS agent_slug     TEXT,
  ADD COLUMN IF NOT EXISTS cost_usd       NUMERIC(12,8),
  ADD COLUMN IF NOT EXISTS credits_used   INT;
