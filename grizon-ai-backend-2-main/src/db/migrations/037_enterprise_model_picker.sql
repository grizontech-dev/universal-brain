-- Layer 3 Task 9 (P6): Enterprise manual model selection (Module 3 / 10).
-- Allowlist matches in-code MODEL_CATALOGUE ids; admins may narrow via PATCH /admin/plans.

UPDATE plans
SET
  feature_flags = feature_flags || '{"modelPicker": true}'::jsonb,
  model_access = ARRAY[
    'claude-haiku-4-5',
    'claude-sonnet-4-6',
    'claude-opus-4-7',
    'gpt-4o-mini',
    'gpt-4o',
    'o1',
    'gemini-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'grok-2',
    'grok-2-mini',
    'deepseek-chat',
    'deepseek-reasoner'
  ]::text[]
WHERE slug = 'enterprise';
