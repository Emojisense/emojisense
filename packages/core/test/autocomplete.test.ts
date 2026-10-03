import { describe, expect, it, vi } from "vitest";
import {
  allowContext,
  createSuggestionSource,
  findShortcode,
  findTrigger,
  SHORTCODE_BEFORE_CARET,
} from "../src/autocomplete.js";
import { createEngine } from "../src/engine.js";
import type { Pack, PackRow } from "../src/pack.js";
import type { SemanticProvider } from "../src/provider.js";

const row = (
  emoji: string,
  hexcode: string,
  label: string,
  fields: Partial<Record<"shortcode" | "keyword" | "alias", string>>,
): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  fields.shortcode ?? "",
  fields.keyword ?? "",
  fields.alias ?? "",
  "",
  "",
];

/** Rows that also match "jurassic" come first, so 🦖 must win on score, not on pack order. */
const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["test"],
  emoji: [
    row("🦟", "1F99F", "mosquito", { keyword: "insect|bug", alias: "jurassic park amber" }),
    row("🦕", "1F995", "sauropod", { keyword: "dinosaur|brontosaurus", alias: "dino|longneck" }),
    row("🦖", "1F996", "T-Rex", {
      shortcode: "trex",
      keyword: "dinosaur|tyrannosaurus",
      alias: "jurassic park|jurassic world|dino",
    }),
    row("👍️", "1F44D", "thumbs up", { shortcode: "+1|thumbsup", keyword: "good|like|yes", alias: "lgtm" }),
    row("🔥", "1F525", "fire", { keyword: "flame|hot", alias: "lit" }),
    row("🚀", "1F680", "rocket", { keyword: "space", alias: "ship it|launch" }),
    row("🎉", "1F389", "party popper", { shortcode: "tada", keyword: "party|celebrate" }),
    row("😅", "1F605", "grinning face with sweat", { shortcode: "sweat smile" }),
  ],
};

const tr: Pack = {
  ...en,
  locale: "tr",
  emoji: [
    row("🦖", "1F996", "T-Rex", { keyword: "dinozor" }),
    row("🚀", "1F680", "roket", { keyword: "uzay" }),
  ],
};

const custom: Pack = {
  ...en,
  locale: "und",
  part: "custom",
  groups: ["custom"],
  emoji: [[":rocket_cat:", "C-1", 0, 0, 0, "rocket_cat", "rocket cat", "", "rocket", "", ""]],
  images: { "C-1": "https://example.com/rocket_cat.png" },
};

const engine = createEngine(en);

/** A semantic layer that knows one concept the alias pack does not. */
function stubSemantic(delayMs = 0): SemanticProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async search(query) {
      calls.push(query);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!query.startsWith("blastoff")) return undefined;
      return {
        results: [{ emoji: "🚀", id: "1F680", score: 0.7, source: "semantic" }],
        packVersion: "test",
        cached: false,
        layer: "api",
      };
    },
  };
}

