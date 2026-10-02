-- Regional statistics (DECISIONS.md, "Regional statistics: locale and country"). Culture is
-- regional, so search analytics and the nightly jobs need the locale and the country of a search.

-- query_daily gets two count dimensions: the pack locale of the search and the country of the
-- request (Cloudflare's `request.cf.country`, ISO 3166-1 alpha-2; 'XX' when unknown). Still no
-- user, IP or key. SQLite cannot change a primary key, so the table is copied. Rows written before
-- this migration get the locale 'und' (undetermined) and the country 'XX'.
CREATE TABLE query_daily_regional (
  app_id    TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,               -- 'YYYY-MM-DD' (UTC)
  query     TEXT NOT NULL,
  locale    TEXT NOT NULL DEFAULT 'und', -- pack locale, e.g. 'en', 'pt'
  country   TEXT NOT NULL DEFAULT 'XX',  -- ISO 3166-1 alpha-2, uppercase
  searches  INTEGER NOT NULL DEFAULT 0,
  misses    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, day, query, locale, country)
);
INSERT INTO query_daily_regional (app_id, day, query, locale, country, searches, misses)
  SELECT app_id, day, query, 'und', 'XX', searches, misses FROM query_daily;
DROP TABLE query_daily;
ALTER TABLE query_daily_regional RENAME TO query_daily;
CREATE INDEX query_daily_by_day ON query_daily(day);

-- Rising queries per locale and country, written by the API Worker's daily cron for the culture
-- proposals. Aggregates only: every row passed k-anonymity (apps of >= 3 accounts, >= 10
-- searches in the 7-day window) and the shard privacy filter. No app, account or user id.
-- country '*' = every country of the locale. Kept 90 days.
CREATE TABLE trends_daily (
  day       TEXT NOT NULL,               -- 'YYYY-MM-DD' (UTC) of the run; window = the 7 days before
  locale    TEXT NOT NULL,
  country   TEXT NOT NULL,
  query     TEXT NOT NULL,
  score     REAL NOT NULL,               -- (recent per day + 1) / (baseline per day + 1); > 1 = rising
  searches  INTEGER NOT NULL,            -- searches in the window
  accounts  INTEGER NOT NULL,            -- distinct accounts in the window
  PRIMARY KEY (day, locale, country, query)
);
