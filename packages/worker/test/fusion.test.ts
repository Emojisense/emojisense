import { createEngine, type Pack, type SearchResult } from "emojisense";
import { describe, expect, it } from "vitest";
import { familyKey } from "../src/emoji-lookup.ts";
import { fuseLists } from "../src/fusion.ts";
import { captionKeywords, IMAGE_FLOOR, rankImage } from "../src/image-rank.ts";

const hit = (emoji: string, id: string, score = 0.5, source: SearchResult["source"] = "semantic") => ({
  emoji,
  id,
  score,
  source,
});
const CAT = hit("🐱", "1F431");
const PANDA = hit("🐼", "1F43C");
const KEYBOARD = hit("⌨️", "2328");
const SLEEPY = hit("😴", "1F634");
const ids = (results: SearchResult[]) => results.map((r) => r.emoji);
const options = { k: 8, limit: 8, floor: 0.46, scale: 2 };

describe("fuseLists", () => {
  it("ranks an emoji that two lists agree on above the top of a single list", () => {
    const fused = fuseLists(
      [
        { results: [SLEEPY, KEYBOARD], weight: 1 },
        { results: [PANDA, CAT, KEYBOARD], weight: 0.5 },
      ],
      options,
    );
    expect(ids(fused)).toEqual(["⌨️", "😴", "🐼"]);
  });

  it("drops evidence below the floor even when that leaves fewer than limit results", () => {
    const neighbours = [CAT, PANDA, KEYBOARD, SLEEPY];
    const fused = fuseLists([{ results: neighbours, weight: 0.5 }], options);
    // Rank 1 adds 0.5; rank 2 adds 0.45, under the floor of 0.46.
    expect(ids(fused)).toEqual(["🐱"]);
    expect(fuseLists([], options)).toEqual([]);
  });

  it("weights alias lists by match quality when asked", () => {
    const exact = hit("⌨️", "2328", 1, "alias");
    const partial = hit("😹", "1F639", 0.58, "alias");
    const lists = [{ results: [exact, partial], weight: 0.5, byScore: true }];
    expect(ids(fuseLists(lists, options))).toEqual(["⌨️"]);
    expect(ids(fuseLists([{ ...lists[0], results: [partial, exact] }] as typeof lists, options))).toEqual([]);
  });

  it("keeps the best member of a gender or direction family", () => {
    const biker = hit("🚵", "1F6B5");
    const woman = hit("🚵‍♀️", "1F6B5-200D-2640-FE0F");
    const man = hit("🚵‍♂️", "1F6B5-200D-2642-FE0F");
    const fused = fuseLists([{ results: [woman, man, biker, CAT], weight: 1 }], options);
    expect(ids(fused)).toEqual(["🚵‍♀️", "🐱"]);
  });

  it("keeps the source of the list that added most, scales the score and honours limit", () => {
    const fused = fuseLists(
      [
        { results: [hit("🐱", "1F431", 1, "semantic")], weight: 1 },
        { results: [hit("🐱", "1F431", 1, "alias")], weight: 0.5 },
        { results: [hit("🐱", "1F431", 0.6, "semantic"), KEYBOARD], weight: 0.5 },
      ],
      { ...options, limit: 1 },
    );
    expect(fused).toEqual([{ emoji: "🐱", id: "1F431", score: 1, source: "semantic" }]);
  });

  it("breaks ties by first appearance, so the order is stable", () => {
    const fused = fuseLists(
      [
        { results: [PANDA], weight: 0.5 },
        { results: [CAT], weight: 0.5 },
      ],
      options,
    );
    expect(ids(fused)).toEqual(["🐼", "🐱"]);
  });
});

describe("familyKey", () => {
  it("joins gender and direction variants, and 👨/👩 professions with 🧑", () => {
    expect(familyKey("1F6B5-200D-2640-FE0F")).toBe("1F6B5");
    expect(familyKey("1F3C3-200D-2640-FE0F-200D-27A1-FE0F")).toBe("1F3C3");
    expect(familyKey("1F469-200D-1F4BB")).toBe("1F9D1-200D-1F4BB");
    expect(familyKey("1F3CB-FE0F-200D-2642-FE0F")).toBe("1F3CB");
    // Standalone signs and people stay themselves.
    expect(familyKey("2640-FE0F")).toBe("2640");
    expect(familyKey("1F468")).toBe("1F468");
  });
});

describe("rankImage", () => {
  const row = (emoji: string, hexcode: string, label: string, keyword = ""): Pack["emoji"][number] => [
    emoji,
    hexcode,
    0,
    1,
    0,
    label,
    "",
    keyword,
    "",
    "",
    "",
  ];
  const engine = createEngine({
    format: "emojisense-pack",
    formatVersion: 1,
    packVersion: "t",
    locale: "en",
    emojiVersion: "17.0",
    groups: ["g"],
    emoji: [
      row("🐱", "1F431", "cat face", "cat|kitten"),
      row("🐈", "1F408", "cat", "pet"),
      row("😽", "1F63D", "kissing cat", "cat|kiss"),
      row("🐼", "1F43C", "panda", "bear"),
      row("⌨️", "2328", "keyboard", "computer"),
      row("🎹", "1F3B9", "musical keyboard", "piano"),
      row("😴", "1F634", "sleeping face", "sleep|tired"),
    ],
  });
  const label = {
    caption: "a tabby cat sleeping on a computer keyboard",
    reaction: "so cute",
    keywords: ["cat", "keyboard"],
    emoji: ["🐱", "😴"],
  };
  // What the caption embedding returned in production: the cat, then weak neighbours.
  const neighbours = [CAT, hit("😽", "1F63D"), PANDA, KEYBOARD];

  it("puts the model's proposals and keyword hits first and drops weak neighbours", () => {
    const results = rankImage(engine, label, neighbours, 8);
    expect(ids(results).slice(0, 2)).toEqual(["🐱", "😴"]);
    expect(ids(results)).toContain("⌨️");
    expect(ids(results)).not.toContain("🐼");
    expect(results.every((r) => r.score <= 1)).toBe(true);
  });

  it("still ranks without the caption embedding (Workers AI degraded)", () => {
    expect(ids(rankImage(engine, label, undefined, 8)).slice(0, 2)).toEqual(["🐱", "😴"]);
  });

  it("falls back to caption words when the model gave no keywords or emoji", () => {
    expect(captionKeywords("A tabby cat sleeping on the keyboard")).toEqual([
      "tabby",
      "cat",
      "sleeping",
      "keyboard",
    ]);
    const results = rankImage(engine, { ...label, keywords: [], emoji: [] }, [], 3);
    expect(ids(results)).toContain("⌨️");
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("uses a floor that one weak neighbour alone cannot pass", () => {
    expect(0.5 * (9 / 10)).toBeLessThan(IMAGE_FLOOR);
    expect(ids(rankImage(engine, { ...label, keywords: [], emoji: [], caption: "" }, neighbours, 8))).toEqual(
      ["🐱"],
    );
  });
});
