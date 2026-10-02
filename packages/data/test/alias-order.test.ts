import { describe, expect, it } from "vitest";
import { MAX_TOP, orderedAliases } from "../src/alias-order.ts";
import type { LocaleEnrichment } from "../src/types.ts";

const block = (extra: Partial<LocaleEnrichment> = {}): LocaleEnrichment => ({
  desc: "test",
  synonym: ["tears of joy"],
  slang: ["lmao"],
  pop_culture: ["meme"],
  dev: ["flaky test"],
  typo: ["laughng"],
  intent: ["that is so funny"],
  low: ["meme"],
  ...extra,
});

describe("orderedAliases", () => {
  it("places categories in priority order, without typo and low", () => {
    expect(orderedAliases(block(), "1F602 en")).toEqual([
      "tears of joy",
      "lmao",
      "meme",
      "flaky test",
      "that is so funny",
    ]);
  });

  it("puts `top` before every category, in its own order", () => {
    expect(orderedAliases(block({ top: ["im dead", "crying laughing"] }), "1F602 en").slice(0, 3)).toEqual([
      "im dead",
      "crying laughing",
      "tears of joy",
    ]);
  });

  it(`rejects more than ${MAX_TOP} top phrases, naming the record`, () => {
    expect(() => orderedAliases(block({ top: ["a", "b", "c", "d"] }), "1F602 zh")).toThrow(
      /1F602 zh: "top" has 4 phrases \(max 3\)/,
    );
  });
});