describe("createSuggestionSource", () => {
  it("answers each keystroke synchronously from the alias engine", () => {
    const source = createSuggestionSource({ engine });
    expect(source.search("jurassic")[0]).toEqual({
      emoji: "🦖",
      id: "1F996",
      label: "T-Rex",
      source: "alias",
    });
    expect(source.search("ro").map((s) => s.emoji)).toEqual(["🚀"]);
    expect(source.search("zzzz")).toEqual([]);
  });

  it("caps the list at the inline-menu default of 8, or the given limit", () => {
    const flames = Array.from({ length: 12 }, (_, i) => row("🔥", `F${i}`, `flame ${i}`, {}));
    const wide = createEngine({ ...en, emoji: flames });
    expect(createSuggestionSource({ engine: wide }).search("flame")).toHaveLength(8);
    expect(createSuggestionSource({ engine: wide, limit: 3 }).search("flame")).toHaveLength(3);
  });

  it("delivers fused semantic results later, labelled by the engine", async () => {
    const onLateResults = vi.fn();
    const source = createSuggestionSource({ engine, semantic: stubSemantic(), debounceMs: 1, onLateResults });
    expect(source.search("blastoff")).toEqual([]);
    await vi.waitFor(() => expect(onLateResults).toHaveBeenCalledTimes(1));
    expect(onLateResults).toHaveBeenCalledWith("blastoff", [
      { emoji: "🚀", id: "1F680", label: "rocket", source: "semantic" },
    ]);
  });

  it("drops the semantic answer of a query the user typed past", async () => {
    const onLateResults = vi.fn();
    const semantic = stubSemantic();
    const source = createSuggestionSource({ engine, semantic, debounceMs: 5, onLateResults });
    source.search("blastoff");
    source.search("blastoffx");
    await vi.waitFor(() => expect(onLateResults).toHaveBeenCalledTimes(1));
    expect(semantic.calls).toEqual(["blastoffx"]);
    expect(onLateResults.mock.calls[0]?.[0]).toBe("blastoffx");
  });

  it("does not call the semantic layer for confident alias hits, nor after dispose", async () => {
    const semantic = stubSemantic();
    const source = createSuggestionSource({ engine, semantic, debounceMs: 1 });
    source.search("rocket");
    source.search("blastoff");
    source.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(semantic.calls).toEqual([]);
  });

  it("labels in the preferred locale", () => {
    const source = createSuggestionSource({ engine: createEngine([en, tr]), locale: "tr" });
    expect(source.search("roket")[0]?.label).toBe("roket");
  });

  it("gives nothing below the minimum query length", () => {
    const source = createSuggestionSource({ engine, minQueryLength: 2 });
    expect(source.search("r")).toEqual([]);
    expect(source.search(" r ")).toEqual([]);
    expect(source.search("ro").map((s) => s.emoji)).toEqual(["🚀"]);
  });

  it("keeps custom emoji with their image, or leaves them out", () => {
    const withCustom = createEngine([en, custom]);
    const kept = createSuggestionSource({ engine: withCustom }).search("rocket");
    expect(kept.map((s) => s.emoji)).toContain(":rocket_cat:");
    expect(kept.find((s) => s.source === "custom")).toMatchObject({
      imageUrl: "https://example.com/rocket_cat.png",
      shortcode: "rocket_cat",
    });
    const dropped = createSuggestionSource({ engine: withCustom, includeCustom: false }).search("rocket");
    expect(dropped.map((s) => s.emoji)).toEqual(["🚀"]);
  });
});

describe("SuggestionSource.resolve", () => {
  it("answers at once when the dictionary is sure", async () => {
    const semantic = stubSemantic();
    const source = createSuggestionSource({ engine, semantic, debounceMs: 1 });
    await expect(source.resolve("rocket")).resolves.toEqual([
      { emoji: "🚀", id: "1F680", label: "rocket", source: "alias" },
    ]);
    expect(semantic.calls).toEqual([]);
  });

  it("waits for the fused results of an unsure query", async () => {
    const source = createSuggestionSource({ engine, semantic: stubSemantic(), debounceMs: 1 });
    await expect(source.resolve("blastoff")).resolves.toEqual([
      { emoji: "🚀", id: "1F680", label: "rocket", source: "semantic" },
    ]);
  });

  it("answers with the alias results when the semantic layer is too slow", async () => {
    const source = createSuggestionSource({ engine, semantic: stubSemantic(200), debounceMs: 1 });
    await expect(source.resolve("blastoff", { waitMs: 20 })).resolves.toEqual([]);
    source.dispose();
  });

  it("answers an older pending query when a newer one starts", async () => {
    const source = createSuggestionSource({ engine, semantic: stubSemantic(20), debounceMs: 1 });
    const older = source.resolve("blastoff");
    const newer = source.resolve("blastoffs");
    await expect(older).resolves.toEqual([]);
    await expect(newer).resolves.toEqual([{ emoji: "🚀", id: "1F680", label: "rocket", source: "semantic" }]);
  });

  it("settles the last search: alias rows now, fused rows later", async () => {
    const source = createSuggestionSource({ engine, semantic: stubSemantic(), debounceMs: 1 });
    expect(source.search("blastoff")).toEqual([]);
    await expect(source.settled()).resolves.toEqual([
      { emoji: "🚀", id: "1F680", label: "rocket", source: "semantic" },
    ]);
    expect(source.search("rocket").map((s) => s.emoji)).toEqual(["🚀"]);
    await expect(source.settled()).resolves.toEqual([
      { emoji: "🚀", id: "1F680", label: "rocket", source: "alias" },
    ]);
  });

  it("answers a pending query on dispose", async () => {
    const source = createSuggestionSource({ engine, semantic: stubSemantic(50), debounceMs: 1 });
    const pending = source.resolve("blastoff");
    source.dispose();
    await expect(pending).resolves.toEqual([]);
  });
});

