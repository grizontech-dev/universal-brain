-- System user for benchmark runs. Fixed UUID so worker can reference it without a lookup.
INSERT INTO users (
  id, email, email_normalised, name, role, status,
  registration_platform, email_verified_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'benchmark@system.internal',
  'benchmark@system.internal',
  'Benchmark System',
  'system',
  'active',
  'system',
  now()
)
ON CONFLICT (id) DO NOTHING;
