INSERT INTO users (
  email,
  email_normalised,
  password_hash,
  role,
  status,
  name,
  registration_platform,
  email_verified_at,
  created_at,
  updated_at
)
VALUES (
  'admin@grizonai.com',
  'admin@grizonai.com',
  '$argon2id$v=19$m=65536,t=3,p=4$QysQi6T6vAfnMLBDER0cjA$crLj0rq9UVmQEbWKqUg9wS9SnOSj/djVzb7VffcooLg',
  'superadmin',
  'active',
  'Super Admin',
  'admin',
  now(),
  now(),
  now()
)
ON CONFLICT (email_normalised) DO NOTHING;
