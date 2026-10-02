import { describe, expect, it } from "vitest";
import { hexcodeOf } from "../src/ids.js";
import { COMMON_REACTIONS } from "../src/reactions.js";

describe("COMMON_REACTIONS", () => {
  it("lists each emoji once, as one glyph", () => {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    for (const emoji of COMMON_REACTIONS) {
      expect([...segmenter.segment(emoji)], emoji).toHaveLength(1);
      expect(emoji, emoji).toMatch(/^\p{Extended_Pictographic}/u);
    }
    expect(new Set(COMMON_REACTIONS.map(hexcodeOf)).size).toBe(COMMON_REACTIONS.length);
  });
});
