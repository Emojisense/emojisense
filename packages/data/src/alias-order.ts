/**
 * The order in which a record's aliases are placed. Earlier is stronger: the core pack keeps the
 * first N aliases per emoji (build-pack.ts) and the collision cap keeps a shared alias on the
 * owners that rank it highest (collisions.ts).
 *
 * `top` holds the 1–3 strongest real-world phrases for an emoji (enrichment/STYLE.md). It is the
 * only way to rank a slang or intent phrase ahead of the synonyms, which fill the core pack of
 * most popular emoji.
 */
import type { AliasCategory, LocaleEnrichment } from "./types.ts";

export const MAX_TOP = 3;

/** Category order after `top`. `typo` and `low` are separate fields. */
export const ALIAS_ORDER: readonly AliasCategory[] = ["synonym", "slang", "pop_culture", "dev", "intent"];

/** A record's aliases in placement order. Fails when `top` has more than {@link MAX_TOP} phrases. */
export function orderedAliases(block: LocaleEnrichment, where: string): string[] {
  const top = block.top ?? [];
  if (top.length > MAX_TOP) {
    throw new Error(`${where}: "top" has ${top.length} phrases (max ${MAX_TOP})`);
  }
  return [...top, ...ALIAS_ORDER.flatMap((category) => block[category])];
}
