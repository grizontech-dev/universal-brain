ALTER TABLE plans
ADD COLUMN IF NOT EXISTS feature_limits JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE plans
SET feature_limits = '{"webSearch":null,"codeExecution":null}'::jsonb
WHERE id = 'plan_free_v1'
  AND (feature_limits = '{}'::jsonb OR feature_limits IS NULL);
