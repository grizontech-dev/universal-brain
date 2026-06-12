INSERT INTO plans (
  id, name, slug, status, is_public, is_introductory,
  pricing, credits, limits, model_access, agent_access, feature_flags,
  created_by
) VALUES (
  'plan_free_v1', 'Free', 'free', 'active', true, false,
  '{"monthly":0,"annual":0,"currency":"inr"}'::jsonb,
  '{"included":1000,"rollover":false,"maxRollover":null,"topupEnabled":false,"topupPackages":[]}'::jsonb,
  '{"hourly":20,"daily":100,"weekly":500,"monthly":1000,"maxContextMessages":10,"maxFileSize":1048576,"maxFilesPerChat":2,"maxArtifactVersions":3}'::jsonb,
  ARRAY['gpt-4o-mini']::TEXT[],
  ARRAY[]::TEXT[],
  '{"webSearch":false,"codeExecution":false,"fileUpload":false,"documentCreation":false,"documentAnalysis":false,"deepResearch":false}'::jsonb,
  (SELECT id FROM users WHERE role='superadmin' ORDER BY created_at LIMIT 1)
)
ON CONFLICT (id) DO NOTHING;
