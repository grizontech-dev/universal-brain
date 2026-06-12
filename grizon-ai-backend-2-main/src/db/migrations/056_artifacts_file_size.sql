ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

COMMENT ON COLUMN artifacts.file_size IS 'Byte length of artifact payload (binary storage or inline text). NULL for legacy rows.';
