import { describe, expect, it } from "vitest";
import { toEmojiItem, whyMatched } from "../src/lib/format";
import { engine } from "./fixture";

const first = (query: string, locale = "en") => {
  const [result] = engine.search(query, { locale }).results;
  if (!result) throw new Error(`no result for ${query}`);
  return toEmojiItem(engine, result, locale);
};

describe("toEmojiItem", () => {
  it("shows the alias phrase that matched", () => {
    expect(first("jurassic park")).toEqual({
      key: "1F996:alias",
      emoji: "🦖",
      hexcode: "1F996",
      title: "T-Rex",
      subtitle: "“jurassic park”",
      kind: "alias",
    });
  });

  it("writes shortcodes the way people type them", () => {
    expect(first("thumbsup")).toMatchObject({ subtitle: ":thumbsup:", kind: "shortcode" });
  });

  it("leaves the subtitle empty for a match on the name", () => {
    expect(first("rocket")).toMatchObject({ title: "rocket", subtitle: "", kind: "name" });
  });

  it("names typos and weak aliases", () => {
    expect(first("dinasour")).toMatchObject({ subtitle: "“dinasour”", kind: "typo" });
    expect(first("to the moon")).toMatchObject({ subtitle: "“to the moon”", kind: "related" });
  });

  it("uses the label of the chosen locale", () => {
    expect(first("iyi ki doğdun", "tr")).toMatchObject({ emoji: "🎂", title: "doğum günü pastası" });
  });

  it("labels semantic results from the pack", () => {
    const item = toEmojiItem(engine, { emoji: "", id: "1F680", score: 0.7, source: "semantic" }, "en");
    expect(item).toMatchObject({
      emoji: "🚀",
      title: "rocket",
      subtitle: "similar meaning",
      kind: "semantic",
    });
  });
});

describe("whyMatched", () => {
  it("handles custom emoji from the API", () => {
    expect(whyMatched({ emoji: "🦜", id: "custom:parrot", score: 1, source: "custom" })).toEqual({
      subtitle: "custom emoji",
      kind: "custom",
    });
  });
});
