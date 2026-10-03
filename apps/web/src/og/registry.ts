/**
 * Every share card of the site: which page shows which card, built from the same data as the
 * page (catalogs, docs navigation, plans, the engine's real results). Build-time only.
 *
 * Each image URL carries a hash of its card, so a social network that caches images by URL fetches
 * the new one after a change. Bump CARD_VERSION when a template draws differently.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isListedPlan, LISTED_PLAN_IDS, PLAN_IDS, PLANS, type PlanId } from "@emojisense/platform";
import { type AliasEngine, createEngine, type Pack } from "emojisense";
import { PLAN_COPY } from "../components/pricing/plan-copy";
import { PACK_VERSION, SITE_URL } from "../config";
import { LEGAL_PAGES, LEGAL_UPDATED } from "../content/legal";
import { translatorFor } from "../i18n/catalogs";
import { heroExamples } from "../i18n/examples";
import { formatCountIn, formatUsdIn } from "../i18n/format";
import { DEFAULT_LOCALE, LOCALE_INFO, LOCALES, LOCALIZED_PAGES, type Locale } from "../i18n/locales";
import { SHARE_CARD_COPY } from "../i18n/share-cards";
import { DOCS_SECTIONS, type DocsPage, type DocsStatus } from "../lib/docs-nav";
import { INTEGRATIONS } from "../lib/integrations";
import { LOGO_VIEWBOX, LOGOS } from "../lib/logos";
import type {
  ArticleArt,
  ArticleCard,
  Card,
  CardLanguage,
  CodeCard,
  PricingCard,
  ShowcaseCard,
} from "./cards";

const CARD_VERSION = 1;

export interface ShareCardEntry {
  /** English path of the page ("/pricing/"). */
  path: string;
  locale: Locale;
  /** Site path of the PNG ("/og/es/pricing-1a2b3c4d.png"). */
  image: string;
  alt: string;
  card: Card;
}

