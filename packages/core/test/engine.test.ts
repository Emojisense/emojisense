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

  it("ranks an exact match of the preferred locale above an exact match only another pack has", () => {
    // The English name (1.0) and shortcode (0.95) outweigh a French alias (0.8) or keyword
    // (0.85) even after the foreign factor (0.92).
    const english = {
      ...en,
      emoji: [
        row("🦶", "1F9B6", "foot", {}),
        row("🏈", "1F3C8", "american football", { shortcode: "football" }),
        row("⚽", "26BD", "soccer ball", { keyword: "soccer" }),
      ],
    };
    const french = {
      ...en,
      locale: "fr",
      emoji: [
        row("🦶", "1F9B6", "pied", {}),
        row("🏈", "1F3C8", "football américain", { keyword: "ballon ovale" }),
        row("⚽", "26BD", "ballon de football", { keyword: "football", alias: "foot" }),
      ],
    };
    const multi = createEngine([english, french]);
    const top = (q: string, locale: string) =>
      multi.search(q, { locale, prefix: false }).results.map((r) => `${r.emoji} ${r.score}`);
    expect(top("foot", "fr").slice(0, 2)).toEqual(["⚽ 0.8", "🦶 0.79"]);
    expect(top("football", "fr").slice(0, 2)).toEqual(["⚽ 0.87", "🏈 0.86"]);
    // Without an exact French match, the English one keeps its score; English searches are unchanged.
    expect(top("soccer", "fr")[0]).toBe("⚽ 0.782");
    expect(top("foot", "en")[0]).toBe("🦶 1");
  });

  it("keeps the whole-query alias above a partial name match that the evidence bonus lifts", () => {
    // en "ship it": 🚢's name "ship" covers all but the stopword (0.9 × 0.95 ≈ 0.86) and its other
    // ship phrases add +0.06; 🚀's alias "ship it" is the whole query (0.8 × 1.1 = 0.88). A rare
    // word needs a large catalog, as in the real packs: hence the filler rows.
    const filler = Array.from({ length: 1000 }, (_, i) => row(`f${i}`, `F${i}`, `filler ${i}`, {}));
    const english = {
      ...en,
      emoji: [
        row("🚢", "1F6A2", "ship", { alias: "cargo ship|cruise ship|container ship|i ship it" }),
        row("🚀", "1F680", "rocket", { alias: "ship it|rocket ship" }),
        row("📦", "1F4E6", "package", { alias: "ship it" }),
        ...filler,
      ],
    };
    const ships = createEngine([english]);
    const top = (q: string) => ships.search(q, { prefix: false }).results.map((r) => `${r.emoji} ${r.score}`);
    expect(top("ship it").slice(0, 3)).toEqual(["🚀 0.9", "📦 0.88", "🚢 0.87"]);
    expect(top("ship")[0]).toBe("🚢 1");
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
    // Right after a build V8 can still hold its scope for a moment (e.g. a background compile
    // job). That is not the engine's, so the test measures what dropping the engines frees.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const maps = count(Map);
    const arrays = count(Array);
    engines.length = 0;
    const perEngine = (before: number, after: number) => (before - after) / ENGINES;
    // Kept per engine: a few lookup maps, the vocabulary, phrase texts and length buckets. Before
    // the fix: one dedup map per emoji and one token list per phrase. The thresholds sit halfway,
    // so a late release of one or two build scopes during the measurement cannot fail the test.
    expect(perEngine(maps, count(Map))).toBeLessThan(EMOJI / 2);
    expect(perEngine(arrays, count(Array))).toBeLessThan((EMOJI * PHRASES_PER_EMOJI) / 2);
  });
});

describe("unspaced scripts", () => {
  const zh = {
    ...en,
    locale: "zh",
    emoji: [
      row("🎂", "1F382", "生日蛋糕", { keyword: "生日|蛋糕", alias: "生日快乐" }),
      row("🚀", "1F680", "火箭", { keyword: "火箭", alias: "发射" }),
    ],
  };
  const chinese = createEngine([en, zh]);
  const search = (q: string) => chinese.search(q, { locale: "zh" });

  it("splits a run that is not one token into the tokens it holds, longest first", () => {
    const out = search("今天生日快乐");
    expect(out.tokens).toEqual(["今天", "生日快乐"]);
    expect(out.results[0]?.emoji).toBe("🎂");
    expect(search("火箭发射").tokens).toEqual(["火箭", "发射"]);
    expect(search("火箭发射").results[0]?.emoji).toBe("🚀");
  });

  it("keeps unknown characters together as one token, which counts like an unknown word", () => {
    expect(search("今天的蛋糕").tokens).toEqual(["今天的", "蛋糕"]);
    expect(search("今天的蛋糕").results[0]?.emoji).toBe("🎂");
    // Two unknown pieces outweigh one known piece: below the coverage threshold, as for spaced text.
    expect(search("今天的蛋糕呀").tokens).toEqual(["今天的", "蛋糕", "呀"]);
    expect(search("今天的蛋糕呀").results).toEqual([]);
  });

  it("does not split a token that is indexed, or one still being typed", () => {
    expect(search("生日快乐").tokens).toEqual(["生日快乐"]);
    expect(search("生日快").tokens).toEqual(["生日快"]);
    expect(search("生日快").results[0]?.emoji).toBe("🎂");
    expect(chinese.search("生日快 ", { locale: "zh" }).tokens).toEqual(["生日", "快"]);
  });

  it("leaves spaced scripts alone", () => {
    expect(engine.search("rockets").tokens).toEqual(["rockets"]);
  });
});
