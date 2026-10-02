import { createEngine, type Pack } from "emojisense";
import { decodeVectors, encodeVectors, l2normalize } from "emojisense/vectors";
import { describe, expect, it } from "vitest";
import { semanticResults } from "../src/semantic.ts";
import { EMBEDDING_MODEL, fixtureVectors, unit } from "./fixtures.ts";

const row = (emoji: string, hexcode: string): Pack["emoji"][number] => [
  emoji,
  hexcode,
  0,
  1,
  0,
  emoji,
  "",
  "",
  "",
  "",
  "",
];
const pack = (popularity?: number[]): Pack => ({
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["g"],
  ...(popularity ? { popularity } : {}),
  emoji: [row("🦖", "1F996"), row("🌋", "1F30B"), row("🚀", "1F680"), row("🐶", "1F436")],
});
/** Halfway between the T-Rex and the volcano rows: both score the same cosine. */
const query = l2normalize(Float32Array.from(unit(0).map((v, d) => v + (unit(1)[d] as number))));
const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe("semanticResults (PACK_FORMAT §5, semantic score)", () => {
  it("adds the popularity prior: a near tie goes to the more used emoji", () => {
    const plain = semanticResults(createEngine(pack()), [fixtureVectors()], query, 2);
    expect(plain[0]?.score).toBeCloseTo(plain[1]?.score as number, 2);
    const popular = semanticResults(createEngine(pack([0, 100, 0, 0])), [fixtureVectors()], query, 2);
    expect(ids(popular)).toEqual(["1F30B", "1F996"]);
    expect(popular[0]?.score).toBeCloseTo((plain.find((r) => r.id === "1F30B")?.score as number) + 0.04, 3);
  });

  it("adds the glyph term of the glyph file", () => {
    // The T-Rex glyph row is the query itself, the volcano's points away from it.
    const glyph = decodeVectors(encodeVectors(EMBEDDING_MODEL, ["1F996", "1F30B"], [query, unit(5)]));
    const out = semanticResults(createEngine(pack()), [fixtureVectors()], query, 2, glyph);
    expect(ids(out)).toEqual(["1F996", "1F30B"]);
    expect((out[0]?.score as number) - (out[1]?.score as number)).toBeGreaterThan(0.1);
  });
});