const languageOf = (locale: Locale): CardLanguage => ({
  tag: LOCALE_INFO[locale].tag,
  dir: LOCALE_INFO[locale].dir,
});
const EN: CardLanguage = languageOf("en");
const HOST = SITE_URL.replace(/^https?:\/\//, "");

// ---------------------------------------------------------------------------------------------
// Real search results
// ---------------------------------------------------------------------------------------------

const PACK_DIR = join(process.cwd(), "../../packages/data/dist/packs", PACK_VERSION);
let engine: AliasEngine | null | undefined;

/** Every pack in one engine, built once per build; null without packs (a build without data). */
function packEngine(): AliasEngine | null {
  if (engine === undefined) {
    const packs = LOCALES.flatMap((locale) => [`pack.${locale}.json`, `pack.${locale}.ext.json`])
      .map((name) => join(PACK_DIR, name))
      .filter((path) => existsSync(path))
      .map((path) => JSON.parse(readFileSync(path, "utf8")) as Pack);
    engine = packs.length > 0 ? createEngine(packs) : null;
    if (!engine)
      console.warn(`share cards: no packs in ${PACK_DIR}; cards show no results (pnpm data:build)`);
  }
  return engine;
}

function top(query: string, locale: string, limit = 3): string[] {
  return (
    packEngine()
      ?.search(query, { locale, limit, prefix: false })
      .results.map((result) => result.emoji) ?? []
  );
}

// ---------------------------------------------------------------------------------------------
// Landing cards
// ---------------------------------------------------------------------------------------------

/** The first sentence of a catalog paragraph, in its own language's sentence rules. */
function firstSentence(text: string, locale: Locale): string {
  const [first] = new Intl.Segmenter(LOCALE_INFO[locale].tag, { granularity: "sentence" }).segment(text);
  return (first?.segment ?? text).trim();
}

function homeCard(locale: Locale): ShowcaseCard {
  const { t } = translatorFor(locale);
  const copy = SHARE_CARD_COPY[locale];
  const languageName = new Intl.DisplayNames([LOCALE_INFO[locale].tag], { type: "language" });
  const examples =
    locale === "en"
      ? [
          { query: "jurassic park", caption: t("hero.kinds.film"), lang: "en" },
          { query: "break a leg", caption: t("hero.kinds.idiom"), lang: "en" },
          { query: "heartbroken", caption: t("hero.kinds.feeling"), lang: "en" },
          { query: "feliz cumpleaños", caption: languageName.of("es") ?? "es", lang: "es" },
          { query: "kolay gelsin", caption: languageName.of("tr") ?? "tr", lang: "tr" },
        ]
      : heroExamples(locale)
          .filter((example) => example.query !== "macintosh" && example.query !== "hallowelen")
          .map((example) => ({
            query: example.query,
            caption: t(`hero.kinds.${example.kind}`),
            lang: example.lang ?? locale,
          }));
  return {
    kind: "showcase",
    lang: languageOf(locale),
    headline: copy.homeHeadline,
    sub: firstSentence(t("home.hero.lead", { languages: LOCALES.length }), locale),
    footnote: copy.homeFootnote,
    panel: { start: copy.whatPeopleType, end: copy.topResults },
    rows: examples.slice(0, 5).map((example) => ({
      title: example.query,
      caption: example.caption,
      results: top(example.query, example.lang),
    })),
  };
}

function pricingCard(locale: Locale): PricingCard {
  const { t } = translatorFor(locale);
  const copy = SHARE_CARD_COPY[locale];
  const tag = LOCALE_INFO[locale].tag;
  return {
    kind: "pricing",
    lang: languageOf(locale),
    headline: stripTags(t("pricing.hero.title")),
    sub: copy.pricingSub,
    footnote: t("pricing.hero.assurances.failure"),
    panel: { start: copy.plans, end: copy.perMonth },
    plans: LISTED_PLAN_IDS.map((id) => {
      const plan = PLANS[id];
      const calls = formatCountIn(
        locale === "en" ? "en" : tag,
        plan.limits.semantic_calls,
        t("plans.unlimited"),
      );
      return {
        emoji: PLAN_COPY[id].emoji,
        name: plan.name,
        detail: `${calls} ${t("plans.features.semanticCalls.unit")}`,
        price: formatUsdIn(locale === "en" ? "en" : tag, plan.priceUsdMonthly),
        per: t("plans.perMonth"),
      };
    }),
  };
}

/** The queries the live stage on /integrations/ plays, each in the tool it plays in. */
const STAGE_ROWS = [
  { tool: "React", typed: "jurassic park", query: "jurassic park" },
  { tool: "Tiptap", typed: ":ship it", query: "ship it" },
  { tool: "Discourse", typed: ":mind blown", query: "mind blown" },
  { tool: "Raycast", typed: "celebrate", query: "celebrate" },
  { tool: "MCP", typed: "launch day", query: "launch day" },
];

function integrationsCard(locale: Locale): ShowcaseCard {
  const { t } = translatorFor(locale);
  const copy = SHARE_CARD_COPY[locale];
  return {
    kind: "showcase",
    lang: languageOf(locale),
    headline: t("integrations.page.title"),
    sub: firstSentence(t("integrations.page.lead", { languages: LOCALES.length }), locale),
    footnote: copy.integrationsFootnote
      .replace("{integrations}", String(INTEGRATIONS.length))
      .replace("{languages}", String(LOCALES.length)),
    panel: { start: copy.wherePeopleType, end: copy.topResults },
    rows: STAGE_ROWS.map((row) => ({
      title: row.typed,
      caption: row.tool,
      results: top(row.query, "en"),
      mono: true,
    })),
  };
}

function docsHubCard(): CodeCard {
  const query = "ship it";
  return {
    kind: "code",
    lang: EN,
    headline: "Add emoji search in minutes.",
    sub: "React, web component, Swift, editors, MCP and a plain HTTP API.",
    footnote: "Docs · Quickstart · HTTP API · Self-host",
    panel: { start: "quickstart.ts" },
    code: [
      [
        ["$ ", "ink3"],
        ["npm install emojisense", "ink"],
      ],
      [],
      [
        ["import ", "ink3"],
        ["{ createEngine }", "ink"],
        [" from ", "ink3"],
        ['"emojisense"', "ink2"],
      ],
      [
        ["const ", "ink3"],
        ["engine", "ink"],
        [" = ", "ink3"],
        ["createEngine", "ink"],
        ["(packs);", "ink3"],
      ],
      [],
      [
        ["engine", "ink"],
        [".", "ink3"],
        ["search", "ink"],
        ["(", "ink3"],
        [`"${query}"`, "ink2"],
        [")", "ink3"],
      ],
    ],
    results: top(query, "en"),
    note: "on-device · no server needed",
  };
}

// ---------------------------------------------------------------------------------------------
// Article cards
// ---------------------------------------------------------------------------------------------

const DOCS_EMOJI: Record<string, string> = {
  "/docs/quickstart/": "⚡",
  "/docs/concepts/": "🧠",
  "/docs/guides/search/": "🔎",
  "/docs/guides/reactions/": "💬",
  "/docs/guides/photo-to-emoji/": "📸",
  "/docs/guides/custom-emoji/": "🎨",
  "/docs/guides/emoji-sets/": "🗂️",
  "/docs/guides/analytics/": "📊",
  "/docs/guides/teams/": "👥",
  "/docs/guides/tenants/": "🏘️",
  "/docs/guides/webhooks/": "🪝",
  "/docs/api/": "🌐",
  "/docs/pack-format/": "📦",
  "/docs/keys-and-limits/": "🔑",
  "/docs/privacy/": "🔒",
  "/docs/changelog/": "🗞️",
};

const STATUS_LABELS: Record<DocsStatus, string> = {
  planned: "Planned",
  next: "Coming in this release",
  experimental: "Experimental",
  soon: "Coming soon",
};

/** "Solo and Pro plans" for a feature that starts on Solo; plans not on sale are left out. */
function plansFrom(id: PlanId): string {
  const names = PLAN_IDS.slice(PLAN_IDS.indexOf(id))
    .filter(isListedPlan)
    .map((plan) => PLANS[plan].name);
  if (names.length === 1) return `${names[0]} plan`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} plans`;
}

function docsArt(page: DocsPage): ArticleArt {
  const integration = INTEGRATIONS.find((item) => item.docs === page.href);
  const logoName = integration?.logos[0];
  if (logoName) {
    const logo = LOGOS[logoName];
    return logo.kind === "icon"
      ? { logo: { path: logo.path, viewBox: logo.viewBox ?? LOGO_VIEWBOX } }
      : { wordmark: logo.label };
  }
  if (integration?.mark) return { wordmark: integration.mark };
  return { emoji: DOCS_EMOJI[page.href] ?? "📖" };
}

const urlOf = (path: string) => `${HOST}${path.replace(/\/$/, "")}`;

function docsCards(): { path: string; card: ArticleCard }[] {
  return DOCS_SECTIONS.flatMap((section) =>
    section.pages
      .filter((page) => page.href !== "/docs/")
      .map((page) => {
        const chips = [
          ...(page.status ? [STATUS_LABELS[page.status]] : []),
          ...(page.plan && page.status !== "soon" ? [plansFrom(page.plan)] : []),
        ];
        const card: ArticleCard = {
          kind: "article",
          lang: EN,
          eyebrow: `Docs · ${section.title}`,
          title: page.title,
          description: page.description,
          chips,
          art: docsArt(page),
          url: urlOf(page.href),
        };
        return { path: page.href, card };
      }),
  );
}

function legalCards(): { path: string; card: ArticleCard }[] {
  const updated = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${LEGAL_UPDATED}T00:00:00Z`),
  );
  const article = (path: string, title: string, description: string, emoji: string): ArticleCard => ({
    kind: "article",
    lang: EN,
    eyebrow: "Legal",
    title,
    description,
    chips: [`Updated ${updated}`],
    art: { emoji },
    url: urlOf(path),
  });
  return [
    {
      path: "/legal/",
      card: article(
        "/legal/",
        "The fine print, in plain words.",
        "The Emojisense terms, privacy policy, acceptable use policy and subprocessors, in plain language.",
        "⚖️",
      ),
    },
    ...LEGAL_PAGES.map((page) => ({
      path: page.href,
      card: article(page.href, page.title, page.description, page.emoji),
    })),
  ];
}

