/**
 * The culture layer on the server (docs/API.md, "Culture"), on by default in /v1/search and
 * /v1/suggest-reactions for thin clients that do not run the SDK (the SDKs send `culture=0` and
 * apply it on the device). The culture files are the static assets the SDKs load
 * (/v1/culture/<packVersion>/culture.<locale>.json). Culture is applied to each answer after the
 * shared cache, like custom emoji, so cached bodies never hold it.
 */
import {
  type AliasEngine,
  applyCulture,
  assertCulture,
  type Culture,
  type CultureResult,
  regionOf,
  type SearchResult,
} from "emojisense";
import type { Env } from "./env.ts";
import { errorResponse } from "./http.ts";
import type { EdgeCaller } from "./region.ts";

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

/** The UTC calendar day of `now`, "YYYY-MM-DD". */
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** One formatter per time zone, kept per isolate: building an Intl.DateTimeFormat is slow. */
const dayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar day of `now` in an IANA time zone ("Asia/Tokyo"), "YYYY-MM-DD". The UTC day when
 * the zone is missing or the runtime does not know it.
 */
export function dayIn(timeZone: string | undefined, now: number): string {
  if (!timeZone) return utcDay(now);
  let format = dayFormats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      return utcDay(now);
    }
    dayFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A real calendar day as "YYYY-MM-DD" ("2026-02-30" is not one). */
