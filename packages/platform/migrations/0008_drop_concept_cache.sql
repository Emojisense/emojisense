-- The LLM concept tier of the Search API is removed (owner decision, DECISIONS.md "LLM concept
-- tier removed"). Its shared answer cache and daily call count (migration 0007) have no reader.
-- Neither table held an app, account, user or query text.
DROP INDEX IF EXISTS concept_cache_by_created;
DROP TABLE IF EXISTS concept_cache;
DROP TABLE IF EXISTS concept_daily;
