-- Migration 043: Drop unused allowed_features column from agents table.
--
-- allowed_features was originally intended to gate tools per agent but was
-- never read by any application code at runtime.
-- That role is now fully handled by allowed_tools (added in migration 041),
-- which stores the same feature-flag camelCase keys and is loaded by
-- agentLoader.service.ts into the in-memory AgentDescriptor cache.

ALTER TABLE agents DROP COLUMN IF EXISTS allowed_features;
