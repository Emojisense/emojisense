import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine.js";
import type { Pack } from "../src/pack.js";
import { row } from "./fixture.js";

const pack = (locale: string, emoji: Pack["emoji"]): Pack => ({
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale,
  emojiVersion: "17.0",
  groups: ["test"],
  emoji,
});

const ROWS = {
  rock: ["🪨", "1FAA8", "rock"],
  rocket: ["🚀", "1F680", "rocket"],
  lamp: ["🪔", "1FA94", "diya lamp"],
  llama: ["🦙", "1F999", "llama"],
  ring: ["💍", "1F48D", "ring"],
  kneel: ["🧎", "1F9CE", "person kneeling"],
  cat: ["🐈", "1F408", "cat"],
} as const;
type Key = keyof typeof ROWS;
const r = (key: Key, fields: Parameters<typeof row>[3] = {}, label?: string) => {
  const [emoji, hexcode, name] = ROWS[key];
  return row(emoji, hexcode, label ?? name, fields);
};

const en = pack("en", [
  r("rock"),
  r("rocket", { keyword: "space" }),
  r("lamp", { keyword: "lamp" }),
  r("llama"),
  r("ring", { keyword: "wedding" }),
  r("kneel"),
  r("cat"),
]);
const tr = pack("tr", [
  r("rock", {}, "kaya"),
  r("rocket", {}, "roket"),
  r("lamp", {}, "kandil"),
  r("llama", {}, "lama"),
  r("ring", {}, "yüzük"),
  r("kneel", {}, "diz çöken kişi"),
  r("cat", {}, "kedi"),
]);
const id = pack("id", [
  r("rock", {}, "batu"),
  r("rocket", {}, "roket"),
  r("lamp", {}, "pelita"),
  r("llama", {}, "llama"),
  r("ring", { alias: "lamaran" }, "cincin"),
  r("kneel", { alias: "lamar pacar" }, "orang berlutut"),
  r("cat", {}, "kucing"),
]);

const enTr = createEngine([en, tr]);
const enId = createEngine([en, id]);
const emoji = (engine: ReturnType<typeof createEngine>, q: string, locale = "en") =>
  engine.search(q, { locale }).results.map((x) => x.emoji);

describe("short tokens need stronger evidence for a typo match", () => {
  it("never reads a short token as a word it extends", () => {
    // "rockt" → "rocket" (a letter left out), not "rock" (a letter more).
    expect(emoji(enTr, "rockt")[0]).toBe("🚀");
    expect(emoji(enTr, "rockt")).not.toContain("🪨");
  });

  it("matches a short typo only to a word of the preferred locale", () => {
    // "lamar" is not Turkish "lama" (🦙): a word it extends, in another locale.
    expect(emoji(enTr, "lamar ")).toEqual([]);
    // "kedu" is a typo of Turkish "kedi" for Turkish users, not for English ones.
    expect(emoji(enTr, "kedu ", "tr")).toEqual(["🐈"]);
    expect(emoji(enTr, "kedu ", "en")).toEqual([]);
    // A typo of a preferred-locale word still matches: "rcok" → "rock".
    expect(emoji(enTr, "rcok ")[0]).toBe("🪨");
  });
});

describe("a partial match of one token does not stand for a query of unknown words", () => {
  it("drops a prefix match of one token when another token matches nothing", () => {
    expect(emoji(enTr, "roc")).toContain("🚀");
    expect(emoji(enTr, "qzxv roc")).toEqual([]);
  });

  it("keeps an exact word next to an unknown one", () => {
    expect(emoji(enTr, "qzxv rock")).toContain("🪨");
    expect(enTr.search("qzxv rock").coverage).toBeLessThan(0.85);
  });
});

describe("prefix completions into another locale's words", () => {
  it("rank below an exact word, in any locale", () => {
    // id "lamar" (in "lamar pacar") is a whole word; id "lamaran" only completes it. A completion
    // of a whole word is weak enough to drop out entirely (WHOLE_WORD_COMPLETION_QUALITY).
    const results = emoji(enId, "lamar");
    const ring = results.indexOf("💍");
    expect(results.indexOf("🧎")).toBe(0);
    expect(ring === -1 || ring > 0).toBe(true);
  });

  it("never outrank a match of the preferred locale", () => {
    // "lam" completes en "lamp" and id "lamaran": the English word first.
    expect(emoji(enId, "lam")[0]).toBe("🪔");
    const out = enId.search("lam", { locale: "en" });
    const ring = out.results.find((x) => x.emoji === "💍");
    expect(ring?.score).toBeLessThan(out.results[0]?.score ?? 0);
  });

  it("are whole words for the locale that has them", () => {
    expect(enId.search("lamara", { locale: "id" }).results[0]?.emoji).toBe("💍");
    expect(enId.search("lamara", { locale: "id" }).coverage).toBe(1);
    expect(enId.search("lamara", { locale: "en" }).coverage).toBe(0);
  });
});

describe("coverage", () => {
  it("is the share of the query one phrase matches with whole tokens", () => {
    expect(enTr.search("rock").coverage).toBe(1);
    expect(enTr.search("rocke").coverage).toBe(1); // completion of the word being typed
    expect(enTr.search("rockt").coverage).toBe(1); // a typo of the whole word
    expect(enTr.search("").coverage).toBe(0);
    expect(enTr.search("qzxv").coverage).toBe(0);
  });
});
