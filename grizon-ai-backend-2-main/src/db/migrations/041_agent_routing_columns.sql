-- Migration 041: Add routing columns to agents table for DB-driven agent loading.
-- Replaces hardcoded AGENT_CATALOGUE TypeScript map.
--
-- NOTE: These already exist from 029_agent_catalogue.sql and are NOT re-added here:
--   cost_multiplier NUMERIC    -- used as costMultiplier
--   max_context_messages INT   -- used as maxContextMessages
--
-- NOTE: model priority is already handled by the agent_model_priorities join table
--   (query: SELECT model_id FROM agent_model_priorities WHERE agent_id = ? ORDER BY priority ASC)

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS allowed_tools          TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fallback_agent         TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_tool_rounds        INT      NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_tokens_per_message INT      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_system              BOOLEAN  NOT NULL DEFAULT false;

-- allowed_tools stores feature-flag camelCase keys (e.g. 'webSearch', 'imageAnalyse'),
-- the same namespace as the existing allowed_features column.
-- Mapping: web_search→webSearch, code_execution→codeExecution, file_read→documentAnalysis,
--          file_gen→documentCreation, web_fetch→webFetch, html_generate→htmlPreview,
--          chart_generate→chartGenerate, image_analyse→imageAnalyse,
--          stock_data→stockData, get_weather→weatherData

-- is_system = true  → internal auto-router agent (chat, research, code, …) — not shown in UI catalogue
-- is_system = false → product-facing catalogue agent (general, claude-haiku, …)

COMMENT ON COLUMN agents.allowed_tools          IS 'Feature-flag keys for tools this agent may use (camelCase, e.g. webSearch)';
COMMENT ON COLUMN agents.fallback_agent         IS 'Slug of fallback agent when plan does not allow this agent';
COMMENT ON COLUMN agents.max_tool_rounds        IS 'Maximum tool-use iterations per LLM turn (default 10)';
COMMENT ON COLUMN agents.max_tokens_per_message IS 'Maximum output tokens per LLM call (NULL = model default)';
COMMENT ON COLUMN agents.is_system              IS 'True for internal routing agents; false for user-facing catalogue agents';
