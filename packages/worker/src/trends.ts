/**
 * Regional trends for the culture proposals (DECISIONS.md, "Regional statistics: locale and
 * country"): per locale and country, the queries searched more in the last 7 complete UTC days
 * than in the 28 days before. The daily cron writes them to trends_daily; nothing serves them
 * publicly. Only k-anonymous aggregates leave query_daily: no app, account, user or day.
 */
import { privacyReason } from "@emojisense/data/shards";
import {
  ALL_COUNTRIES,
  addDays,
  dayOf,
  LEGACY_LOCALE,
  TRENDS_BASELINE_DAYS,
  TRENDS_KEEP_DAYS,
  TRENDS_MIN_ACCOUNTS,
  TRENDS_MIN_SEARCHES,
  TRENDS_RECENT_DAYS,
  TRENDS_RISING_SCORE,
  type TrendsDailyRow,
  UNKNOWN_COUNTRY,
} from "@emojisense/platform";
import { normalize } from "emojisense";
import { TRENDS_MAX_CANDIDATES, TRENDS_MAX_ROWS, TRENDS_MAX_ROWS_PER_REGION } from "./config.ts";
import type { DayWindow } from "./shards/select.ts";
import type { D1Like } from "./store.ts";

export interface TrendWindows {
  /** The day of the run: the `day` of the rows it writes. */
  day: string;
  /** The last TRENDS_RECENT_DAYS complete UTC days. */
  recent: DayWindow;
  /** The TRENDS_BASELINE_DAYS days before them. */
  baseline: DayWindow;
  /**
   * Earlier runs whose windows together cover the baseline exactly (day − 7, − 14, − 21, − 28).
   * Their rows are its long memory: plans that keep 7 days of query_daily no longer hold it.
   */
  history: string[];
}

export function trendWindows(now: number): TrendWindows {
  const day = dayOf(now);
  const recentFrom = addDays(day, -TRENDS_RECENT_DAYS);
  const runs = TRENDS_BASELINE_DAYS / TRENDS_RECENT_DAYS;
  return {
    day,
    recent: { from: recentFrom, to: addDays(day, -1) },
    baseline: { from: addDays(recentFrom, -TRENDS_BASELINE_DAYS), to: addDays(recentFrom, -1) },
    history: Array.from({ length: runs }, (_, i) => addDays(day, -TRENDS_RECENT_DAYS * (i + 1))),
  };
}

/**
 * Searches per day in the window against the baseline, each smoothed by one search a day, so a
 * query that was never seen before needs real volume to rank high: 10 searches in a week score
 * 2.43, 70 score 11. A steady query scores 1. Two decimals.
 */
export function trendScore(searches: number, baseline: number): number {
  const recentRate = searches / TRENDS_RECENT_DAYS;
  const baselineRate = baseline / TRENDS_BASELINE_DAYS;
  return Math.round(((recentRate + 1) / (baselineRate + 1)) * 100) / 100;
}

/**
 * The k-anonymous queries of the recent window per locale and country (unknown countries are
 * counted in the locale-wide row only), with two lower bounds of their baseline searches:
 * query_daily over the baseline window (plans with a short retention no longer hold it) and the
 * earlier runs' rows (queries below the thresholds then are missing). Legacy rows without a
 * locale take no part.
 */
