/**
 * Queries a curator wants on the CDN whatever the logs say (enrichment/shard-queries.json): the
 * website's hero and demo searches, and any query whose answer we want fixed for every data
 * center. The base build adds them to its synthetic queries with a count no synthetic query
 * reaches, so `--max-queries` never drops one, and the nightly live build leaves them to the base
 * like any base query. The Worker gate still leaves out the ones the device answers.
 *
 * Shards hold normalized text, and a client asks them only for text typed in that form (core
 * shards.ts), so each query must be normalized already. The text is our own, so the k-anonymity
 * count does not apply, but the privacy filter still does: the files are public.
 */
import { existsSync, readFileSync } from "node:fs";
import { normalize } from "emojisense";
import { privacyReason } from "./privacy.ts";
import type { QueryLogRow } from "./queries.ts";

export interface CuratedQuery {
  locale: string;
  query: string;
  /** Where the query is shown or why it is pinned, for the reviewer. */
  why?: string;
}

/** Above any synthetic count, so a curated query is never cut by `--max-queries`. */
export const CURATED_COUNT = 1_000_000_000;

/** Read and check shard-queries.json. Fails on the first malformed entry, with its index. */
export function loadCuratedQueries(path: string, locales: readonly string[]): CuratedQuery[] {
  if (!existsSync(path)) return [];
  const entries: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${path}: top level must be an array`);
  const seen = new Set<string>();
  return entries.map((entry, i) => {
    const where = `${path}[${i}]`;
    const curated = checkCuratedQuery(entry, where, locales);
    const key = `${curated.locale}\u0000${curated.query}`;
    if (seen.has(key)) throw new Error(`${where}: "${curated.query}" is listed twice for ${curated.locale}`);
    seen.add(key);
    return curated;
  });
}

function checkCuratedQuery(entry: unknown, where: string, locales: readonly string[]): CuratedQuery {
  const c = (entry ?? {}) as Record<string, unknown>;
  if (typeof c.locale !== "string" || !locales.includes(c.locale)) {
    throw new Error(`${where}: "locale" must be one of ${locales.join(", ")}`);
  }
  if (typeof c.query !== "string" || c.query.trim() === "") throw new Error(`${where}: needs a "query"`);
  const normalized = normalize(c.query);
  if (normalized !== c.query) {
    throw new Error(`${where}: "${c.query}" is not normalized; a shard can only answer "${normalized}"`);
  }
  const reason = privacyReason(c.query);
  if (reason) throw new Error(`${where}: the privacy filter drops "${c.query}" (${reason})`);
  if (c.why !== undefined && typeof c.why !== "string") throw new Error(`${where}: "why" must be text`);
  return c as unknown as CuratedQuery;
}

/** The curated queries of one locale as query-log rows for aggregateQueries. */
export function curatedRows(curated: readonly CuratedQuery[], locale: string): QueryLogRow[] {
  return curated.filter((c) => c.locale === locale).map((c) => ({ q: c.query, n: CURATED_COUNT, locale }));
}
