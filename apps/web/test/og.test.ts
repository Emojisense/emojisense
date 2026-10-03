/**
 * Share cards: the text engine (shaping, bidi, fitting) and every card of the site rendered once,
 * with no text cut short. Noto art comes from jsDelivr the first time (node_modules/.cache/og-emoji).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { LOCALES } from "../src/i18n/locales";
import { SHARE_CARD_COPY } from "../src/i18n/share-cards";
import type { CardRenderer } from "../src/og/cards";
import { createNodeCardRenderer } from "../src/og/node";
import { shareCardFor, shareCards } from "../src/og/registry";
import { isEmoji } from "../src/og/text/layout";

const truncated: string[] = [];
let renderer: CardRenderer;

beforeAll(async () => {
  renderer = await createNodeCardRenderer({ onTruncate: (text) => truncated.push(text) });
}, 60_000);

/** PNG width and height from the IHDR chunk. */
const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset);
  return [view.getUint32(16), view.getUint32(20)];
};

describe("emoji detection", () => {
  it.each(["🦖", "❤️", "👍🏽", "🇹🇷", "🏳️‍🌈", "1️⃣"])("%s is drawn as an image", (text) => {
    expect(isEmoji(text)).toBe(true);
  });

  it.each(["a", "©", "1", "™", "→"])("%s stays text", (text) => {
    expect(isEmoji(text)).toBe(false);
  });
});

describe("registry", () => {
  const cards = shareCards();

  it("has one card per page and language, each at its own URL", () => {
    expect(new Set(cards.map((card) => card.image)).size).toBe(cards.length);
    expect(new Set(cards.map((card) => `${card.locale}${card.path}`)).size).toBe(cards.length);
  });

  it.each(["/", "/pricing/", "/integrations/", "/about/", "/waitlist/"])(
    "draws %s in every language",
    (path) => {
      for (const locale of LOCALES)
        expect(shareCardFor(path, locale).locale, `${locale}${path}`).toBe(locale);
    },
  );

  it("gives English-only pages their English card in every language, and unknown pages the home card", () => {
    expect(shareCardFor("/docs/api/", "es").image).toBe(shareCardFor("/docs/api/", "en").image);
    expect(shareCardFor("/404/", "en").image).toBe(shareCardFor("/", "en").image);
  });

  it("has share-card words for every language", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(SHARE_CARD_COPY[locale]))
        expect(value, `${locale}.${key}`).not.toBe("");
    }
  });

  it("writes alt text for every card", () => {
    for (const card of cards) expect(card.alt.length, card.image).toBeGreaterThan(20);
  });
});

describe("rendering", () => {
  it.each(shareCards().map((card) => [card.image, card] as const))(
    "%s is 1200 × 630 with no text cut short",
    async (_image, card) => {
      truncated.length = 0;
      const png = await renderer.png(card.card);
      expect(pngSize(png)).toEqual([1200, 630]);
      expect(truncated).toEqual([]);
    },
  );

  it("draws a query card in a right-to-left script", async () => {
    truncated.length = 0;
    const svg = await renderer.svg({
      kind: "query",
      query: "عيد ميلاد سعيد",
      queryLang: { tag: "ar", dir: "rtl" },
      languageName: "العربية",
      results: ["🎂", "🥳"],
      url: "emojisense.com/playground",
    });
    expect(svg).toContain("<path");
    expect(svg).toContain("data:image/png;base64,");
    expect(truncated).toEqual([]);
  });

  it("ends a query that does not fit in an ellipsis", async () => {
    truncated.length = 0;
    await renderer.svg({
      kind: "query",
      query: "a very long search ".repeat(12).trim(),
      queryLang: { tag: "en", dir: "ltr" },
      languageName: "English",
      results: ["🔎"],
      url: "emojisense.com/playground",
    });
    expect(truncated).toHaveLength(1);
  });
});
