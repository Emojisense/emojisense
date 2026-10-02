import { type AliasEngine, normalize, shouldUseSemantic } from "emojisense";
import type { QueryCount } from "./types.ts";

/** One row of the analytics export: `{"q": "...", "n": 12}`, optionally with `"locale"`. */
export interface QueryLogRow {
  q: string;
  n: number;
  locale?: string;
}

/** Parse the JSONL export. A malformed line fails the run: a silent partial build is worse. */
export function parseQueryLog(text: string): QueryLogRow[] {
  const rows: QueryLogRow[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let row: Partial<QueryLogRow>;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`query log line ${i + 1}: not valid JSON`);
    }
    if (typeof row.q !== "string" || typeof row.n !== "number" || !(row.n > 0)) {
      throw new Error(`query log line ${i + 1}: expected {"q": string, "n": number > 0}`);
    }
    rows.push({ q: row.q, n: row.n, ...(typeof row.locale === "string" ? { locale: row.locale } : {}) });
  });
  return rows;
}

export interface AggregateOptions {
  /** k-anonymity: rare strings can be personal, so a query must be seen this often. */
  minCount: number;
  /** Keep only the most frequent queries. */
  maxQueries: number;
}

/**
 * Normalize, merge the rows that normalize to the same text, drop rare queries and keep the
 * most frequent ones. Ties are broken by text, so the output is deterministic.
 */
export function aggregateQueries(rows: Iterable<QueryLogRow>, options: AggregateOptions): QueryCount[] {
  const merged = new Map<string, QueryCount>();
  for (const row of rows) {
    const q = normalize(row.q);
    if (q === "") continue;
    const current = merged.get(q);
    const locale = row.locale ?? "en";
    if (!current) merged.set(q, { q, n: row.n, locales: [locale] });
    else {
      current.n += row.n;
      if (!current.locales.includes(locale)) current.locales.push(locale);
    }
  }
  const kept: QueryCount[] = [];
  for (const query of merged.values()) {
    if (query.n < options.minCount) continue;
    query.locales.sort();
    kept.push(query);
  }
  return kept.sort((a, b) => b.n - a.n || (a.q < b.q ? -1 : a.q > b.q ? 1 : 0)).slice(0, options.maxQueries);
}

/**
 * True when a client would send the query to the semantic layers. Pass the engines a client can
 * have: core packs only (first seconds) and core + ext (after the idle load). A query that only
 * one of them sends still saves a Worker call when it is in a shard.
 */
export function createWorkerGate(engines: readonly AliasEngine[]): (query: QueryCount) => boolean {
  return ({ q, locales }) =>
    engines.some((engine) =>
      locales.some((locale) => shouldUseSemantic(engine.search(q, { locale, limit: 1 }))),
    );
}
