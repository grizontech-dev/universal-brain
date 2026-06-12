CREATE TABLE IF NOT EXISTS semantic_cache_hits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_id      TEXT NOT NULL,
  similarity    NUMERIC(4,3) NOT NULL,
  saved_credits NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_hits_user_id ON semantic_cache_hits(user_id);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_hits_created_at ON semantic_cache_hits(created_at);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS semantic_cache_optout BOOLEAN NOT NULL DEFAULT false;
