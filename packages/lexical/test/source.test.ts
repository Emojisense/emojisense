import { createEngine } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { createSuggestionSource, findShortcode } from "../src/source.js";
import { en, engine, row, stubSemantic, tr } from "./fixture.js";

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
});
