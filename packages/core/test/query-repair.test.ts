import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine.js";
import type { Pack } from "../src/pack.js";
import { row } from "./fixture.js";

const en: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["test"],
  emoji: [
    row("👋", "1F44B", "waving hand", { alias: "hello|hallo" }),
    row("🤘", "1F918", "sign of the horns", { alias: "hell yeah" }),
    row("🎃", "1F383", "jack-o-lantern", { alias: "halloween" }),
    row("🫟", "1FADF", "splatter", { alias: "messy" }),
    row("🐘", "1F418", "elephant", {}),
    row("🌈", "1F308", "rainbow", {}),
    row("☔", "2614", "umbrella with rain drops", { keyword: "rain" }),
  ],
};
const engine = createEngine(en);
const top = (query: string) => engine.search(query).results[0];

describe("completion of a whole word", () => {
  it("ranks below the word itself", () => {
    // "hell" is a word ("hell yeah"), so "hello" is a weak completion of it.
    expect(top("hell")?.emoji).toBe("🤘");
  });

  it("is untouched while the word is not one yet", () => {
    expect(top("hel")?.emoji).toBe("👋");
  });
});

describe("typo of a short token", () => {
  it("scores below a typo of a longer one", () => {
    // One edit each: "messi" (5) → "messy", "elephnt" (7) → "elephant".
    const short = (top("messi")?.score ?? 0) / (top("messy")?.score ?? 1);
    const long = (top("elephnt")?.score ?? 0) / (top("elephant")?.score ?? 1);
    expect(short).toBeLessThan(long);
    expect(short).toBeCloseTo(0.7 * 0.9, 2);
  });
});

describe("a word split by a space", () => {
  it("is also searched joined, slightly below the joined word itself", () => {
    const split = engine.search("hallo ween");
    expect(split.results[0]?.emoji).toBe("🎃");
    expect(split.results[0]?.score).toBeCloseTo((top("halloween")?.score ?? 0) * 0.95, 3);
    expect(split.coverage).toBe(1);
    // The words as typed still count: the greeting stays in the list.
    expect(split.results.map((r) => r.emoji)).toContain("👋");
    expect(split.query).toBe("hallo ween");
  });

  it("joins only into a vocabulary word", () => {
    expect(engine.search("rain bow").results[0]?.emoji).toBe("🌈");
    expect(engine.search("rain drops").results.map((r) => r.emoji)).not.toContain("🌈");
  });
});
