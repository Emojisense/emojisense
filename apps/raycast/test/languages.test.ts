import { readFileSync } from "node:fs";
import { PACK_LOCALES } from "emojisense";
import { describe, expect, it, vi } from "vitest";
import { chooseLanguages, parseAppleLanguages, SYSTEM_LANGUAGE, systemLanguages } from "../src/lib/languages";

describe("parseAppleLanguages", () => {
  it("reads the list that `defaults` prints", () => {
    expect(parseAppleLanguages('(\n    "en-TR",\n    "tr-TR",\n    "zh-Hans-CN"\n)\n')).toEqual([
      "en-TR",
      "tr-TR",
      "zh-Hans-CN",
    ]);
  });

  it("accepts tags without quotes", () => {
    expect(parseAppleLanguages("(\n    en,\n    de\n)")).toEqual(["en", "de"]);
  });

  it("returns nothing for an empty list or an error message", () => {
    expect(parseAppleLanguages("(\n)")).toEqual([]);
    expect(
      parseAppleLanguages("The domain/default pair of (kCFPreferencesAnyApplication, x) does not exist"),
    ).toEqual([]);
  });
});

describe("systemLanguages", () => {
  const runtimeLocale = () => "de-DE";

  it("uses the macOS list, most preferred first", () => {
    const readAppleLanguages = () => '(\n    "tr-TR",\n    "en-US"\n)';
    expect(systemLanguages({ platform: "darwin", readAppleLanguages, runtimeLocale })).toEqual([
      "tr-TR",
      "en-US",
    ]);
  });

  it("falls back to the runtime's locale when `defaults` fails or has no list", () => {
    const fails = () => {
      throw new Error("spawn ENOENT");
    };
    expect(systemLanguages({ platform: "darwin", readAppleLanguages: fails, runtimeLocale })).toEqual([
      "de-DE",
    ]);
    expect(systemLanguages({ platform: "darwin", readAppleLanguages: () => "(\n)", runtimeLocale })).toEqual([
      "de-DE",
    ]);
  });

  it("does not ask macOS on Windows", () => {
    const readAppleLanguages = vi.fn(() => '("tr-TR")');
    expect(systemLanguages({ platform: "win32", readAppleLanguages, runtimeLocale })).toEqual(["de-DE"]);
    expect(readAppleLanguages).not.toHaveBeenCalled();
  });
});

describe("chooseLanguages", () => {
  const all = PACK_LOCALES;

  it("follows the system: its languages with a pack, the first one preferred, and English", () => {
    expect(chooseLanguages(SYSTEM_LANGUAGE, ["tr-TR", "en-US", "de"], all)).toEqual({
      locale: "tr",
      locales: ["tr", "en"],
    });
    expect(chooseLanguages(SYSTEM_LANGUAGE, ["de-DE"], all)).toEqual({ locale: "en", locales: ["en"] });
  });

  it("puts the chosen language first and keeps the system languages", () => {
    expect(chooseLanguages("es", ["tr-TR", "en-US"], all)).toEqual({
      locale: "es",
      locales: ["es", "tr", "en"],
    });
    expect(chooseLanguages("en", ["tr-TR"], all)).toEqual({ locale: "en", locales: ["en", "tr"] });
  });

  it("leaves out languages without a bundled pack", () => {
    expect(chooseLanguages(SYSTEM_LANGUAGE, ["pt-BR", "tr"], ["en", "tr"])).toEqual({
      locale: "tr",
      locales: ["tr", "en"],
    });
  });
});

describe("the Preferred Language preference", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    preferences: { name: string; default?: string; data?: { value: string }[] }[];
  };
  const preference = manifest.preferences.find((p) => p.name === "locale");

  it("follows the system by default and offers every pack language", () => {
    expect(preference?.default).toBe(SYSTEM_LANGUAGE);
    expect(preference?.data?.map((option) => option.value)).toEqual([SYSTEM_LANGUAGE, ...PACK_LOCALES]);
  });
});
