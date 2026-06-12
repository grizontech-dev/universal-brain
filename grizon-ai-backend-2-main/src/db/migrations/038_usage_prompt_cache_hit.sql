-- Bug fix: distinguish prompt cache hit from semantic cache hit in usage_records.
ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS prompt_cache_hit BOOLEAN NOT NULL DEFAULT FALSE;
