-- Concept tier of the Search API (packages/worker/src/concepts): what an LLM said an unsure
-- query refers to, so each normalized query is sent to the model once per model and prompt
-- version. No query text is stored: `query_hash` is the SHA-256 of "<locale>\n<normalized query>".
-- No key, app, account or user either: answers are shared by every caller.
CREATE TABLE concept_cache (
  query_hash    TEXT NOT NULL,
  -- "<model>:<prompt version>" (CONCEPT_TAG): a new prompt never reads an older answer.
  version       TEXT NOT NULL,
  -- "ok" = an answer; "none" = the model did not know the query, or a blocked word (negative cache).
  status        TEXT NOT NULL CHECK (status IN ('ok', 'none')),
  -- JSON {"kind", "terms", "emoji"} for "ok": the model's terms after moderation and its emoji as
  -- catalog hexcodes. NULL for "none".
  answer        TEXT,
  -- JSON {"results": [[hexcode, score], ...], "display": [...]}: the ranking of `answer` for the
  -- data of `content_hash`. Another deployment ranks the answer again (no model call).
  ranked        TEXT,
  content_hash  TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (query_hash, version)
);
-- The nightly job deletes rows older than CONCEPT_CACHE_DAYS.
CREATE INDEX concept_cache_by_created ON concept_cache(created_at);

-- Model calls of the concept tier per UTC day, for all keys together (CONCEPT_DAILY_CAP).
CREATE TABLE concept_daily (
  day    TEXT PRIMARY KEY,
  calls  INTEGER NOT NULL
);
