/**
 * The demos search every language, the visitor's first: a phone set to English in Istanbul still
 * finds the Turkish "ruj" (💄).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function localesFor(pageLang: string, languages: string[]) {
  vi.resetModules();
  vi.stubGlobal("document", { documentElement: { lang: pageLang } });
  vi.stubGlobal("navigator", { languages });
  const { DEMO_LOCALES, searchLocales, visitorLocales } = await import("../src/lib/engine-client");
  return { all: DEMO_LOCALES, search: searchLocales(), visitor: visitorLocales() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchLocales", () => {
  it("adds every other language after the visitor's own", async () => {
    const { all, search, visitor } = await localesFor("en", ["en-US"]);
    expect(visitor).toEqual(["en"]);
    expect(search[0]).toBe("en");
    expect([...search].sort()).toEqual([...all].sort());
    expect(search).toContain("tr");
  });

  it("keeps the page's and the browser's languages first, in their order", async () => {
    const { search } = await localesFor("tr", ["pt-BR", "en-US"]);
    expect(search.slice(0, 3)).toEqual(["tr", "pt", "en"]);
    expect(new Set(search).size).toBe(search.length);
  });
});
