CREATE TABLE IF NOT EXISTS file_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  qdrant_id   TEXT NOT NULL,
  page        INT,
  section     TEXT,
  token_count INT NOT NULL DEFAULT 0,
  UNIQUE (file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id);
