import { privacyReason } from "@emojisense/data/shards";
import { addDays, dayOf, LEGACY_LOCALE } from "@emojisense/platform";
import { normalize } from "emojisense";
import type { D1Like } from "../store.ts";

/** Inclusive range of UTC days, `YYYY-MM-DD`. */
export interface DayWindow {
  from: string;
  to: string;
}

/** The last `days` complete UTC days before the day of `now`. Today is never read. */
export function selectionWindow(now: number, days: number): DayWindow {
  const today = dayOf(now);
  return { from: addDays(today, -days), to: addDays(today, -1) };
}

export interface SelectionRules {
  minAccounts: number;
  minSearches: number;
  maxQueries: number;
}

export interface Candidate {
  /** Normalized query text, as query_daily holds it. */
  q: string;
  /** The pack locale it was searched in. Rows from before migration 0004 count as English. */
  locale: string;
  searches: number;
}

export interface Selection {
  candidates: Candidate[];
  /** Rows over the thresholds that privacyReason (or a non-normalized text) kept out. */
  privacyDropped: number;
}

/** Rows written before query_daily had a locale were served the English shards. */
const LOCALE = `CASE q.locale WHEN '${LEGACY_LOCALE}' THEN 'en' ELSE q.locale END`;

/**
 * Per locale and query, the searches and the number of different accounts whose apps searched it
 * in the window: a locale's shard file shows that its query was searched in that locale, so the
 * thresholds hold per locale. query_daily holds keyed calls only (anonymous calls and dev keys
 * are never counted), so one person without a key cannot push a text into a public shard file.
 * An account with many apps counts once.
 */
const SELECT_CANDIDATES = `
  SELECT ${LOCALE} AS locale, q.query AS q, SUM(q.searches) AS total
  FROM query_daily q JOIN apps a ON a.id = q.app_id
  WHERE q.day BETWEEN ? AND ?
  GROUP BY ${LOCALE}, q.query
  HAVING COUNT(DISTINCT a.account_id) >= ? AND SUM(q.searches) >= ?
  ORDER BY total DESC, locale, q.query
  LIMIT ?`;

/**
 * The queries a shard build may publish per locale, most searched first (`maxQueries` over all
 * locales): over both k-anonymity thresholds in the window and the locale, and not
 * personal-looking (privacyReason). Only aggregate counts leave D1: no app, account or day.
 */
export async function selectCandidates(
  db: D1Like,
  window: DayWindow,
  rules: SelectionRules,
): Promise<Selection> {
  const { results } = await db
    .prepare(SELECT_CANDIDATES)
    .bind(window.from, window.to, rules.minAccounts, rules.minSearches, rules.maxQueries)
    .all<{ locale: string; q: string; total: number }>();
  const candidates: Candidate[] = [];
  let privacyDropped = 0;
  for (const row of results) {
    // A key the SDK can never look up (it normalizes first) would only publish the text.
    if (normalize(row.q) !== row.q || privacyReason(row.q)) privacyDropped++;
    else candidates.push({ q: row.q, locale: row.locale, searches: Number(row.total) });
  }
  return { candidates, privacyDropped };
}
