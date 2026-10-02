/**
 * The culture layer on the server (docs/API.md, "Culture"), for thin clients that call
 * /v1/search?culture=1 instead of running the SDK. The culture files are the static assets the
 * SDKs load (/v1/culture/<packVersion>/culture.<locale>.json). Culture is applied to each answer
 * after the shared cache, like custom emoji, so cached bodies never hold it.
 */
import {
  type AliasEngine,
  applyCulture,
  assertCulture,
  type Culture,
  type CultureResult,
  type SearchResult,
} from "emojisense";
import type { Env } from "./env.ts";
import { errorResponse } from "./http.ts";

/** A culture result as the API returns it. */
export interface ApiCultureResult extends SearchResult {
  source: "culture";
  /** Why the emoji fits, in the culture file's locale. */
  context: string;
  /** The culture entry id, e.g. "goat-football". */
  cultureId: string;
}

/** Reads one culture file of the Worker's pack version; undefined when it is not published. */
export type CultureReader = (file: string, env: Env) => Promise<Culture | undefined>;

/** The day the server checks culture windows against: UTC, because it does not know the user's. */
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Culture files from the Worker's static assets through the ASSETS binding, like the locale packs
 * (locale-engines.ts). A missing file (404) is `undefined`; any other failure throws.
 */
export function assetCultureReader(packVersion: string): CultureReader {
  return async (file, env) => {
    if (!env.ASSETS) throw new Error("ASSETS binding missing");
    const response = await env.ASSETS.fetch(`https://assets.local/v1/culture/${packVersion}/${file}`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const culture: unknown = await response.json();
    assertCulture(culture);
    if (culture.packVersion !== packVersion) {
      throw new Error(`${file} is pack ${culture.packVersion}, the Worker serves ${packVersion}`);
    }
    return culture;
  };
}

export interface CultureFiles {
  /** The culture file of a pack locale; undefined when none is published or it cannot load now. */
  get(locale: string, env: Env): Promise<Culture | undefined>;
}

/**
 * Culture files per locale, loaded on first use and kept per isolate for the rest of the UTC day.
 * A file covers at least 12 months and each request checks the windows against its own UTC day,
 * so the file itself does not change from day to day; a deploy brings new files and new isolates.
 * Reading it again each day keeps the stale check below running. A missing file is remembered for
 * the day; a failed load is not, so the next request tries again.
 */
export function createCultureFiles(options: { read: CultureReader; now?: () => number }): CultureFiles {
  const now = options.now ?? Date.now;
  const files = new Map<string, { day: string; file: Promise<Culture | undefined> }>();

  function load(locale: string, env: Env, day: string): Promise<Culture | undefined> {
    const loading = options.read(`culture.${locale}.json`, env).then((culture) => {
      if (culture && culture.locale !== locale) {
        throw new Error(`culture.${locale}.json holds locale "${culture.locale}"`);
      }
      if (culture && culture.until < day) {
        // No sync and deploy since the file's last day: later events may be missing from it.
        console.warn(JSON.stringify({ event: "culture_file_stale", locale, until: culture.until, day }));
      }
      return culture;
    });
    const kept = loading.catch((error: Error) => {
      if (files.get(locale)?.file === kept) files.delete(locale);
      console.warn(
        JSON.stringify({
          event: "culture_file_unavailable",
          locale,
          error: error.name,
          message: error.message,
        }),
      );
      return undefined;
    });
    files.set(locale, { day, file: kept });
    return kept;
  }

  return {
    get(locale, env) {
      const day = utcDay(now());
      const cached = files.get(locale);
      return cached && cached.day === day ? cached.file : load(locale, env, day);
    },
  };
}

export interface CultureParams {
  enabled: boolean;
  /** ISO 3166-1 alpha-2, uppercase. Only used when `enabled`. */
  region: string | undefined;
  /** The request named a region (a code, or `auto`), so the answer echoes the one it used. */
  regionRequested: boolean;
  /** `region=auto`: the region is the request's country, so the answer varies by caller. */
  auto: boolean;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** A real ISO 3166-1 alpha-2 region: CLDR has a name for it ("ZZ" is its "Unknown Region"). */
export function isRegionCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code) || code === "ZZ") return false;
  const name = regionNames.of(code);
  return name !== undefined && name !== code;
}

/**
 * `culture=1|true|0|false` (default off) and `region=XX|auto`. Answers a 400 for anything else, so
 * a typo never silently changes the ranking. `auto` takes `edgeRegion`, the request's country
 * (region.ts `edgeCountry`; undefined when unknown: no regional entries).
 */
export function parseCultureParams(url: URL, edgeRegion?: string): CultureParams | Response {
  const raw = url.searchParams.get("culture");
  let enabled: boolean;
  if (raw === null || raw === "" || raw === "0" || raw === "false") enabled = false;
  else if (raw === "1" || raw === "true") enabled = true;
  else return errorResponse(400, "culture must be 1 or 0");
  const rawRegion = url.searchParams.get("region");
  if (rawRegion === null || rawRegion === "") {
    return { enabled, region: undefined, regionRequested: false, auto: false };
  }
  const region = rawRegion.trim().toUpperCase();
  if (region === "AUTO") return { enabled, region: edgeRegion, regionRequested: true, auto: true };
  if (!isRegionCode(region)) {
    return errorResponse(
      400,
      `region must be an ISO 3166-1 alpha-2 code, e.g. GB, or auto (got "${rawRegion.slice(0, 8)}")`,
    );
  }
  return { enabled, region, regionRequested: true, auto: false };
}

export interface ServerCultureOptions {
  /** Drops emoji the packs do not have and gives each the pack's glyph. */
  engine: AliasEngine;
  locale: string;
  region: string | undefined;
  limit: number;
  now: number;
}

/**
 * The culture layer on a canonical (fused) ranking: culture emoji after the top result, and a
 * regional sense first only under core's rules (`matchRegionalLead`). Culture results carry
 * `source: "culture"`, `context` and `cultureId`; the others are returned as they are.
 */
export function applyServerCulture(
  results: SearchResult[],
  culture: Culture,
  query: string,
  options: ServerCultureOptions,
): (SearchResult | ApiCultureResult)[] {
  const { engine, locale, region, limit, now } = options;
  return applyCulture(results, culture, query, {
    engine,
    locale,
    limit,
    // The UTC day, whatever the runtime's time zone: the server does not know the user's.
    day: utcDay(now),
    ...(region ? { region } : {}),
  }).map((result) =>
    result.source === "culture"
      ? {
          emoji: result.emoji,
          id: result.id,
          score: result.score,
          source: "culture" as const,
          context: (result as CultureResult).context,
          cultureId: (result as CultureResult).cultureId,
        }
      : result,
  );
}
