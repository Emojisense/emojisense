import { describe, expect, it } from "vitest";
import { matchText, textTokens, textWindows } from "../src/text.js";
import { engine } from "./fixture.js";

const ids = (text: string, limit = 10) => matchText(engine, text, { limit }).map((m) => m.emoji);

describe("textWindows", () => {
  it("lists windows longest first and keeps windows that start with a function word", () => {
    const windows = textWindows(textTokens("the server is on fire"));
    expect(windows[0]).toBe("the server is on");
    expect(windows).toContain("on fire");
    expect(windows.indexOf("on fire")).toBeLessThan(windows.indexOf("fire"));
  });

  it("skips windows made only of function words", () => {
    const windows = textWindows(textTokens("it is on fire"));
    expect(windows).not.toContain("it is");
    expect(windows).not.toContain("on");
  });

  it("caps long text at 64 words", () => {
    expect(textTokens("word ".repeat(200))).toHaveLength(64);
  });
});

describe("matchText", () => {
  it("finds emoji for phrases inside a sentence and names the matching window", () => {
    const [best] = matchText(engine, "Happy birthday, Sarah!!");
    expect(best).toMatchObject({ emoji: "🎂", match: "happy birthday", window: "happy birthday" });
  });

  it("prefers an exact multi-word alias over a single keyword", () => {
    expect(ids("the server is on fire again")[0]).toBe("🔥");
  });

  it("matches every loaded pack unless locales are given", () => {
    const bald = "1F468-200D-1F9B2";
    expect(matchText(engine, "careca nato").map((m) => m.id)).toContain(bald);
    expect(matchText(engine, "careca nato", { locales: ["en"] }).map((m) => m.id)).not.toContain(bald);
  });

  it("drops aliases whose words the text does not contain", () => {
    // "shipped" partly matches "order shipped", but the text never says "order".
    expect(ids("we shipped it")).not.toContain("🚚");
    expect(ids("my order shipped")).toContain("🚚");
  });

  it("ranks a lone common word below specific matches", () => {
    const results = matchText(engine, "new dinosaur");
    expect(results.map((r) => r.emoji)).toEqual(["🦖", "🆕"]);
    expect(results[1]?.score).toBeLessThan(0.7);
  });

  it("does not let a two-letter word pick a country flag", () => {
    const results = matchText(engine, "can you look at my pr");
    const flag = results.find((r) => r.emoji === "🇵🇷");
    expect(results[0]?.emoji).toBe("👀");
    expect(flag === undefined || flag.score < 0.5).toBe(true);
  });

  it("matches Turkish text through the folded alias", () => {
    expect(ids("İyi ki doğdun!")[0]).toBe("🎂");
  });

  it("returns nothing for text without matches and respects the limit", () => {
    expect(ids("zzz qqq")).toEqual([]);
    expect(ids("fire party birthday dinosaur", 2)).toHaveLength(2);
  });
});
