import { describe, expect, it } from "vitest";
import { type AliasLists, COLLISION_KEEP, capCollisions, strongestOwners } from "../src/collisions.ts";

let fillers = 0;
/** An owner whose alias list puts `phrase` at `position` (0 = strongest); other aliases are unique. */
const owner = (phrase: string, position: number, field: keyof AliasLists = "alias"): AliasLists => {
  const filler = Array.from({ length: position }, () => `filler ${fillers++}`);
  const lists: AliasLists = { alias: [], typo: [], low: [] };
  lists[field] = [...filler, phrase];
  return lists;
};
const locale = (owners: [string, AliasLists][]) => new Map(owners);

describe("strongestOwners", () => {
  it("prefers the alias field, then an earlier position, then catalog order", () => {
    const owners: [string, AliasLists][] = [
      ["A", owner("big mood", 5)],
      ["B", owner("big mood", 0, "low")],
      ["C", owner("big mood", 1)],
      ["D", owner("big mood", 1)],
      ["E", owner("big mood", 0, "typo")],
    ];
    expect([...strongestOwners("big mood", owners, 3)]).toEqual(["C", "D", "A"]);
    expect([...strongestOwners("big mood", owners, 4)]).toContain("E");
  });
});

describe("capCollisions", () => {
  it("keeps an alias on its strongest owners and demotes it on the rest", () => {
    const lists = locale(
      Array.from(
        { length: COLLISION_KEEP + 2 },
        (_, i) => [`E${i}`, owner("big mood", i)] as [string, AliasLists],
      ),
    );
    const { demoted, dropped, collisions } = capCollisions(lists);
    expect({ demoted, dropped }).toEqual({ demoted: 2, dropped: 0 });
    expect(collisions[0]?.losers).toEqual([`E${COLLISION_KEEP}`, `E${COLLISION_KEEP + 1}`]);
    expect(lists.get("E0")?.alias).toContain("big mood");
    expect(lists.get(`E${COLLISION_KEEP}`)?.alias).not.toContain("big mood");
    expect(lists.get(`E${COLLISION_KEEP}`)?.low).toContain("big mood");
  });

  it("drops the alias from all but the strongest owners above 20 owners", () => {
    const lists = locale(
      Array.from({ length: 21 }, (_, i) => [`E${i}`, owner("big mood", i % 3)] as [string, AliasLists]),
    );
    const { dropped, collisions } = capCollisions(lists);
    expect(dropped).toBe(21 - COLLISION_KEEP);
    expect(collisions[0]?.dropped).toBe(true);
    const keepers = [...lists.values()].filter((v) => v.alias.includes("big mood"));
    expect(keepers).toHaveLength(COLLISION_KEEP);
    expect([...lists.values()].some((v) => v.low.includes("big mood"))).toBe(false);
  });

  it("leaves an alias on 8 emoji or fewer alone", () => {
    const lists = locale(
      Array.from({ length: 8 }, (_, i) => [`E${i}`, owner("big mood", i)] as [string, AliasLists]),
    );
    expect(capCollisions(lists).collisions).toEqual([]);
  });

  it("with keep 0, demotes everywhere (the rule before 2026-10-02)", () => {
    const lists = locale(
      Array.from({ length: 9 }, (_, i) => [`E${i}`, owner("big mood", 0)] as [string, AliasLists]),
    );
    expect(capCollisions(lists, 0).demoted).toBe(9);
  });
});
