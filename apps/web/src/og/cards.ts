/**
 * Share-card data and rendering. A card is plain data (strings and emoji); the templates turn it
 * into an SVG of 1200 × 630, and `CardRenderer.png` rasterizes that. The build renders the site's
 * cards, the Worker renders query cards; both go through this file.
 */
import { Resvg } from "@resvg/resvg-wasm";
import { type AssetFetcher, NotoEmoji } from "./emoji";
import { renderArticle } from "./templates/article";
import { renderCode } from "./templates/code";
import { renderPricing } from "./templates/pricing";
import { renderQuery } from "./templates/query";
import { renderShowcase } from "./templates/showcase";
import { FontLibrary, type FontSource } from "./text/fonts";
import type { HarfBuzz } from "./text/harfbuzz";
import { TextEngine, type TextStyle } from "./text/layout";

export interface CardLanguage {
  /** BCP 47 tag ("zh-Hans"), for shaping and line breaking. */
  tag: string;
  dir: "ltr" | "rtl";
}

/** The header of the frame's preview panel: a label on each side. */
export interface PanelHeader {
  start: string;
  end?: string;
}

interface FrameCard {
  lang: CardLanguage;
  headline: string;
  sub: string;
  footnote: string;
  panel: PanelHeader;
}

export interface ShowcaseRow {
  title: string;
  caption: string;
  results: readonly string[];
  /** Typed text (a command, a `:` trigger) rather than a search phrase. */
  mono?: boolean;
}

export interface ShowcaseCard extends FrameCard {
  kind: "showcase";
  rows: readonly ShowcaseRow[];
}

export interface PlanRow {
  emoji: string;
  name: string;
  detail: string;
  price: string;
  per: string;
}

export interface PricingCard extends FrameCard {
  kind: "pricing";
  plans: readonly PlanRow[];
}

export type CodeTone = "ink" | "ink2" | "ink3";

export interface CodeCard extends FrameCard {
  kind: "code";
  /** Lines of tokens; an empty line leaves a gap. */
  code: readonly (readonly (readonly [string, CodeTone])[])[];
  results: readonly string[];
  note: string;
}

export type ArticleArt =
  | { emoji: string }
  | { logo: { path: string; viewBox: string } }
  | { wordmark: string };

export interface ArticleCard {
  kind: "article";
  lang: CardLanguage;
  eyebrow: string;
  title: string;
  description: string;
  chips: readonly string[];
  art: ArticleArt;
  /** Shown at the bottom, e.g. "emojisense.com/docs/api". */
  url: string;
}

export interface QueryCard {
  kind: "query";
  query: string;
  /** The query's own language. */
  queryLang: CardLanguage;
  /** The query language's name, e.g. "Español". */
  languageName: string;
  results: readonly string[];
  url: string;
}

export type Card = ShowcaseCard | PricingCard | CodeCard | ArticleCard | QueryCard;

export interface CardContext {
  text: TextEngine;
  /** The emoji's image as a data: URI, for drawing at `size` px. */
  emoji(emoji: string, size: number): Promise<string | undefined>;
}

/** Scripts with tall marks or joined letters need more room between lines (i18n/scripts.css). */
export function leading(lang: CardLanguage, latin: number): number {
  const base = lang.tag.split("-")[0];
  if (base === "ar" || base === "hi" || base === "bn") return Math.max(latin, 1.3);
  if (base === "zh") return Math.max(latin, 1.2);
  return latin;
}

/** Display type: tight tracking for the Latin face; the script faces keep normal spacing. */
export function displayStyle(lang: CardLanguage, size: number, fill: string): TextStyle {
  return { stack: "display", size, fill, lineHeight: size * leading(lang, 1), tracking: -0.045 * size };
}

export function renderCardSvg(context: CardContext, card: Card): Promise<string> {
  switch (card.kind) {
    case "showcase":
      return renderShowcase(context, card);
    case "pricing":
      return renderPricing(context, card);
    case "code":
      return renderCode(context, card);
    case "article":
      return renderArticle(context, card);
    case "query":
      return renderQuery(context, card);
  }
}

export interface CardRenderer {
  svg(card: Card): Promise<string>;
  png(card: Card): Promise<Uint8Array>;
}

/**
 * Wires the text engine, the fonts and the emoji art. The caller has initialized resvg-wasm
 * (`initWasm`) and instantiated HarfBuzz for its runtime.
 */
export function createCardRenderer(deps: {
  harfbuzz: HarfBuzz;
  fonts: FontSource;
  fetchAsset: AssetFetcher;
  onTruncate?: (text: string) => void;
}): CardRenderer {
  const emoji = new NotoEmoji(deps.fetchAsset);
  const fonts = new FontLibrary(deps.harfbuzz, deps.fonts);
  const context: CardContext = {
    text: new TextEngine(deps.harfbuzz, fonts, emoji, deps.onTruncate),
    emoji: (value, size) => emoji.dataUri(value, size),
  };
  return {
    svg: (card) => renderCardSvg(context, card),
    async png(card) {
      const svg = await renderCardSvg(context, card);
      const resvg = new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } });
      try {
        const image = resvg.render();
        try {
          return image.asPng();
        } finally {
          image.free();
        }
      } finally {
        resvg.free();
      }
    },
  };
}
