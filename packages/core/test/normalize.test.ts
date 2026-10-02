import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, normalize } from "../src/normalize.js";

describe("normalize", () => {
  it.each([
    ["  Thumbs   UP ", "thumbs up"],
    ["doğum günü", "dogum gunu"],
    ["İYİ Kİ DOĞDUN", "iyi ki dogdun"],
    ["IŞIK", "isik"],
    ["Pokémon", "pokemon"],
    ["i'm exhausted", "im exhausted"],
    ["ship-it!!!", "ship it"],
    [":rocket:", "rocket"],
    ["+1", "+1"],
    ["c++ rocks", "c rocks"],
    ["🚀 launch 👍🏽", "launch"],
    ["👩‍🚀", ""],
    ["ｆｕｌｌｗｉｄｔｈ", "fullwidth"],
  ])("%j → %j", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it("caps length", () => {
    expect(normalize("a ".repeat(100)).length).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
  });

  it("is idempotent", () => {
    for (const s of ["Doğum Günü!", "i'm so tired", "T-Rex"]) {
      expect(normalize(normalize(s))).toBe(normalize(s));
    }
  });
});
