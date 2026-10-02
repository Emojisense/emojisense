import { describe, expect, it } from "vitest";
import { FUNCTION_WORDS, functionWordsFor } from "../src/function-words.js";
import { normalize } from "../src/normalize.js";

/** Words that turn the meaning around. They must keep their full weight in every locale. */
const NEGATIONS: Record<string, string[]> = {
  en: ["not", "no", "dont", "never"],
  zh: ["不", "没", "没有", "别"],
  ru: ["не", "нет", "ни", "ne", "net"],
  id: ["tidak", "tak", "gak", "nggak", "enggak", "ga", "bukan", "jangan", "belum"],
  es: ["no", "ni", "nunca", "nada", "sin"],
  fr: ["ne", "n", "pas", "jamais", "sans", "rien"],
  pt: ["nao", "nem", "nunca", "nada", "sem"],
  ar: ["لا", "ما", "مش", "مو", "ليس", "لم", "لن", "msh", "mish", "la"],
  hi: ["नहीं", "न", "मत", "nahi", "nahin", "mat", "na"],
  bn: ["না", "নয়", "নেই", "নি", "na", "nai"],
  tr: ["degil", "yok", "hic"],
};

describe("function words", () => {
  it("are single normalized tokens without duplicates", () => {
    for (const [locale, words] of Object.entries(FUNCTION_WORDS)) {
      for (const word of words) expect(normalize(word), `${locale} "${word}"`).toBe(word);
      expect(
        words.every((word) => word !== "" && !word.includes(" ")),
        locale,
      ).toBe(true);
      expect(new Set(words).size, locale).toBe(words.length);
    }
  });

  it("never include a negation", () => {
    for (const [locale, negations] of Object.entries(NEGATIONS)) {
      const words = functionWordsFor(locale);
      expect(
        negations.filter((word) => words.has(word)),
        locale,
      ).toEqual([]);
    }
  });

  it("apply the query locale's list plus the English and Turkish ones", () => {
    expect(functionWordsFor("zh").has("我")).toBe(true);
    expect(functionWordsFor("zh").has("the")).toBe(true);
    expect(functionWordsFor("zh").has("bir")).toBe(true);
    // es "son" ("they are") is en "son" 👦: only Spanish queries treat it as a function word.
    expect(functionWordsFor("es").has("son")).toBe(true);
    expect(functionWordsFor("en").has("son")).toBe(false);
    expect(functionWordsFor("ru").has("я")).toBe(true);
    expect(functionWordsFor("en").has("я")).toBe(false);
  });

  it("fall back to the English and Turkish lists for a locale without a list", () => {
    expect(functionWordsFor("ja")).toBe(functionWordsFor("en"));
    expect(functionWordsFor("constructor")).toBe(functionWordsFor("en"));
  });
});
