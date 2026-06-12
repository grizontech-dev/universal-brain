-- Extend router_llm_calls to also capture each streaming round (main LLM call decisions)
ALTER TABLE router_llm_calls
  DROP CONSTRAINT IF EXISTS router_llm_calls_component_check;

ALTER TABLE router_llm_calls
  ADD CONSTRAINT router_llm_calls_component_check
  CHECK (component IN ('classifier', 'rewriter', 'search_planner', 'stream_round'));
