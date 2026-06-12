-- Layer 3 Task 4 (P1): feature flags for new tools (merge into existing JSON).

UPDATE plans
SET feature_flags = feature_flags || '{"weatherData": true}'::jsonb
WHERE slug = 'free';

UPDATE plans
SET feature_flags = feature_flags || '{"stockData": true, "weatherData": true, "webFetch": true, "htmlPreview": true, "imageAnalyse": true}'::jsonb
WHERE slug IN ('starter', 'pro', 'enterprise');

UPDATE plans
SET feature_flags = feature_flags || '{"chartGenerate": true}'::jsonb
WHERE slug IN ('pro', 'enterprise');
