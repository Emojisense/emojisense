import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "../src/engine.js";
import { PACK_LOCALES, packLocaleOf, userLocales } from "../src/locales.js";
import type { Pack } from "../src/pack.js";
import { createSearchSession, type SessionState } from "../src/session.js";
import { custom, en, row, tr } from "./fixture.js";

const pt: Pack = {
  ...en,
  locale: "pt",
  emoji: [
    row("🎃", "1F383", "abóbora", { alias: "careca nato" }),
    row("🎂", "1F382", "bolo de aniversário", { keyword: "bolo" }),
  ],
};

const engine = createEngine([en, tr, pt, custom]);
const emoji = (query: string, options: Parameters<typeof engine.search>[1] = {}) =>
  engine.search(query, options).results.map((result) => result.emoji);

describe("search in the user's languages", () => {
  it("matches every loaded pack by default", () => {
    expect(emoji("nato", { locale: "en" })).toEqual(["🎃"]);
  });

  it("leaves out the phrases of the other loaded languages", () => {
    const user = { locale: "en", locales: ["en", "tr"] };
    expect(emoji("nato", user)).toEqual([]);
    expect(emoji("bolo", user)).toEqual([]);
    expect(emoji("iyi ki dogdun", user)).toEqual(["🎂"]);
  });

  it("never completes or corrects a word into a language the user does not have", () => {
    expect(emoji("carec", { locale: "en" })).toContain("🎃");
    expect(emoji("carec", { locale: "en", locales: ["en"] })).toEqual([]);
    expect(emoji("carecs", { locale: "en" })).toContain("🎃");
    expect(emoji("carecs", { locale: "en", locales: ["en"] })).toEqual([]);
  });

  it("always searches English, the preferred locale and custom packs", () => {
    expect(emoji("thumbsup", { locale: "tr", locales: ["tr"] })).toContain("👍");
    expect(emoji("bolo", { locale: "pt", locales: ["en"] })).toEqual(["🎂"]);
    expect(emoji("party parrot", { locale: "en", locales: ["en"] })).toContain(":party_parrot:");
  });

  it("is passed on by the search session", () => {
    let state: SessionState | undefined;
    const session = createSearchSession({
      engine,
      locale: "en",
      locales: ["en", "tr"],
      onChange: (next) => {
        state = next;
      },
    });
    session.update("nato");
    expect(state?.results).toEqual([]);
    session.dispose();
  });
});

describe("userLocales", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the user's language tags to packs, most preferred first, always with English", () => {
    expect(userLocales({ languages: ["tr-TR", "en-US", "de", "tr"] })).toEqual(["tr", "en"]);
    expect(userLocales({ languages: ["pt-BR"] })).toEqual(["pt", "en"]);
    expect(userLocales({ languages: ["zh-Hant-TW", "in"] })).toEqual(["zh", "id", "en"]);
    expect(userLocales({ languages: [] })).toEqual(["en"]);
  });

  it("keeps to the supported packs", () => {
    expect(userLocales({ languages: ["fr", "tr"], supported: ["en", "tr"] })).toEqual(["tr", "en"]);
  });

  it("reads the browser's languages by default", () => {
    vi.stubGlobal("navigator", { languages: ["es-MX", "en"] });
    expect(userLocales()).toEqual(["es", "en"]);
    vi.stubGlobal("navigator", { language: "ru-RU" });
    expect(userLocales()).toEqual(["ru", "en"]);
  });
});

describe("packLocaleOf", () => {
  it("maps a BCP 47 tag to its language's pack", () => {
    expect(packLocaleOf("en_US")).toBe("en");
    expect(packLocaleOf(" PT-br ")).toBe("pt");
    expect(packLocaleOf("de-DE")).toBeUndefined();
  });

  it("knows every published pack", async () => {
    const { LOCALE_CODES } = await import("../../data/src/locales.js");
    expect([...PACK_LOCALES].sort()).toEqual([...LOCALE_CODES].sort());
  });
});
