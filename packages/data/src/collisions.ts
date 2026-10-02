/**
 * Collision cap over generated aliases of one locale (names and keywords are curated CLDR data
 * and never capped). An alias that more than COLLISION_DEMOTE emoji share no longer tells them
 * apart, so it loses weight: demoted to `low` (up to COLLISION_DROP owners) or dropped (more).
 * Its COLLISION_KEEP strongest owners keep it at full weight, so shared slang still finds its
 * best emoji (DECISIONS.md, 2026-10-02 quality diagnosis).
 */

export const COLLISION_DEMOTE = 8;
export const COLLISION_DROP = 20;
/** Owners that keep a collided alias at full weight: the same 8 the demote rule allows. */
export const COLLISION_KEEP = 8;

export interface AliasLists {
  alias: string[];
  typo: string[];
  low: string[];
}

export interface Collision {
  alias: string;
  /** Every owner, in catalog order. */
  owners: string[];
  /** Owners that lost the alias (demoted or dropped). */
  losers: string[];
  dropped: boolean;
}

/**
 * The owners where the author ranked the alias highest: alias before typo before low, then its
 * position in that list (aliases are written strongest first). Ties keep catalog order.
 */
export function strongestOwners(
  alias: string,
  owners: readonly (readonly [string, AliasLists])[],
  keep = COLLISION_KEEP,
): Set<string> {
  const strength = (lists: AliasLists) => {
    const fields = [lists.alias, lists.typo, lists.low];
    const field = fields.findIndex((list) => list.includes(alias));
    return field * 100_000 + (fields[field] as string[]).indexOf(alias);
  };
  return new Set(
    owners
      .map(([hexcode, lists], order) => ({ hexcode, order, strength: strength(lists) }))
      .sort((a, b) => a.strength - b.strength || a.order - b.order)
      .slice(0, keep)
      .map((owner) => owner.hexcode),
  );
}

/** Apply the cap to one locale's alias lists (hexcode → lists, catalog order), in place. */
export function capCollisions(lists: ReadonlyMap<string, AliasLists>, keep = COLLISION_KEEP) {
  const owners = new Map<string, string[]>();
  for (const [hexcode, v] of lists) {
    for (const alias of [...v.alias, ...v.typo, ...v.low]) {
      const list = owners.get(alias);
      if (list) list.push(hexcode);
      else owners.set(alias, [hexcode]);
    }
  }
  let demoted = 0;
  let dropped = 0;
  const collisions: Collision[] = [];
  for (const [alias, hexcodes] of owners) {
    if (hexcodes.length <= COLLISION_DEMOTE) continue;
    const drop = hexcodes.length > COLLISION_DROP;
    const kept = strongestOwners(
      alias,
      hexcodes.map((hexcode) => [hexcode, lists.get(hexcode) as AliasLists] as const),
      keep,
    );
    const losers = hexcodes.filter((hexcode) => !kept.has(hexcode));
    for (const hexcode of losers) {
      const v = lists.get(hexcode) as AliasLists;
      const wasLow = v.low.includes(alias);
      v.alias = v.alias.filter((a) => a !== alias);
      v.typo = v.typo.filter((a) => a !== alias);
      v.low = v.low.filter((a) => a !== alias);
      if (drop) {
        dropped++;
      } else {
        v.low.push(alias);
        if (!wasLow) demoted++;
      }
    }
    collisions.push({ alias, owners: hexcodes, losers, dropped: drop });
  }
  return { demoted, dropped, collisions };
}
