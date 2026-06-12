-- Stores estimated token counts per prompt section so we can show users a
-- per-section breakdown (context, message, system/tools, tool results, response).
-- Populated by the assembler at prompt-build time; values are estimates scaled
-- to match the actual API total so they always sum correctly.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS prompt_breakdown JSONB;

COMMENT ON COLUMN messages.prompt_breakdown IS
  'Keys: context_tokens, message_tokens, system_tokens, tool_result_tokens, response_tokens, total_input_actual. '
  'context/message/system/tool_result are estimated (char/4) then scaled to total_input_actual. '
  'response_tokens is exact from the LLM API.';
