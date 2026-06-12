-- 059: Apply the unified public-agent catalogue plan changes to live `plans` rows.
-- seed.ts seedPlans() uses INSERT ... ON CONFLICT (id) DO NOTHING, so existing
-- plans are never updated by re-seeding. This migration is the source of truth
-- that moves live DBs to the new agent_access / feature_flags / limits shape.
-- Keep this in sync with PLAN_SEEDS in src/db/seed.ts.

-- ── Agent access (TEXT[]): new unified slugs only ──────────────────────────
UPDATE plans
SET agent_access = ARRAY['general','research','writer']
WHERE slug = 'free';

UPDATE plans
SET agent_access = ARRAY[
  'general','research','writer','code','document','analyst',
  'deepseek','grok'
]
WHERE slug = 'basic';

UPDATE plans
SET agent_access = ARRAY[
  'general','research','writer','code','document','analyst',
  'debugger','deep-research','fact-check','ui',
  'deepseek','grok','gpt','gemini','claude'
]
WHERE slug = 'pro';

UPDATE plans
SET agent_access = ARRAY[
  'general','research','writer','code','document','analyst',
  'debugger','deep-research','fact-check','ui','architect','math',
  'deepseek','grok','gpt','gemini','claude'
]
WHERE slug = 'elite';

-- ── Feature flags (JSONB): enable core tools in every plan ─────────────────
-- webSearch, webFetch, documentCreation (fileGen), documentAnalysis (fileRead),
-- stockData and weatherData allowed on all plans (incl. Free).
UPDATE plans
SET feature_flags = feature_flags || '{
  "webSearch": true, "webFetch": true, "fileUpload": true,
  "documentCreation": true, "documentAnalysis": true,
  "stockData": true, "weatherData": true
}'::jsonb
WHERE slug IN ('free','basic','pro','elite');

-- Tiered tool flags (unchanged in spirit; codeExecution stays off on Free).
UPDATE plans
SET feature_flags = feature_flags || '{"codeExecution": false, "deepResearch": false}'::jsonb
WHERE slug = 'free';

UPDATE plans
SET feature_flags = feature_flags || '{
  "codeExecution": true, "htmlPreview": true, "imageAnalyse": true,
  "deepResearch": false
}'::jsonb
WHERE slug = 'basic';

UPDATE plans
SET feature_flags = feature_flags || '{
  "codeExecution": true, "htmlPreview": true, "imageAnalyse": true,
  "chartGenerate": true, "deepResearch": true
}'::jsonb
WHERE slug IN ('pro','elite');

-- ── Free-plan limits: generous attachments & creation ──────────────────────
-- Attachments 2 -> 5; file size -> 10 MB; artifact versions 3 -> 5.
UPDATE plans
SET limits = limits || '{
  "maxFilesPerChat": 5, "maxFileSize": 10485760, "maxArtifactVersions": 5
}'::jsonb
WHERE slug = 'free';