describe("findShortcode", () => {
  it.each([
    ["trex", "🦖"],
    ["+1", "👍️"],
    ["thumbsup", "👍️"],
    ["sweat_smile", "😅"],
    ["fire", "🔥"],
    ["TADA", "🎉"],
  ])("resolves :%s:", (code, emoji) => {
    expect(findShortcode(engine, code)?.emoji).toBe(emoji);
  });

  it.each(["jurassic", "tre", "dino", "fier", "", "!!"])(
    "ignores :%s: (no exact shortcode or name)",
    (code) => {
      expect(findShortcode(engine, code)).toBeUndefined();
    },
  );

  it("matches a completed shortcode before the caret", () => {
    expect("ship it :fire:".match(SHORTCODE_BEFORE_CARET)?.[1]).toBe("fire");
    expect("12:30:".match(SHORTCODE_BEFORE_CARET)).toBeNull();
  });
});

describe("allowContext", () => {
  it.each([
    ["", ""],
    ["hello ", ""],
    ["(", ""],
    ["“", " end"],
  ])("opens after %j", (before, after) => {
    expect(allowContext(before, after)).toBe(true);
  });

  it.each([
    ["12", ""],
    ["https", ""],
    ["a", ""],
    ["", "word"],
  ])("stays closed for %j + %j", (before, after) => {
    expect(allowContext(before, after)).toBe(false);
  });
});

describe("findTrigger", () => {
  it("finds the query that ends at the caret, with spaces", () => {
    expect(findTrigger(":pizza")).toEqual({ query: "pizza", start: 0 });
    expect(findTrigger("Go :ship it")).toEqual({ query: "ship it", start: 3 });
    expect(findTrigger("(:fire")).toEqual({ query: "fire", start: 1 });
    expect(findTrigger("Go :")).toEqual({ query: "", start: 3 });
  });

  it("ignores times, URLs, words and finished shortcodes", () => {
    expect(findTrigger("at 12:30")).toBeUndefined();
    expect(findTrigger("https://example")).toBeUndefined();
    expect(findTrigger("a:b")).toBeUndefined();
    expect(findTrigger(":fire:")).toBeUndefined();
    expect(findTrigger("no colon")).toBeUndefined();
  });

  it("stays closed when a word follows the caret", () => {
    expect(findTrigger(":pi", "zza")).toBeUndefined();
    expect(findTrigger(":pi", " later")).toEqual({ query: "pi", start: 0 });
  });

  it("stops at a space right after the colon, a line break or a sentence", () => {
    expect(findTrigger(": pizza")).toBeUndefined();
    expect(findTrigger(":pizza\nmore")).toBeUndefined();
    expect(findTrigger(":one two three four five")).toBeUndefined();
    expect(findTrigger(":one two three four", "", { maxWords: 4 })).toBeDefined();
    expect(findTrigger(`:${"a".repeat(33)}`)).toBeUndefined();
    expect(findTrigger(":abc", "", { maxLength: 2 })).toBeUndefined();
  });
});
