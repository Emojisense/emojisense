import type { SearchResult } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import type { EmojisenseApi } from "../src/api.js";
import { emojiForText, searchEmoji, suggestReactions } from "../src/tools.js";
import { engine } from "./fixture.js";

const semantic = (...ids: [string, string][]): SearchResult[] =>
  ids.map(([emoji, id], rank) => ({ emoji, id, score: 0.8 - rank * 0.1, source: "semantic" }));

function fakeApi(results: SearchResult[] | undefined) {
  return {
    search: vi.fn(async () => results),
    suggestReactions: vi.fn(async () => results),
  } satisfies EmojisenseApi;
}

describe("searchEmoji", () => {
  it("answers offline with labels and the matching alias", async () => {
    const { text, structured } = await searchEmoji({ engine }, { query: "Jurassic Park" });
    expect(structured).toMatchObject({ query: "jurassic park", locale: "en", semantic: false });
    expect(structured.results[0]).toMatchObject({
      emoji: "🦖",
      id: "1F996",
      label: "T-Rex",
      source: "alias",
      match: "jurassic park",
    });
    expect(text).toBe("🦖 T-Rex — jurassic park");
  });

  it("tolerates a typo in the last word (queries are complete, not prefixes)", async () => {
    const { structured } = await searchEmoji({ engine }, { query: "dinosuar" });
    expect(structured.results[0]?.emoji).toBe("🦖");
  });

  it("skips the API when the dictionary is confident", async () => {
    const api = fakeApi(semantic(["🚀", "1F680"]));
    const { structured } = await searchEmoji({ engine, api }, { query: "fire" });
    expect(api.search).not.toHaveBeenCalled();
    expect(structured.semantic).toBe(false);
  });

  it("merges API results for unsure queries and labels them from the local pack", async () => {
    const api = fakeApi(semantic(["", "1F389"], ["🔥", "1F525"]));
    const { text, structured } = await searchEmoji({ engine, api }, { query: "a great success", limit: 5 });
    expect(api.search).toHaveBeenCalledWith("a great success", { locale: "en", limit: 5 });
    expect(structured.semantic).toBe(true);
    expect(structured.results[0]).toMatchObject({ emoji: "🎉", label: "party popper", source: "semantic" });
    expect(text).toContain("🎉 party popper — semantic match");
  });

  it("drops API results it cannot show (unknown id, no emoji)", async () => {
    const api = fakeApi(semantic(["", "1FAFF"], ["", "1F389"]));
    const { structured } = await searchEmoji({ engine, api }, { query: "a great success" });
    expect(structured.results.map((r) => r.id)).toEqual(["1F389"]);
  });

  it("keeps the offline results when the API has no answer", async () => {
    const api = fakeApi(undefined);
    const { structured } = await searchEmoji({ engine, api }, { query: "dinosaur party" });
    expect(api.search).toHaveBeenCalled();
    expect(structured.semantic).toBe(false);
    expect(structured.results.map((r) => r.emoji)).toContain("🦖");
  });

  it("uses the requested locale for labels", async () => {
    const { structured } = await searchEmoji({ engine }, { query: "iyi ki doğdun", locale: "tr" });
    expect(structured.results[0]).toMatchObject({ emoji: "🎂", label: "doğum günü pastası" });
  });

  it("says so when nothing matches", async () => {
    const { text, structured } = await searchEmoji({ engine }, { query: "qqqqq" });
    expect(structured.results).toEqual([]);
    expect(text).toBe('No emoji found for "qqqqq".');
  });
});

describe("emojiForText", () => {
  it("appends the best emoji to the text", async () => {
    const { text, structured } = await emojiForText({ engine }, { text: "Happy birthday Sarah! " });
    expect(structured.suggestion).toBe("Happy birthday Sarah! 🎂");
    expect(structured.results[0]).toMatchObject({ emoji: "🎂", window: "happy birthday" });
    expect(text.split("\n")[0]).toBe("Suggested: Happy birthday Sarah! 🎂");
  });

  it("sends message text to suggest-reactions, never to search", async () => {
    const api = fakeApi(semantic(["🚀", "1F680"]));
    const { structured } = await emojiForText({ engine, api }, { text: "deploy went fine", limit: 3 });
    expect(api.suggestReactions).toHaveBeenCalledWith("deploy went fine", { locale: "en", limit: 3 });
    expect(api.search).not.toHaveBeenCalled();
    expect(structured).toMatchObject({ semantic: true, suggestion: "deploy went fine 🚀" });
  });

  it("returns the text unchanged when nothing matched", async () => {
    const { text, structured } = await emojiForText({ engine }, { text: "qqq zzz" });
    expect(structured).toEqual({ suggestion: "qqq zzz", semantic: false, results: [] });
    expect(text).toBe("No emoji matched this text.");
  });
});

describe("suggestReactions", () => {
  it("answers offline in one short line", async () => {
    const { text, structured } = await suggestReactions({ engine }, { text: "we launched!", limit: 2 });
    expect(structured.results.map((r) => r.emoji)).toEqual(["🎉", "👍"]);
    expect(text).toBe("🎉 party popper, 👍 thumbs up");
  });

  it("puts API results before generic fillers", async () => {
    const api = fakeApi(semantic(["🙏", "1F64F"], ["❤️", "2764"]));
    const { structured } = await suggestReactions({ engine, api }, { text: "zzz", limit: 3 });
    expect(structured.semantic).toBe(true);
    expect(structured.results.map((r) => [r.emoji, r.source])).toEqual([
      ["🙏", "semantic"],
      ["❤️", "semantic"],
      ["👍", "default"],
    ]);
  });
});
