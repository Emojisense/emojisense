/**
 * Human overrides on the generated aliases (enrichment/curation.json):
 *   remove / low  an alias or a CLDR keyword of one emoji (locale "*" = every locale; film titles
 *                 are often the same). The CLDR label is never curated.
 *   add           a phrase the batch missed, as an alias (default) or a typo
 */
import { existsSync, readFileSync } from "node:fs";
import { normalize } from "emojisense";

interface CurationBase {
  hexcode: string;
  /** A locale code, or "*" for every locale. */
  locale: string;
  why?: string;
}
export interface CurationEdit extends CurationBase {
  alias: string;
  action: "remove" | "low";
}
export interface CurationAdd extends CurationBase {
  phrase: string;
  action: "add";
  field?: "alias" | "typo";
}
export type Curation = CurationEdit | CurationAdd;

const appliesTo = (c: Curation, hexcode: string, locale: string) =>
  c.hexcode === hexcode && (c.locale === locale || c.locale === "*");

/** Read and check curation.json. Fails on the first malformed entry, with its index. */
export function loadCurations(path: string): Curation[] {
  if (!existsSync(path)) return [];
  const entries: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${path}: top level must be an array`);
  return entries.map((entry, i) => checkCuration(entry, `${path}[${i}]`));
}

function checkCuration(entry: unknown, where: string): Curation {
  const c = (entry ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => typeof v === "string" && v.trim() !== "";
  if (!text(c.hexcode) || !text(c.locale)) throw new Error(`${where}: needs "hexcode" and "locale"`);
  if (c.action === "add") {
    if (!text(c.phrase)) throw new Error(`${where}: "add" needs a "phrase"`);
    if (c.field !== undefined && c.field !== "alias" && c.field !== "typo") {
      throw new Error(`${where}: "field" must be "alias" or "typo"`);
    }
    return c as unknown as CurationAdd;
  }
  if (c.action === "remove" || c.action === "low") {
    if (!text(c.alias)) throw new Error(`${where}: "${c.action}" needs an "alias"`);
    return c as unknown as CurationEdit;
  }
  throw new Error(`${where}: "action" must be "remove", "low" or "add"`);
}

/** The remove/low decision for a normalized alias, if a curator made one. */
export function curationAction(
  curations: readonly Curation[],
  hexcode: string,
  locale: string,
  alias: string,
): CurationEdit["action"] | undefined {
  return curations.find(
    (c): c is CurationEdit =>
      c.action !== "add" && appliesTo(c, hexcode, locale) && normalize(c.alias) === alias,
  )?.action;
}

/**
 * The CLDR keywords of one emoji and locale after curation: `keyword` keeps the others in order,
 * `low` holds the demoted ones, and removed ones are in neither list.
 */
export function curateKeywords(
  curations: readonly Curation[],
  hexcode: string,
  locale: string,
  keywords: readonly string[],
): { keyword: string[]; low: string[] } {
  const keyword: string[] = [];
  const low: string[] = [];
  for (const phrase of keywords) {
    const action = curationAction(curations, hexcode, locale, normalize(phrase));
    if (action === undefined) keyword.push(phrase);
    else if (action === "low") low.push(phrase);
  }
  return { keyword, low };
}

/**
 * remove/low entries that name none of `phrasesOf(hexcode, locale)` (its aliases and CLDR
 * keywords) in any locale they apply to. Such an entry is stale or misspelled and does nothing.
 */
export function unmatchedEdits(
  curations: readonly Curation[],
  locales: readonly string[],
  phrasesOf: (hexcode: string, locale: string) => readonly string[],
): CurationEdit[] {
  return curations.filter((c): c is CurationEdit => {
    if (c.action === "add") return false;
    const target = normalize(c.alias);
    const scope = c.locale === "*" ? locales : [c.locale];
    return !scope.some((locale) => phrasesOf(c.hexcode, locale).some((p) => normalize(p) === target));
  });
}

/** Phrases a curator added for this emoji and locale, in file order. */
export function curatedAdditions(
  curations: readonly Curation[],
  hexcode: string,
  locale: string,
): { phrase: string; field: "alias" | "typo" }[] {
  return curations
    .filter((c): c is CurationAdd => c.action === "add" && appliesTo(c, hexcode, locale))
    .map((c) => ({ phrase: c.phrase, field: c.field ?? "alias" }));
}