function pageCards(): { path: string; locale: Locale; card: ArticleCard }[] {
  const localized = LOCALES.flatMap((locale) => {
    const { t } = translatorFor(locale);
    const lang = languageOf(locale);
    const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
    return [
      {
        path: "/about/",
        locale,
        card: {
          kind: "article" as const,
          lang,
          eyebrow: t("about.hero.eyebrow"),
          title: t("about.hero.title"),
          description: t("meta.about.description"),
          chips: [],
          art: { emoji: "🦖" },
          url: urlOf(`${prefix}/about/`),
        },
      },
      {
        path: "/waitlist/",
        locale,
        card: {
          kind: "article" as const,
          lang,
          eyebrow: "Solo · Pro",
          title: stripTags(t("waitlist.hero.title")),
          description: t("meta.waitlist.description"),
          chips: [],
          art: { emoji: "🎟️" },
          url: urlOf(`${prefix}/waitlist/`),
        },
      },
    ];
  });
  const english = (path: string, eyebrow: string, title: string, description: string, emoji: string) => ({
    path,
    locale: DEFAULT_LOCALE,
    card: {
      kind: "article" as const,
      lang: EN,
      eyebrow,
      title,
      description,
      chips: [],
      art: { emoji },
      url: urlOf(path),
    },
  });
  return [
    ...localized,
    english(
      "/playground/",
      "Playground",
      "Everything emoji, live.",
      "Try every part of Emojisense live: on-device and edge search in 11 languages, reaction suggestions and photo to emoji.",
      "🧪",
    ),
    english(
      "/changelog/",
      "Changelog",
      "What's new.",
      "What is new in Emojisense: the engine, the data packs, the API and the dashboard.",
      "🗞️",
    ),
  ];
}

