-- Migration 057: Simplify stream timeouts
--
-- 1. Remove plan-level stream timeout JSONB keys (replaced by universal
--    constants in code — no longer stored per-plan).
-- 2. Add llm_first_token_ms + llm_total_ms columns to messages so
--    LLM-specific timing is persisted alongside the existing latency_ms.

-- ── Plans: strip stale timeout keys ─────────────────────────────────────────
UPDATE plans
SET limits = limits
  - 'streamTimeoutMs'
  - 'streamInactivityTimeoutMs'
  - 'streamPostFirstChunkTimeoutMs'
WHERE limits ?| ARRAY['streamTimeoutMs', 'streamInactivityTimeoutMs', 'streamPostFirstChunkTimeoutMs'];

-- ── Messages: LLM timing columns ─────────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS llm_first_token_ms INTEGER,
  ADD COLUMN IF NOT EXISTS llm_total_ms       INTEGER;

COMMENT ON COLUMN messages.llm_first_token_ms IS
  'Milliseconds from provider call start to first streamed token.';
COMMENT ON COLUMN messages.llm_total_ms IS
  'Milliseconds from provider call start to last streamed token.';
