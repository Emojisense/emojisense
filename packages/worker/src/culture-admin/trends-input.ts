/**
 * Rising search phrases for the proposal job, from D1 `trends_daily` (written by the regional
 * trends step of the 03:17 cron, migration 0004: one row per day, locale, country and normalized
 * query; every row is k-anonymous and privacy-filtered when it is written). Only aggregate counts
 * are read; nothing here can identify an app, an account or a person.
 */
import type { CultureTrendEvidence } from "@emojisense/platform";
import type { D1Like } from "../store.ts";

export interface TrendQuery {
  locale: string;
  query: string;
  /** Rows of this query, one per country ("*" = the whole locale), highest score first. */
  rows: CultureTrendEvidence[];
  /** The highest score of its rows. */
  score: number;
}

interface TrendRow {
  day: string;
  locale: string;
  country: string;
  query: string;
  score: number;
  searches: number;
}

/**
 * The newest day's rising rows (score ≥ `minScore`), at most `perGroup` per (locale, country),
 * grouped by (locale, query) and ordered by score. A database without the table (before
 * migration 0004) has no trends: an empty list, not an error.
 */
export async function readRisingQueries(
  db: D1Like,
  options: { minScore: number; perGroup: number; locales: readonly string[] },
): Promise<TrendQuery[]> {
  let rows: TrendRow[];
  try {
    const result = await db
      .prepare(
        `SELECT day, locale, country, query, score, searches FROM trends_daily
         WHERE day = (SELECT MAX(day) FROM trends_daily) AND score >= ?
         ORDER BY score DESC, searches DESC, query`,
      )
      .bind(options.minScore)
      .all<TrendRow>();
    rows = result.results;
  } catch (error) {
    if (/no such table/i.test((error as Error).message)) return [];
    throw error;
  }
  const locales = new Set(options.locales);
  const taken = new Map<string, number>();
  const byQuery = new Map<string, TrendQuery>();
  for (const row of rows) {
    if (!locales.has(row.locale)) continue;
    const group = `${row.locale}\u0000${row.country}`;
    const count = taken.get(group) ?? 0;
    if (count >= options.perGroup) continue;
    taken.set(group, count + 1);
    const key = `${row.locale}\u0000${row.query}`;
    let trend = byQuery.get(key);
    if (!trend) {
      trend = { locale: row.locale, query: row.query, rows: [], score: 0 };
      byQuery.set(key, trend);
    }
    trend.rows.push({
      day: row.day,
      locale: row.locale,
      country: row.country,
      query: row.query,
      score: Number(row.score),
      searches: Number(row.searches),
    });
    trend.score = Math.max(trend.score, Number(row.score));
  }
  return [...byQuery.values()].sort((a, b) => b.score - a.score || a.query.localeCompare(b.query));
}

/** Where a rising phrase applies: every region when the whole locale rose, else its countries. */
export function trendRegions(trend: TrendQuery): string[] {
  const countries = trend.rows.map((r) => r.country);
  if (countries.includes("*")) return ["*"];
  return [...new Set(countries.filter((c) => /^[A-Z]{2}$/.test(c) && c !== "XX"))].sort();
}
