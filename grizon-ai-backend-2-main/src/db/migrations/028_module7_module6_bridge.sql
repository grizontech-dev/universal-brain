-- Module 7 ↔ Module 6 bridge: usage idempotency, latency columns, chat job cancel/timeout, plan stream caps

-- Align usage status vocabulary with LAYER2 (success / failed)
UPDATE usage_records SET status = 'success' WHERE status = 'ok';
UPDATE usage_records SET status = 'failed' WHERE status = 'error';

ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS llm_first_token_ms INTEGER,
  ADD COLUMN IF NOT EXISTS llm_total_ms INTEGER;

-- Dedupe before unique index (keep lexicographically smallest id per request_id)
DELETE FROM usage_records a
  USING usage_records b
 WHERE a.request_id IS NOT NULL
   AND a.request_id = b.request_id
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS usage_records_request_id_unique
  ON usage_records (request_id)
  WHERE request_id IS NOT NULL;

-- chat_jobs: cooperative cancel + timeout terminal state
ALTER TABLE chat_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE chat_jobs DROP CONSTRAINT IF EXISTS chat_jobs_status_check;
ALTER TABLE chat_jobs
  ADD CONSTRAINT chat_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'streaming', 'completed', 'failed', 'cancelled', 'timeout'));

-- Plan stream wall-clock defaults (milliseconds); worker falls back by slug if absent
UPDATE plans
SET limits = limits || '{"streamTimeoutMs":60000,"streamInactivityTimeoutMs":20000}'::jsonb
WHERE slug = 'free';

UPDATE plans
SET credits = credits || '{"creditDiscount":1}'::jsonb
WHERE NOT (credits ? 'creditDiscount');