/** A catalog string without its `<tag>` markers. */
function stripTags(text: string): string {
  return text.replace(/<\/?\w+>/g, "");
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

function slugOf(path: string): string {
  return path === "/" ? "home" : path.replace(/^\/|\/$/g, "");
}

/** Title and description as one text, with a full stop in the page's script between them. */
function sentences(title: string, description: string, locale: Locale): string {
  if (/[.!?。！？।]$/u.test(title)) return `${title} ${description}`;
  const stop = locale === "zh" ? "。" : locale === "hi" || locale === "bn" ? "।" : ".";
  return `${title}${stop} ${description}`;
}

function altOf(card: Card, locale: Locale): string {
  const { t } = translatorFor(locale);
  switch (card.kind) {
    case "article":
      return sentences(card.title, card.description, locale);
    case "pricing":
      return t("meta.shareAlt.pricing");
    case "code":
      return "Emojisense docs: add emoji search in minutes, with a short code sample and its results.";
    case "showcase":
      if (card.rows[0]?.mono) return t("meta.shareAlt.integrations");
      if (locale === "en") return t("meta.shareAlt.home");
      // The catalog's text names the English card's searches; list this card's own.
      return `Emojisense: ${sentences(card.headline, card.rows.map((row) => `“${row.title}” ${row.results.join(" ")}`).join(", "), locale)}`;
    case "query":
      return `Emoji search for “${card.query}”: ${card.results.join(" ")}`;
  }
}

function entry(path: string, locale: Locale, card: Card): ShareCardEntry {
  const hash = createHash("sha256")
    .update(JSON.stringify([CARD_VERSION, card]))
    .digest("hex")
    .slice(0, 10);
  return { path, locale, image: `/og/${locale}/${slugOf(path)}-${hash}.png`, alt: altOf(card, locale), card };
}

let registry: ShareCardEntry[] | undefined;

export function shareCards(): ShareCardEntry[] {
  registry ??= [
    ...LOCALES.flatMap((locale) => [
      entry("/", locale, homeCard(locale)),
      entry("/pricing/", locale, pricingCard(locale)),
      entry("/integrations/", locale, integrationsCard(locale)),
    ]),
    ...pageCards().map((page) => entry(page.path, page.locale, page.card)),
    entry("/docs/", DEFAULT_LOCALE, docsHubCard()),
    ...docsCards().map((page) => entry(page.path, DEFAULT_LOCALE, page.card)),
    ...legalCards().map((page) => entry(page.path, DEFAULT_LOCALE, page.card)),
  ];
  return registry;
}

/** The card of a page; a page without one (404) shares its language's home card. */
export function shareCardFor(path: string, locale: Locale): ShareCardEntry {
  const cards = shareCards();
  const pageLocale = (LOCALIZED_PAGES as readonly string[]).includes(path) ? locale : DEFAULT_LOCALE;
  return (
    cards.find((card) => card.path === path && card.locale === pageLocale) ??
    (cards.find((card) => card.path === "/" && card.locale === locale) as ShareCardEntry)
  );
}
