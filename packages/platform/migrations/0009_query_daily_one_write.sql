-- query_daily: one D1 row written per new row instead of three (DECISIONS.md, "query_daily: one
-- write per new row"). Every keyed search adds to it, and most long-tail rows are new: the table,
-- its primary-key index and its day index were three written rows each. WITHOUT ROWID makes the
-- primary key the table, and with the day first it serves the day-range readers (shard build,
-- trends, retention) without a second index. The dashboard and account deletion seek
-- (day, app_id) one day at a time. No foreign key: a cascade from apps would scan the whole table;
-- the INSERT selects from apps, account deletion deletes the rows itself, and the retention run
-- deletes rows whose app is gone.
CREATE TABLE query_daily_keyed (
  day       TEXT NOT NULL,               -- 'YYYY-MM-DD' (UTC)
  app_id    TEXT NOT NULL,
  query     TEXT NOT NULL,
  locale    TEXT NOT NULL DEFAULT 'und', -- pack locale, e.g. 'en', 'pt'
  country   TEXT NOT NULL DEFAULT 'XX',  -- ISO 3166-1 alpha-2, uppercase
  searches  INTEGER NOT NULL DEFAULT 0,
  misses    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, app_id, query, locale, country)
) WITHOUT ROWID;
INSERT INTO query_daily_keyed (day, app_id, query, locale, country, searches, misses)
  SELECT day, app_id, query, locale, country, searches, misses FROM query_daily;
DROP TABLE query_daily;
ALTER TABLE query_daily_keyed RENAME TO query_daily;
