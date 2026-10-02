import { describe, expect, it } from "vitest";
import { suggestReactionsOffline } from "../src/reactions.js";
import { engine } from "./fixture.js";

describe("suggestReactionsOffline", () => {
  it("prefers common reaction emoji over topical ones", () => {
    const emoji = suggestReactionsOffline(engine, "we shipped it!", { limit: 3 }).map((r) => r.emoji);
    // 🚢 matches "shipped" more strongly, but people react with 🎉.
    expect(emoji.indexOf("🎉")).toBeLessThan(emoji.indexOf("🚢"));
  });

  it("fills short lists with generic reactions marked as defaults", () => {
    const results = suggestReactionsOffline(engine, "nothing to see", { limit: 3 });
    expect(results.map((r) => [r.emoji, r.source])).toEqual([
      ["👍", "default"],
      ["❤️", "default"],
    ]);
  });

  it("adds 👀 and 🤔 for questions", () => {
    const results = suggestReactionsOffline(engine, "zzz?", { limit: 2 });
    expect(results.map((r) => r.emoji)).toEqual(["👀", "🤔"]);
  });

  it("never repeats an emoji and respects the limit", () => {
    const results = suggestReactionsOffline(engine, "thank you, looks good!", { limit: 3 });
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.id)).size).toBe(3);
    expect(results[0]?.source).toBe("alias");
  });
});
