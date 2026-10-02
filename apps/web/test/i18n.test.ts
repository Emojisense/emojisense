/**
 * The string catalogs (src/i18n/<locale>.json): every language has every message of the English
 * catalog, with the same placeholders and tags, and the helpers route and fill them correctly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import {
  DEFAULT_LOCALE,
  isLocalizedPath,
  LOCALE_INFO,
  LOCALES,
  localizePath,
  unlocalizePath,
} from "../src/i18n/locales";
import { type Catalog, createTranslator, isPlural, type MessageValue } from "../src/i18n/translate";
import { ENGLISH_ERRORS } from "../src/lib/waitlist";

const catalogFile = (locale: string) => fileURLToPath(new URL(`../src/i18n/${locale}.json`, import.meta.url));
const catalogs = Object.fromEntries(
  LOCALES.map((locale) => [locale, JSON.parse(readFileSync(catalogFile(locale), "utf8")) as Catalog]),
);

/** Dotted path → message (a string or a plural object). */
function messages(catalog: Catalog, prefix = "", out = new Map<string, MessageValue>()) {
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" || isPlural(value)) out.set(path, value);
    else messages(value as Catalog, path, out);
  }
  return out;
}

const texts = (value: MessageValue): string[] =>
  typeof value === "string" ? [value] : Object.values(value as Record<string, string>);
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (text: string) => [...text.matchAll(/<(\w+)>[\s\S]*?<\/\1>/g)].map((m) => m[1]).sort();

const english = messages(en as Catalog);
const OTHER_LOCALES = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

describe("catalogs", () => {
  it("has a catalog for every locale", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...LOCALES].sort());
  });

  it.each(OTHER_LOCALES)("%s has exactly the English keys", (locale) => {
    const own = messages(catalogs[locale] as Catalog);
    expect([...own.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it.each(OTHER_LOCALES)("%s keeps every placeholder and tag of each message", (locale) => {
    const own = messages(catalogs[locale] as Catalog);
    for (const [key, source] of english) {
      const value = own.get(key);
      if (value === undefined) continue;
      const [first] = texts(source);
      for (const text of texts(value)) {
        expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(texts(source).at(-1) ?? ""));
        expect(tags(text), `${locale} ${key}`).toEqual(tags(first ?? ""));
        expect(text.trim(), `${locale} ${key}`).not.toBe("");
      }
    }
  });

  it.each(OTHER_LOCALES)("%s gives plural messages the forms its language uses", (locale) => {
    const categories = new Intl.PluralRules(LOCALE_INFO[locale].tag).resolvedOptions().pluralCategories;
    for (const [key, value] of messages(catalogs[locale] as Catalog)) {
      if (!isPlural(value)) continue;
      for (const form of Object.keys(value)) expect(categories, `${locale} ${key} ${form}`).toContain(form);
    }
  });

  it.each(OTHER_LOCALES)("%s keeps buttons and nav links short", (locale) => {
    const own = messages(catalogs[locale] as Catalog);
    const short =
      /^(nav\.(?!home|inEnglish)\w+|plans\.(monthly|yearly|getFreeKey)|home\.hero\.cta\w+|codeTabs\.copy)$/;
    for (const [key, source] of english) {
      const value = own.get(key);
      if (!short.test(key) || typeof value !== "string" || typeof source !== "string") continue;
      expect(value.length, `${locale} ${key}: "${value}"`).toBeLessThanOrEqual(
        Math.max(16, source.length * 2),
      );
    }
  });

  it("keeps the waitlist form's built-in English errors equal to the English catalog", () => {
    expect(ENGLISH_ERRORS).toEqual(en.waitlist.errors);
  });
});

describe("localizePath", () => {
  it("prefixes the pages that exist in every language", () => {
    expect(localizePath("/", "es")).toBe("/es/");
    expect(localizePath("/pricing/", "ar")).toBe("/ar/pricing/");
    expect(localizePath("/#faq", "zh")).toBe("/zh/#faq");
    expect(localizePath("/waitlist/?plan=pro", "tr")).toBe("/tr/waitlist/?plan=pro");
  });

  it("leaves English, English-only pages and other sites alone", () => {
    expect(localizePath("/pricing/", "en")).toBe("/pricing/");
    expect(localizePath("/docs/", "es")).toBe("/docs/");
    expect(localizePath("/playground/", "fr")).toBe("/playground/");
    expect(localizePath("https://github.com/emojisense", "es")).toBe("https://github.com/emojisense");
  });

  it("undoes itself", () => {
    for (const locale of LOCALES) {
      for (const path of ["/", "/pricing/", "/about/", "/waitlist/"]) {
        expect(isLocalizedPath(path)).toBe(true);
        expect(unlocalizePath(localizePath(path, locale))).toBe(path);
      }
    }
  });
});

describe("translator", () => {
  const t = createTranslator(
    {
      hello: "Hello {name}",
      rich: "Read <link>the {what}</link> & more",
      count: { one: "{count} emoji", other: "{count} emoji, many" },
    } as Catalog,
    "en",
  );

  it("fills placeholders and fails loudly when one is missing", () => {
    expect(t.t("hello" as never, { name: "Ana" })).toBe("Hello Ana");
    expect(() => t.t("hello" as never)).toThrow(/name/);
  });

  it("escapes text and values in HTML and renders only known tags", () => {
    const html = t.html(
      "rich" as never,
      { what: "<docs>" },
      { link: (inner) => `<a href="/x">${inner}</a>` },
    );
    expect(html).toBe('Read <a href="/x">the &#60;docs&#62;</a> &#38; more');
    expect(() => t.html("rich" as never, { what: "x" })).toThrow(/link/);
  });

  it("splits a message into parts for templates", () => {
    expect(t.parts("rich" as never, { what: "docs" })).toEqual([
      { text: "Read " },
      { tag: "link", text: "the docs" },
      { text: " & more" },
    ]);
  });

  it("picks the plural form of the locale", () => {
    expect(t.plural("count" as never, 1)).toBe("1 emoji");
    expect(t.plural("count" as never, 1200)).toBe("1,200 emoji, many");
  });
});
