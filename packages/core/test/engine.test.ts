import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine.js";
import { en, row, tr } from "./fixture.js";

const engine = createEngine([en, tr]);
const top = (q: string, locale?: string) =>
  engine.search(q, locale ? { locale } : {}).results.map((r) => r.emoji);

describe("alias engine", () => {
  it("ranks an exact name first", () => {
    expect(top("fire")[0]).toBe("🔥");
    expect(top("fire")).toContain("🚒");
  });

  it("matches shortcodes and aliases", () => {
    expect(top("+1")[0]).toBe("👍");
    expect(top("lgtm")[0]).toBe("👍");
    expect(top("ship it")[0]).toBe("🚀");
    expect(top("jurassic park")[0]).toBe("🦖");
  });

  it("weights rare words over stopwords", () => {
    expect(top("greatest of all time")[0]).toBe("🐐");
    expect(top("the moon")[0]).toBe("🚀");
  });

  it("completes the token being typed", () => {
    expect(top("rock")[0]).toBe("🚀");
    expect(top("jurassic pa")[0]).toBe("🦖");
  });

  it("does not prefix-complete after a trailing space", () => {
    expect(top("rock ")).toEqual([]);
  });

  it("tolerates typos", () => {
    expect(top("hallowelen")[0]).toBe("🎃");
    expect(top("rockt")[0]).toBe("🚀");
    expect(top("thumbs upp")[0]).toBe("👍");
    expect(top("dinasour")[0]).toBe("🦖");
  });

  it("searches across loaded locales and prefers the active one", () => {
    expect(top("doğum günü", "tr")[0]).toBe("🎂");
    expect(top("dogum gunu", "tr")[0]).toBe("🎂");
    expect(top("iyi ki doğdun", "tr")[0]).toBe("🎂");
    expect(top("rocket", "tr")[0]).toBe("🚀");
  });

  it("returns per-locale labels", () => {
    const [result] = engine.search("tamam", { locale: "tr" }).results;
    expect(result?.label).toBe("baş parmak yukarıda");
  });

  it("returns nothing for empty or emoji-only queries", () => {
    expect(engine.search("").results).toEqual([]);
    expect(engine.search("🚀").results).toEqual([]);
  });

  it("reports confidence and the matching phrase", () => {
    const out = engine.search("jurassic park");
    expect(out.confidence).toBeGreaterThan(0.7);
    expect(out.results[0]?.match).toBe("jurassic park");
    expect(out.results[0]?.field).toBe("alias");
    expect(engine.search("qxzvbn").confidence).toBe(0);
  });

  it("respects the limit", () => {
    expect(engine.search("f", { limit: 1 }).results).toHaveLength(1);
  });

  it("merges an extension pack of the same locale without a locale penalty", () => {
    const ext = {
      ...en,
      part: "ext" as const,
      emoji: [["🐐", "1F410", 0, 1, 0, "", "", "", "the goat", "", ""] as (typeof en.emoji)[number]],
    };
    const withExt = createEngine([en, ext, tr]);
    const [goat] = withExt.search("the goat", { locale: "en" }).results;
    expect(goat?.emoji).toBe("🐐");
    expect(goat?.score).toBeGreaterThan(0.75);
    expect(withExt.get("1F410")?.labels.en).toBe("goat");
    expect(withExt.locales).toEqual(["en", "tr"]);
  });

  it("adds the evidence bonus only for phrases of the preferred locale", () => {
    // 🧛 comes first in row order, so a tie would rank it above 🎃.
    const english = {
      ...en,
      emoji: [
        row("🧛", "1F9DB", "vampire", { keyword: "halloween" }),
        row("🎃", "1F383", "jack-o-lantern", { keyword: "halloween|pumpkin", alias: "happy halloween" }),
      ],
    };
    const spanish = {
      ...en,
      locale: "es",
      emoji: [
        row("🧛", "1F9DB", "vampiro", {
          alias: "fiesta de halloween|disfraz de halloween|noche de halloween",
        }),
      ],
    };
    const multi = createEngine([english, spanish]);
    const first = (locale: string) => multi.search("halloween", { locale }).results[0]?.emoji;
    expect(first("en")).toBe("🎃");
    expect(first("es")).toBe("🧛");
  });

  it("looks up entries by id", () => {
    expect(engine.get("1F680")?.emoji).toBe("🚀");
    expect(engine.get("1F680")?.labels).toEqual({ en: "rocket" });
  });
});

describe("alias engine memory", () => {
  /**
   * Live objects of a constructor after a full GC (Node ≥ 22 `v8.queryObjects`). Counts are
   * deterministic, unlike heap sizes. A string specifier: the browser-typed tests have no Node types.
   */
  async function liveObjects() {
    const v8 = await import(/* @vite-ignore */ "node:v8".toString());
    return (ctor: unknown) => v8.queryObjects(ctor, { format: "count" }) as number;
  }

  it("frees its build-time structures once the index is built", async () => {
    const count = await liveObjects();
    let seed = 1;
    const pick = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const words = Array.from({ length: 3000 }, (_, i) => `w${i.toString(36)}x`);
    const phrases = (count: number) =>
      Array.from({ length: count }, () =>
        Array.from({ length: 1 + pick(3) }, () => words[pick(words.length)]).join(" "),
      ).join("|");
    const EMOJI = 500;
    const PHRASES_PER_EMOJI = 25;
    const ENGINES = 5;
    const pack = {
      ...en,
      emoji: Array.from({ length: EMOJI }, (_, i) =>
        row(String.fromCodePoint(0x1f300 + i), (0x1f300 + i).toString(16), `emoji ${i}`, {
          keyword: phrases(4),
          alias: phrases(PHRASES_PER_EMOJI - 5),
        }),
      ),
    };

    const engines = Array.from({ length: ENGINES }, () => createEngine(pack));
    expect(engines[0]?.search("emoji 7").results[0]?.label).toBe("emoji 7");
    const maps = count(Map);
    const arrays = count(Array);
    engines.length = 0;
    // What the engines themselves held. They keep a few lookup maps, the vocabulary, phrase texts
    // and length buckets; not one dedup map per emoji or one token list per phrase. (Right after
    // a build, V8 can hold the build scope for a moment, e.g. for a background compile job; that
    // is not the engine's and does not depend on it, so it is not counted here.)
    const perEngine = (before: number, after: number) => (before - after) / ENGINES;
    expect(perEngine(maps, count(Map))).toBeLessThan(EMOJI / 10);
    expect(perEngine(arrays, count(Array))).toBeLessThan((EMOJI * PHRASES_PER_EMOJI) / 10);
  });
});