export function isCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const time = Date.parse(day);
  return !Number.isNaN(time) && utcDay(time) === day;
}

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
 * A file covers at least 12 months and each request checks the windows against its own day (the
 * caller's), so the file itself does not change from day to day; a deploy brings new files and
 * new isolates. Reading it again each UTC day keeps the stale check below running. A missing file
 * is remembered for the day; a failed load is not, so the next request tries again.
 */
export function createCultureFiles(options: {
  read: CultureReader;
  now?: () => number;
  /**
   * What is published now (culture-admin/route.ts: the R2 build id, or undefined for the deployed
   * files). A new value loads the files again, so a publish reaches the API within minutes.
   */
  version?: (env: Env) => Promise<string | undefined>;
}): CultureFiles {
  const now = options.now ?? Date.now;
  const files = new Map<string, { day: string; file: Promise<Culture | undefined> }>();

  function load(locale: string, env: Env, day: string): Promise<Culture | undefined> {
    const loading = options.read(`culture.${locale}.json`, env).then((culture) => {
      if (culture && culture.locale !== locale) {
        throw new Error(`culture.${locale}.json holds locale "${culture.locale}"`);
      }
      if (culture && culture.until < day.slice(0, 10)) {
        // No sync and deploy since the file's last day: later events may be missing from it.
        console.warn(
          JSON.stringify({
            event: "culture_file_stale",
            locale,
            until: culture.until,
            day: day.slice(0, 10),
          }),
        );
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
    async get(locale, env) {
      const version = options.version ? ((await options.version(env)) ?? "deployed") : "";
      const day = `${utcDay(now())}${version ? `@${version}` : ""}`;
      const cached = files.get(locale);
      return cached && cached.day === day ? cached.file : load(locale, env, day);
    },
  };
}

export interface CultureParams {
  enabled: boolean;
  /**
   * ISO 3166-1 alpha-2, uppercase: the request's `region`, else the region of its `locale` tag
   * ("pt-BR" → "BR"). Only used when `enabled`.
   */
  region: string | undefined;
  /** The request named a region (a code, or `auto`), so the answer echoes the one it used. */
  regionRequested: boolean;
  /** `region=auto`: the region is the request's country, so the answer varies by caller. */
  auto: boolean;
  /**
   * The day the culture windows are checked against, "YYYY-MM-DD": the request's `day`, else the
   * caller's local day (the edge's time zone), else the UTC day.
   */
  day: string;
  /** The day is the caller's local day, which the URL does not show: the answer varies by caller. */
  dayFromCaller: boolean;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** A real ISO 3166-1 alpha-2 region: CLDR has a name for it ("ZZ" is its "Unknown Region"). */
export function isRegionCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code) || code === "ZZ") return false;
  const name = regionNames.of(code);
  return name !== undefined && name !== code;
}

const isAbsent = (value: unknown) => value === undefined || value === null || value === "";
const shown = (value: unknown) => (typeof value === "string" ? `"${value.slice(0, 12)}"` : typeof value);

/** The region of a `locale` tag ("pt-BR" → "BR", "en_US" → "US"), if it names a real one. */
function localeRegion(locale: unknown): string | undefined {
  if (typeof locale !== "string") return undefined;
  const region = regionOf(locale.trim().replace(/_/g, "-"));
  return region && isRegionCode(region) ? region : undefined;
}

/**
 * The region and day of one answer, the same for search and reactions. Answers a 400 for a bad
 * `region` or `day`, so a typo never silently changes the ranking. `auto` takes the caller's
 * country (undefined when unknown: no regional entries).
 */
function readCultureScope(
  enabled: boolean,
  input: { region?: unknown; day?: unknown; locale?: unknown },
  edge: EdgeCaller,
  now: number,
): CultureParams | Response {
  const dayFromCaller = isAbsent(input.day) && edge.timeZone !== undefined;
  const day = isAbsent(input.day) ? dayIn(edge.timeZone, now) : input.day;
  if (typeof day !== "string" || !isCalendarDay(day)) {
    return errorResponse(
      400,
      `day must be a calendar day as YYYY-MM-DD, e.g. 2026-10-03 (got ${shown(input.day)})`,
    );
  }
  if (isAbsent(input.region)) {
    return {
      enabled,
      region: localeRegion(input.locale),
      regionRequested: false,
      auto: false,
      day,
      dayFromCaller,
    };
  }
  const region = typeof input.region === "string" ? input.region.trim().toUpperCase() : "";
  if (region === "AUTO") {
    return { enabled, region: edge.country, regionRequested: true, auto: true, day, dayFromCaller };
  }
  if (!isRegionCode(region)) {
    return errorResponse(
      400,
      `region must be an ISO 3166-1 alpha-2 code, e.g. GB, or auto (got ${shown(input.region)})`,
    );
  }
  return { enabled, region, regionRequested: true, auto: false, day, dayFromCaller };
}

/**
 * The search parameters `culture=1|true|0|false` (default on), `region=XX|auto` (default: the
 * region of `locale`) and `day=YYYY-MM-DD` (default: the caller's local day). Answers a 400 for
 * anything else.
 */
export function parseCultureParams(url: URL, edge: EdgeCaller, now: number): CultureParams | Response {
  const raw = url.searchParams.get("culture");
  let enabled: boolean;
  if (raw === null || raw === "" || raw === "1" || raw === "true") enabled = true;
  else if (raw === "0" || raw === "false") enabled = false;
  else return errorResponse(400, "culture must be 1 or 0");
  const param = (name: string) => url.searchParams.get(name);
  return readCultureScope(
    enabled,
    { region: param("region"), day: param("day"), locale: param("locale") },
    edge,
    now,
  );
}

/** The reactions body fields `culture` (boolean, default true), `region` and `day`, as in search. */
export function parseCultureBody(
  input: { culture?: unknown; region?: unknown; day?: unknown; locale?: unknown },
  edge: EdgeCaller,
  now: number,
): CultureParams | Response {
  if (input.culture !== undefined && input.culture !== null && typeof input.culture !== "boolean") {
    return errorResponse(400, "culture must be true or false");
  }
  return readCultureScope(input.culture !== false, input, edge, now);
}

/** The `culture` field of an answer: the file applied, the day and the region. null without a file. */
export function cultureEcho(file: Culture | undefined, params: CultureParams) {
  return file ? { from: file.from, day: params.day, region: params.region ?? null } : null;
}

/** The `region` field of an answer, only when the request named a region. */
export function regionEcho(params: CultureParams): { region?: string | null } {
  return params.regionRequested ? { region: params.region ?? null } : {};
}

export interface ServerCultureOptions {
  /** Drops emoji the packs do not have and gives each the pack's glyph. */
  engine: AliasEngine;
  locale: string;
  region: string | undefined;
  /** "YYYY-MM-DD" ({@link CultureParams.day}). */
  day: string;
  limit: number;
  /** A whole message (reactions): triggers anywhere in it, and no regional lead. */
  text?: boolean;
}

/**
 * The culture layer on a canonical ranking: culture emoji after the top result, and a regional
 * sense first only under core's rules (`matchRegionalLead`, never for a message). Culture results
 * carry `source: "culture"`, `context` and `cultureId`; the others are returned as they are.
 */
export function applyServerCulture(
  results: SearchResult[],
  culture: Culture,
  query: string,
  options: ServerCultureOptions,
): (SearchResult | ApiCultureResult)[] {
  const { engine, locale, region, day, limit, text = false } = options;
  return applyCulture(results, culture, query, {
    engine,
    locale,
    limit,
    day,
    text,
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
