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
