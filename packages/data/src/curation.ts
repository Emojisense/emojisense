/**
 * Human overrides on the generated aliases (enrichment/curation.json):
 *   remove / low  an alias of one emoji (locale "*" = every locale; film titles are often the same)
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