const SELECT_TRENDS = `
  WITH recent AS (
    SELECT q.locale AS locale, q.country AS country, q.query AS query,
           SUM(q.searches) AS searches, COUNT(DISTINCT a.account_id) AS accounts
    FROM query_daily q JOIN apps a ON a.id = q.app_id
    WHERE q.day BETWEEN :from AND :to AND q.locale <> '${LEGACY_LOCALE}' AND q.country <> '${UNKNOWN_COUNTRY}'
    GROUP BY q.locale, q.country, q.query
    HAVING COUNT(DISTINCT a.account_id) >= :accounts AND SUM(q.searches) >= :searches
    UNION ALL
    SELECT q.locale, '${ALL_COUNTRIES}', q.query, SUM(q.searches), COUNT(DISTINCT a.account_id)
    FROM query_daily q JOIN apps a ON a.id = q.app_id
    WHERE q.day BETWEEN :from AND :to AND q.locale <> '${LEGACY_LOCALE}'
    GROUP BY q.locale, q.query
    HAVING COUNT(DISTINCT a.account_id) >= :accounts AND SUM(q.searches) >= :searches
  ),
  logged AS (
    SELECT q.locale AS locale, q.country AS country, q.query AS query, SUM(q.searches) AS searches
    FROM query_daily q
    WHERE q.day BETWEEN :baseFrom AND :baseTo AND q.query IN (SELECT query FROM recent)
    GROUP BY q.locale, q.country, q.query
  ),
  logged_all AS (
    SELECT locale, query, SUM(searches) AS searches FROM logged GROUP BY locale, query
  ),
  remembered AS (
    SELECT t.locale AS locale, t.country AS country, t.query AS query, SUM(t.searches) AS searches
    FROM trends_daily t
    WHERE t.day IN (:run1, :run2, :run3, :run4)
    GROUP BY t.locale, t.country, t.query
  )
  SELECT r.locale, r.country, r.query, r.searches, r.accounts,
         COALESCE(l.searches, la.searches, 0) AS logged, COALESCE(m.searches, 0) AS remembered
  FROM recent r
  LEFT JOIN logged l ON r.country <> '${ALL_COUNTRIES}'
    AND l.locale = r.locale AND l.country = r.country AND l.query = r.query
  LEFT JOIN logged_all la ON r.country = '${ALL_COUNTRIES}' AND la.locale = r.locale AND la.query = r.query
  LEFT JOIN remembered m ON m.locale = r.locale AND m.country = r.country AND m.query = r.query
  ORDER BY r.searches DESC, r.locale, r.country, r.query
  LIMIT :max`;

/**
 * Binds named parameters by position. D1 binds `?` in order of appearance (it has no named
 * binding), so each `:name` becomes a `?` and its value is repeated where the name repeats.
 */
function bindNamed(sql: string, values: Record<string, unknown>): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const positional = sql.replace(/:([a-z][a-zA-Z0-9]*)/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`no value for :${name}`);
    params.push(values[name]);
    return "?";
  });
  return { sql: positional, params };
}

interface TrendCandidate {
  locale: string;
  country: string;
  query: string;
  searches: number;
  accounts: number;
  logged: number;
  remembered: number;
}

/** Rows per INSERT statement: one JSON parameter, far below D1's 2 MB limit. */
const INSERT_CHUNK = 1_000;

const INSERT_TRENDS = `
  INSERT INTO trends_daily (day, locale, country, query, score, searches, accounts)
  SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
         json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]')
  FROM json_each(?)`;

export interface TrendsReport {
  day: string;
  /** k-anonymous (locale, country, query) groups read from query_daily. */
  candidates: number;
  /** Candidates that privacyReason (or a non-normalized text) kept out. */
  privacyDropped: number;
  /** Candidates left out by the row caps. */
  capped: number;
  rows: number;
  /** Rows with a score of at least TRENDS_RISING_SCORE. */
  rising: number;
  /** Distinct (locale, country) pairs written, the locale-wide ones included. */
  regions: number;
}

export interface TrendLimits {
  maxCandidates: number;
  maxRows: number;
  maxRowsPerRegion: number;
}

const LIMITS: TrendLimits = {
  maxCandidates: TRENDS_MAX_CANDIDATES,
  maxRows: TRENDS_MAX_ROWS,
  maxRowsPerRegion: TRENDS_MAX_ROWS_PER_REGION,
};

/**
 * Writes the trend rows of the day of `now` (replacing a run of the same day, so a rerun is
 * safe). Every row has passed k-anonymity in its own locale and country (apps of
 * TRENDS_MIN_ACCOUNTS accounts, TRENDS_MIN_SEARCHES searches) and the shard privacy filter. The
 * most searched rows are kept, at most `maxRowsPerRegion` per locale and country.
 */
