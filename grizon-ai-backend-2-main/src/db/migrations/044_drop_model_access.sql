-- Migration 044: Drop model_access column and purge modelPicker feature flag.
-- Model-specific routing is now handled entirely via agent_model_priorities
-- (agent_type = "direct" + direct_model_id, or ordered priorities).
-- Plans control model access through agent_access slugs only.

ALTER TABLE plans DROP COLUMN IF EXISTS model_access;

UPDATE plans
SET feature_flags = feature_flags - 'modelPicker'
WHERE feature_flags ? 'modelPicker';