export async function buildRegionalTrends(
  db: D1Like,
  now: number,
  limits: Partial<TrendLimits> = {},
): Promise<TrendsReport> {
  const { maxCandidates, maxRows, maxRowsPerRegion } = { ...LIMITS, ...limits };
  const windows = trendWindows(now);
  const [run1, run2, run3, run4] = windows.history;
  const select = bindNamed(SELECT_TRENDS, {
    from: windows.recent.from,
    to: windows.recent.to,
    baseFrom: windows.baseline.from,
    baseTo: windows.baseline.to,
    accounts: TRENDS_MIN_ACCOUNTS,
    searches: TRENDS_MIN_SEARCHES,
    run1,
    run2,
    run3,
    run4,
    max: maxCandidates,
  });
  const { results } = await db
    .prepare(select.sql)
    .bind(...select.params)
    .all<TrendCandidate>();

  const rows: TrendsDailyRow[] = [];
  const perRegion = new Map<string, number>();
  let privacyDropped = 0;
  let capped = 0;
  for (const c of results) {
    // A text the SDK never sends as is, or one that may point to a person, never leaves query_daily.
    if (normalize(c.query) !== c.query || privacyReason(c.query)) {
      privacyDropped++;
      continue;
    }
    const region = `${c.locale}|${c.country}`;
    const taken = perRegion.get(region) ?? 0;
    if (taken >= maxRowsPerRegion || rows.length >= maxRows) {
      capped++;
      continue;
    }
    perRegion.set(region, taken + 1);
    const searches = Number(c.searches);
    const baseline = Math.max(Number(c.logged), Number(c.remembered));
    rows.push({
      day: windows.day,
      locale: c.locale,
      country: c.country,
      query: c.query,
      score: trendScore(searches, baseline),
      searches,
      accounts: Number(c.accounts),
    });
  }

  const insert = db.prepare(INSERT_TRENDS);
  const statements = [db.prepare("DELETE FROM trends_daily WHERE day = ?").bind(windows.day)];
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const chunk = rows
      .slice(start, start + INSERT_CHUNK)
      .map((r) => [r.locale, r.country, r.query, r.score, r.searches, r.accounts]);
    statements.push(insert.bind(windows.day, JSON.stringify(chunk)));
  }
  // One batch is one transaction: readers see the previous rows of the day or all new ones.
  await db.batch(statements);

  return {
    day: windows.day,
    candidates: results.length,
    privacyDropped,
    capped,
    rows: rows.length,
    rising: rows.filter((r) => r.score >= TRENDS_RISING_SCORE).length,
    regions: perRegion.size,
  };
}

export interface TrendQuery {
  /** "YYYY-MM-DD". Default: the newest day in the table. */
  day?: string;
  locale?: string;
  /** ISO 3166-1 alpha-2, or ALL_COUNTRIES for the locale-wide rows. */
  country?: string;
  /** Default TRENDS_RISING_SCORE. Pass 0 for every row. */
  minScore?: number;
  /** Default 100. */
  limit?: number;
}

const SELECT_STORED_TRENDS = `
  SELECT day, locale, country, query, score, searches, accounts FROM trends_daily
  WHERE day = COALESCE(:day, (SELECT MAX(day) FROM trends_daily))
    AND (:locale IS NULL OR locale = :locale) AND (:country IS NULL OR country = :country)
    AND score >= :minScore
  ORDER BY score DESC, searches DESC, locale, country, query
  LIMIT :limit`;

/** The rising queries of one day (the culture proposals read them), highest score first. */
export async function readRegionalTrends(db: D1Like, query: TrendQuery = {}): Promise<TrendsDailyRow[]> {
  const select = bindNamed(SELECT_STORED_TRENDS, {
    day: query.day ?? null,
    locale: query.locale ?? null,
    country: query.country ?? null,
    minScore: query.minScore ?? TRENDS_RISING_SCORE,
    limit: query.limit ?? 100,
  });
  const { results } = await db
    .prepare(select.sql)
    .bind(...select.params)
    .all<TrendsDailyRow>();
  return results;
}

/** The first day trends_daily keeps; the daily cron deletes the rows before it. */
export const trendsCutoff = (now: number) => addDays(dayOf(now), 1 - TRENDS_KEEP_DAYS);
