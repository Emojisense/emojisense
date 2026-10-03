/**
 * Build smoke test: run `astro build` once into a temporary directory, then check the emitted
 * pages the way a crawler or a visitor without JavaScript would see them.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyticsKeepDays,
  LISTED_PLAN_IDS,
  METRICS,
  PLANS,
  type PlanId,
  WAITLIST_KEEP_MONTHS,
  waitlistReturnUrl,
} from "@emojisense/platform";
import * as core from "emojisense";
import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCALE_INFO, LOCALES } from "../src/i18n/locales";
import { DOCS_PAGES } from "../src/lib/docs-nav";
import { formatCount, formatDays } from "../src/lib/format";

const root = fileURLToPath(new URL("..", import.meta.url));
const SITE = "https://site.test";
const DASHBOARD = "https://dashboard.test";
const API = "https://api.test";

const LEGAL = ["/legal/terms/", "/legal/privacy/", "/legal/acceptable-use/", "/legal/subprocessors/"];

const PAGES = [
  "/",
  "/pricing/",
  "/integrations/",
  "/waitlist/",
  "/about/",
  "/changelog/",
  "/legal/",
  ...LEGAL,
  "/docs/",
  "/docs/api/",
  "/docs/pack-format/",
  "/docs/self-host/",
  "/docs/privacy/",
];

/** Made by scripts/brand-assets.mjs and committed under public/. */
const BRAND_ASSETS = [
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/site.webmanifest",
  "/og/home.png",
  "/og/pricing.png",
  "/og/docs.png",
  "/og/integrations.png",
];

let outDir = "";
const window = new Window();

function file(path: string): string {
  const relative = path.endsWith("/") ? `${path}index.html` : path;
  return join(outDir, relative);
}

/** Only the document head (with the html element): light enough to parse for every language. */
function head(path: string): Document {
  const html = readFileSync(file(path), "utf8");
  const end = html.indexOf("</head>") + "</head>".length;
  const parser = new window.DOMParser();
  return parser.parseFromString(
    `${html.slice(0, end)}<body></body></html>`,
    "text/html",
  ) as unknown as Document;
}

/**
 * Each page is parsed once. The window keeps every document it parses (about 20 MB for a landing
 * page), and the tests that walk every page in eleven languages would otherwise parse each one
 * several times and run out of memory. The tests only read the documents.
 */
const parsedPages = new Map<string, Document>();

function page(path: string): Document {
  let doc = parsedPages.get(path);
  if (!doc) {
    const parser = new window.DOMParser();
    doc = parser.parseFromString(readFileSync(file(path), "utf8"), "text/html") as unknown as Document;
    parsedPages.set(path, doc);
  }
  return doc;
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "emojisense-web-"));
  const astro = join(dirname(createRequire(import.meta.url).resolve("astro/package.json")), "bin/astro.mjs");
  execFileSync(process.execPath, [astro, "build", "--outDir", outDir], {
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      PUBLIC_SITE_URL: SITE,
      PUBLIC_DASHBOARD_URL: DASHBOARD,
      PUBLIC_API_URL: API,
      PUBLIC_PACK_VERSION: "0.1.0",
    },
  });
});

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
  window.close();
});

describe("emitted files", () => {
  it.each([...PAGES, ...BRAND_ASSETS, "/404.html", "/sitemap.xml", "/robots.txt", "/_headers"])(
    "emits %s",
    (path) => {
      expect(existsSync(file(path))).toBe(true);
    },
  );

  it("lists every page in the sitemap, except the old waitlist page", () => {
    const sitemap = readFileSync(file("/sitemap.xml"), "utf8");
    for (const path of PAGES.filter((p) => p !== "/waitlist/")) {
      expect(sitemap).toContain(`<loc>${SITE}${path}</loc>`);
    }
    expect(sitemap).not.toContain("/waitlist/");
    expect(readFileSync(file("/robots.txt"), "utf8")).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

describe.each(PAGES)("page %s", (path) => {
  it("has one h1, a title, a description and a canonical URL", () => {
    const doc = page(path);
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.title.length).toBeGreaterThan(5);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")?.length).toBeGreaterThan(
      30,
    );
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`${SITE}${path}`);
  });

  it("loads no third-party scripts, styles or fonts", () => {
    const doc = page(path);
    const urls = [
      ...Array.from(doc.querySelectorAll("script[src]"), (el) => el.getAttribute("src") ?? ""),
      ...Array.from(
        doc.querySelectorAll("link[href]:not([rel=canonical]):not([rel=alternate])"),
        (el) => el.getAttribute("href") ?? "",
      ),
    ];
    // Our own API is first party: a page may preconnect to it or preload a data pack from it.
    const isOwnApiHint = (url: string) =>
      url.startsWith(`${API}/`) || url === API
        ? doc.querySelector(`link[href="${url}"]`)?.matches("[rel=preconnect], [rel=preload]") === true
        : false;
    for (const url of urls) if (!isOwnApiHint(url)) expect(url).toMatch(/^\//);
  });
});

describe("landing page", () => {
  it("renders the live hero search and the use-case demos as islands", () => {
    const doc = page("/");
    expect(doc.querySelector('astro-island[component-url*="HeroSearch"]')).not.toBeNull();
    expect(doc.querySelector('astro-island[component-url*="UseCases"]')).not.toBeNull();
  });

  it("has every main section", () => {
    const doc = page("/");
    for (const id of [
      "use-cases",
      "features",
      "edge",
      "network",
      "integrations",
      "developers",
      "pricing",
      "faq",
    ]) {
      expect(doc.getElementById(id), id).not.toBeNull();
    }
    const text = doc.body.textContent ?? "";
    for (const name of ["React", "Tiptap", "Lexical", "Swift", "Chrome", "Raycast", "MCP"]) {
      expect(text).toContain(name);
    }
    expect(doc.querySelectorAll("#faq details").length).toBeGreaterThanOrEqual(5);
  });

  it("explains every paid feature from the plans", () => {
    const text = page("/").getElementById("features")?.textContent ?? "";
    for (const feature of [
      "custom emoji",
      "Hosted emoji sets",
      "Analytics",
      "Teams and environments",
      "Tenants",
    ]) {
      expect(text).toContain(feature);
    }
  });

  it("states the edge facts and the over-limit switch", () => {
    const doc = page("/");
    expect(doc.getElementById("edge")?.textContent).toContain("300+");
    expect(doc.querySelectorAll("#edge .bubble").length).toBeGreaterThanOrEqual(8);
    expect(doc.querySelectorAll("#edge [data-reel]")).toHaveLength(3);
    expect(doc.querySelectorAll("#edge .reel-city")).toHaveLength(
      3 * doc.querySelectorAll("#edge .bubble").length,
    );
    expect(doc.getElementById("edge-title")?.querySelector("[data-title-still]")?.textContent).toBe(
      "Fast in Lagos, Lima and Lahore.",
    );
    expect(doc.querySelector('#network input[role="switch"]')).not.toBeNull();
    expect(doc.querySelectorAll("#network .rung")).toHaveLength(4);
  });
});

describe("pricing page", () => {
  const doc = () => page("/pricing/");
  // Photo classifications and custom emoji are metered but not sold yet: the page lists them as "Soon".
  const UNSOLD_METRICS: readonly string[] = ["image_classifications", "custom_emoji"];
  const SOLD_METRICS = METRICS.filter((metric) => !UNSOLD_METRICS.includes(metric));

  it.each(LISTED_PLAN_IDS)("shows the %s price from PLANS", (id) => {
    const card = doc().querySelector(`[data-plan="${id}"]`);
    expect(card).not.toBeNull();
    expect(Number(card?.getAttribute("data-price-monthly"))).toBe(PLANS[id].priceUsdMonthly);
    expect(card?.querySelector(".price .amount")?.textContent).toBe(`$${PLANS[id].priceUsdMonthly}`);
  });

  it("shows the Solo yearly price", () => {
    const solo = doc().querySelector('[data-plan="solo"]');
    expect(PLANS.solo.priceUsdYearly).toBe(48);
    expect(Number(solo?.querySelector("[data-price-yearly]")?.getAttribute("data-price-yearly"))).toBe(48);
    expect(solo?.textContent).toContain("$48 a year");
  });

  // Cards read "Everything in <previous plan>, plus", so each lists the limits it includes. The
  // comparison table below lists every feature of every plan, included or not.
  it.each(LISTED_PLAN_IDS)("shows every %s limit from PLANS", (id) => {
    const card = doc().querySelector(`[data-plan="${id}"]`);
    for (const key of [...UNSOLD_METRICS, "emoji_import"]) {
      expect(card?.querySelector(`[data-feature="${key}"]`), key).toBeNull();
    }
    for (const metric of SOLD_METRICS) {
      const limit = PLANS[id].limits[metric];
      const row = card?.querySelector(`[data-feature="${metric}"]`);
      if (limit === 0) {
        expect(row, metric).toBeNull();
        continue;
      }
      expect(row, metric).not.toBeNull();
      expect(Number(row?.getAttribute("data-raw")), metric).toBe(limit);
    }
    const calls = card?.querySelector('[data-feature="semantic_calls"] strong')?.textContent?.trim();
    expect(calls).toBe(formatCount(PLANS[id].limits.semantic_calls));
  });

  it("builds the comparison table with a header per plan and a cell per plan in every row", () => {
    const table = doc().querySelector("#compare table");
    expect(table?.querySelector("caption")).not.toBeNull();
    const columns = Array.from(table?.querySelectorAll('thead th[scope="col"]') ?? [], (th) =>
      th.getAttribute("data-col"),
    );
    expect(columns).toEqual([...LISTED_PLAN_IDS]);
    const rows = table?.querySelectorAll("tbody tr[data-feature]") ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const row of Array.from(rows)) {
      expect(row.querySelector('th[scope="row"]')).not.toBeNull();
      expect(row.querySelectorAll("td[data-col]")).toHaveLength(LISTED_PLAN_IDS.length);
    }
  });

  it("hides Scale and lists photo to emoji, custom emoji, import and tenants as coming soon", () => {
    const pricing = doc();
    expect(pricing.querySelector('[data-plan="scale"]')).toBeNull();
    expect(pricing.querySelector('[data-col="scale"]')).toBeNull();
    expect(pricing.getElementById("compare")?.textContent).not.toContain("Scale");
    for (const key of [
      "custom_emoji",
      "emoji_import",
      "tenants",
      "webhooks",
      "priority_support",
      "community_support",
    ]) {
      expect(pricing.querySelector(`tr[data-feature="${key}"]`), key).toBeNull();
    }
    const soon = Array.from(pricing.querySelectorAll("#compare table tr[data-soon]"), (row) => ({
      key: row.getAttribute("data-soon"),
      tags: Array.from(row.querySelectorAll("td[data-col]"), (td) => td.textContent?.trim()),
    }));
    const tags = LISTED_PLAN_IDS.map(() => "Soon");
    expect(soon).toEqual([
      { key: "image_classifications", tags },
      { key: "custom_emoji", tags },
      { key: "emoji_import", tags },
      { key: "tenants", tags },
    ]);
  });

  it.each(LISTED_PLAN_IDS)("lists every %s limit from PLANS in the comparison table", (id) => {
    const plan = PLANS[id];
    const cell = (key: string) =>
      doc().querySelector(`#compare table tr[data-feature="${key}"] td[data-col="${id}"]`);
    const numbers: [string, number, (value: number) => string][] = [
      ...SOLD_METRICS.map((metric): [string, number, (value: number) => string] => [
        metric,
        plan.limits[metric],
        formatCount,
      ]),
      ["analytics", plan.analyticsRetentionDays, formatDays],
      ["apps", plan.maxApps, formatCount],
    ];
    for (const [key, value, format] of numbers) {
      const td = cell(key);
      expect(td, key).not.toBeNull();
      if (Number.isFinite(value)) expect(Number(td?.getAttribute("data-raw")), key).toBe(value);
      expect(td?.textContent?.trim(), key).toBe(value === 0 ? "Not included" : format(value));
    }
    const flags: [string, boolean][] = [
      ["hosted_sets", plan.hostedEmojiSets],
      ["team", plan.teamMembers],
    ];
    for (const [key, included] of flags) {
      expect(cell(key)?.textContent?.trim(), key).toBe(included ? "Included" : "Not included");
    }
  });

  it.each(LISTED_PLAN_IDS)("sends the %s card to the dashboard, a paid plan to its Billing page", (id) => {
    const href = doc().querySelector(`[data-plan="${id}"] a.btn`)?.getAttribute("href");
    expect(href).toBe(
      PLANS[id].priceUsdMonthly === 0 ? `${DASHBOARD}/` : `${DASHBOARD}/billing?plan=${id}&interval=month`,
    );
  });

  it("has a yearly checkout link for Solo, shown by the yearly switch", () => {
    const yearly = doc().querySelector('[data-plan="solo"] a.cta-yearly');
    expect(yearly?.getAttribute("href")).toBe(`${DASHBOARD}/billing?plan=solo&interval=year`);
    expect(doc().querySelector('[data-plan="pro"] a.cta-yearly')).toBeNull();
  });

  it("no longer links paid plans to the waitlist", () => {
    const links = Array.from(doc().querySelectorAll("a"), (a) => a.getAttribute("href") ?? "");
    expect(links.filter((href) => href.includes("waitlist"))).toEqual([]);
    expect(doc().body.textContent).not.toMatch(/not on sale|join the waitlist/i);
  });

  it("explains the over-limit fallback", () => {
    const text = doc().getElementById("limits")?.textContent ?? "";
    expect(text).toContain("never breaks");
    expect(text).toContain("cached");
  });
});

describe("waitlist page", () => {
  it("renders the form without JavaScript, posting to the dashboard", () => {
    const form = page("/waitlist/").querySelector('form[data-testid="waitlist-form"]');
    expect(form).not.toBeNull();
    expect(form?.getAttribute("action")).toBe(`${DASHBOARD}/api/waitlist`);
    expect(form?.getAttribute("method")).toBe("post");
    const email = form?.querySelector('input[name="email"]');
    expect(email?.getAttribute("type")).toBe("email");
    expect(email?.hasAttribute("required")).toBe(true);
    const plans = Array.from(form?.querySelectorAll('select[name="plan"] option') ?? [], (o) =>
      o.getAttribute("value"),
    );
    expect(plans).toEqual(["solo", "pro"]);
    expect(form?.querySelector('button[type="submit"]')).not.toBeNull();
  });

  // The dashboard answers a form post without JavaScript with a 303 to waitlistReturnUrl(); the
  // fragment must name a message that CSS shows as the :target.
  it.each([
    ["ok", "You are on the list"],
    ["error", "We could not add you"],
  ] as const)("shows the %s result of a form post without JavaScript", (status, title) => {
    const html = readFileSync(file("/waitlist/"), "utf8");
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? "";
    const anchor = new URL(waitlistReturnUrl(SITE, status)).hash.slice(1);
    const message = new RegExp(`<div[^>]*id="${anchor}"[^>]*>([\\s\\S]*?)</div>`).exec(noscript);
    expect(message?.[1]).toContain(title);
    const css = Array.from(html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g), ([, href]) =>
      readFileSync(file(href ?? ""), "utf8"),
    ).join("\n");
    expect(css).toMatch(/\.wl-result(\[[^\]]+\])?:target(\[[^\]]+\])?\s*\{\s*display:\s*block/);
  });
});

describe("integrations", () => {
  it("shows brands on the landing page, each linking to its card, without install commands", () => {
    const hub = page("/").getElementById("integrations");
    expect(hub?.querySelectorAll("code, .copycmd")).toHaveLength(0);
    const links = Array.from(hub?.querySelectorAll("a.hub-tile") ?? [], (a) => a.getAttribute("href") ?? "");
    expect(links.length).toBeGreaterThanOrEqual(16);
    const cards = page("/integrations/");
    for (const link of links) {
      expect(link, link).toMatch(/^\/integrations\/#[a-z0-9-]+$/);
      expect(cards.getElementById(link.split("#")[1] ?? "")?.classList.contains("cat-card"), link).toBe(true);
    }
    expect(hub?.querySelector('a.btn[href="/integrations/"]')).not.toBeNull();
  });

  it("puts the live stage, a card per integration and a filter on /integrations/", () => {
    const doc = page("/integrations/");
    expect(doc.querySelector('astro-island[component-url*="IntegrationStage"]')).not.toBeNull();
    const cards = doc.querySelectorAll(".cat-card");
    expect(cards.length).toBe(16);
    expect(doc.querySelectorAll('.cat-filter input[type="radio"]')).toHaveLength(5);
    // Only what can be installed today shows a command; the rest says where it will ship.
    for (const card of Array.from(cards)) {
      const available = card.querySelector('.cat-badge[data-status="available"]') !== null;
      expect(card.querySelector(".cat-install astro-island") !== null, card.id).toBe(available);
      expect(card.querySelector(".cat-soon") !== null, card.id).toBe(!available);
      expect(card.querySelector("a.cat-docs")?.getAttribute("href"), card.id).toMatch(/^\/docs\//);
    }
    expect(doc.querySelector('.nav-main a[href="/integrations/"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("keeps ids unique on /integrations/", () => {
    const ids = Array.from(page("/integrations/").querySelectorAll("[id]"), (el) => el.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("languages", () => {
  const TRANSLATED = ["/", "/pricing/", "/integrations/", "/waitlist/", "/about/"];
  const OTHER = LOCALES.filter((locale) => locale !== "en");
  const localized = (path: string, locale: string) => (locale === "en" ? path : `/${locale}${path}`);
  const everyVersion = OTHER.flatMap((locale) => TRANSLATED.map((path) => [locale, path] as const));

  it.each(everyVersion)("builds /%s%s with its own language, title and canonical URL", (locale, path) => {
    const url = localized(path, locale);
    expect(existsSync(file(url)), url).toBe(true);
    const doc = head(url);
    expect(doc.documentElement.getAttribute("lang")).toBe(LOCALE_INFO[locale].tag);
    expect(doc.documentElement.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(readFileSync(file(url), "utf8").match(/<h1[\s>]/g)).toHaveLength(1);
    expect(doc.title).not.toBe(head(path).title);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`${SITE}${url}`);
    expect(doc.querySelector('meta[property="og:locale"]')?.getAttribute("content")).toBe(
      LOCALE_INFO[locale].og,
    );
  });

  it.each(TRANSLATED)("lists every language of %s as an hreflang alternate, plus x-default", (path) => {
    const expected = [
      ...LOCALES.map((locale) => [LOCALE_INFO[locale].tag, `${SITE}${localized(path, locale)}`]),
      ["x-default", `${SITE}${path}`],
    ].sort();
    for (const locale of LOCALES) {
      const doc = head(localized(path, locale));
      const alternates = Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'), (link) => [
        link.getAttribute("hreflang"),
        link.getAttribute("href"),
      ]).sort();
      expect(alternates, `${locale} ${path}`).toEqual(expected);
    }
  });

  it("gives English-only pages no language alternates", () => {
    for (const path of ["/docs/", "/playground/", "/changelog/", "/legal/privacy/"]) {
      expect(head(path).querySelectorAll('link[rel="alternate"][hreflang]'), path).toHaveLength(0);
    }
  });

  it("writes Arabic right to left", () => {
    for (const path of TRANSLATED) {
      expect(head(localized(path, "ar")).documentElement.getAttribute("dir")).toBe("rtl");
    }
  });

  it("lists every language version in the sitemap, with its alternates, but not the waitlist", () => {
    const sitemap = readFileSync(file("/sitemap.xml"), "utf8");
    for (const [locale, path] of everyVersion.filter(([, path]) => path !== "/waitlist/")) {
      expect(sitemap).toContain(`<loc>${SITE}${localized(path, locale)}</loc>`);
    }
    expect(sitemap).toContain(`hreflang="ar" href="${SITE}/ar/pricing/"`);
    expect(sitemap).not.toContain(`${SITE}/es/docs/`);
    expect(sitemap).not.toContain("/waitlist/");
  });

  it("links every language from the footer, named in its own language, without flags", () => {
    const doc = page("/es/pricing/");
    const links = Array.from(doc.querySelectorAll("footer .lang-list a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      LOCALES.map((locale) => localized("/pricing/", locale)),
    );
    expect(links.map((a) => a.textContent?.trim())).toEqual(
      LOCALES.map((locale) => LOCALE_INFO[locale].name),
    );
    expect(links.find((a) => a.getAttribute("aria-current"))?.getAttribute("hreflang")).toBe("es");
    for (const a of links) expect(a.textContent).not.toMatch(/\p{Regional_Indicator}/u);
  });

  it("keeps translated pages' links on their language and marks English-only links", () => {
    const doc = page("/fr/");
    const nav = Array.from(doc.querySelectorAll(".nav-main a"), (a) => a.getAttribute("href"));
    expect(nav).toContain("/fr/pricing/");
    expect(nav).toContain("/fr/integrations/");
    expect(nav).toContain("/docs/");
    expect(doc.querySelector('.nav-main a[href="/docs/"]')?.getAttribute("hreflang")).toBe("en");
    // Paid plans open the dashboard's checkout, which is not translated.
    expect(doc.querySelector('[data-plan="pro"] a.btn')?.getAttribute("href")).toBe(
      `${DASHBOARD}/billing?plan=pro&interval=month`,
    );
  });

  it("hands the hero and the demos the page's language", () => {
    const doc = page("/es/");
    const hero = doc.querySelector('astro-island[component-url*="HeroSearch"]')?.getAttribute("props") ?? "";
    expect(hero).toContain("feliz cumpleaños");
    const demos = doc.querySelector('astro-island[component-url*="UseCases"]')?.getAttribute("props") ?? "";
    expect(demos).toContain('"lang":[0,"es"]');
    // No pack is preloaded in the HTML: Lighthouse counted a preloaded pack in the first paint.
    expect(doc.querySelector(`link[rel="preload"][href*="/v1/pack/"]`)).toBeNull();
    expect(doc.querySelector(`link[rel="preconnect"][href="${API}"]`)).not.toBeNull();
  });

  it("shows prices and limits in the page's number format, from PLANS", () => {
    const solo = page("/fr/pricing/").querySelector('[data-plan="solo"]');
    expect(Number(solo?.getAttribute("data-price-monthly"))).toBe(PLANS.solo.priceUsdMonthly);
    expect(solo?.querySelector(".price .amount")?.textContent).toContain(String(PLANS.solo.priceUsdMonthly));
    expect(solo?.querySelector(".price .amount")?.textContent).not.toBe(`$${PLANS.solo.priceUsdMonthly}`);
  });
});

describe("docs", () => {
  const DOCS = DOCS_PAGES.map((p) => p.href);

  /** Internal links of a built page as [path, hash]. External links and mailto are skipped. */
  function internalLinks(doc: Document, scope = "body"): [string, string][] {
    return Array.from(doc.querySelectorAll(`${scope} a[href]`), (a) => a.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/") || href.startsWith("#"))
      .map((href) => {
        const [path = "", hash = ""] = href.split("#");
        return [path, hash];
      });
  }

  it.each(DOCS)("emits %s with one h1, a title, a description and a canonical URL", (path) => {
    const doc = page(path);
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.title).toContain("Emojisense");
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")?.length).toBeGreaterThan(
      30,
    );
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`${SITE}${path}`);
    const assets = Array.from(doc.querySelectorAll("script[src], link[rel=stylesheet]"), (el) =>
      String(el.getAttribute("src") ?? el.getAttribute("href")),
    );
    for (const url of assets) expect(url).toMatch(/^\//);
  });

  it("links every docs nav entry to a built page, in order, with the current page marked", () => {
    for (const path of DOCS) {
      const nav = Array.from(page(path).querySelectorAll('nav[aria-label="Docs"] a[href^="/docs/"]'));
      expect(nav.map((a) => a.getAttribute("href"))).toEqual(DOCS);
      for (const href of DOCS) expect(existsSync(file(href)), href).toBe(true);
      const current = nav.filter((a) => a.getAttribute("aria-current") === "page");
      expect(current.map((a) => a.getAttribute("href"))).toEqual([path]);
    }
  });

  it.each(DOCS)("resolves every internal link and anchor on %s", (path) => {
    const doc = page(path);
    for (const [target, hash] of internalLinks(doc)) {
      const resolved = target === "" ? path : target;
      if (resolved.startsWith("/docs/") || resolved === "/") {
        expect(existsSync(file(resolved.endsWith("/") ? resolved : `${resolved}/`)), resolved).toBe(true);
      }
      if (hash && resolved.startsWith("/docs/")) {
        const other = resolved === path ? doc : page(resolved);
        expect(other.getElementById(decodeURIComponent(hash)), `${resolved}#${hash}`).not.toBeNull();
      }
    }
  });

  it("links each page to the previous and next page in reading order", () => {
    DOCS.forEach((path, index) => {
      const doc = page(path);
      const prev = doc.querySelector('a[rel="prev"]')?.getAttribute("href");
      const next = doc.querySelector('a[rel="next"]')?.getAttribute("href");
      expect(prev, path).toBe(DOCS[index - 1]);
      expect(next, path).toBe(DOCS[index + 1]);
    });
  });

  it("builds an On this page list whose links all resolve", () => {
    for (const path of ["/docs/concepts/", "/docs/pack-format/", "/docs/guides/search/"]) {
      const doc = page(path);
      const toc = Array.from(doc.querySelectorAll('nav[aria-label="On this page"] a'), (a) =>
        a.getAttribute("href"),
      );
      expect(toc.length, path).toBeGreaterThan(4);
      for (const href of toc) expect(doc.getElementById(String(href).slice(1)), String(href)).not.toBeNull();
    }
  });

  it("renders docs/API.md with internal links pointing at site pages", () => {
    const doc = page("/docs/api/");
    expect(doc.querySelector("h1")?.textContent).toBe("HTTP API");
    expect(doc.getElementById("get-v1search")?.textContent).toContain("GET /v1/search");
    expect(doc.querySelector('a[href="/docs/pack-format/"]')).not.toBeNull();
    // Code blocks from the Markdown are highlighted and get a copy button.
    expect(doc.querySelectorAll(".docs-code pre").length).toBeGreaterThan(2);
    expect(doc.querySelectorAll(".docs-code [data-copy]").length).toBeGreaterThan(2);
  });

  it("keeps the old quickstart anchors on the introduction", () => {
    const doc = page("/docs/");
    for (const id of ["react-frimousse", "web-component", "vanilla"]) {
      expect(doc.getElementById(id)?.getAttribute("href"), id).toMatch(/^\/docs\//);
    }
  });

  it("covers React and Frimousse, plain JavaScript and the web component in the quickstart", () => {
    const doc = page("/docs/quickstart/");
    const text = doc.body.textContent ?? "";
    expect(text).toContain("EmojisensePicker");
    expect(text).toContain("createEngine");
    expect(text).toContain("<emojisense-picker");
    const tabs = Array.from(
      doc.querySelectorAll('[data-group="framework"] [role="tab"]'),
      (t) => t.textContent,
    );
    expect(tabs).toContain("Web component");
  });

  it("names every runtime export of the emojisense package in the SDK reference", () => {
    const text = page("/docs/sdk/").body.textContent ?? "";
    for (const name of Object.keys(core)) expect(text, name).toContain(name);
  });

  it("marks a feature planned exactly while its routes are missing from the server source", () => {
    const repo = join(root, "../..");
    const sources = ["packages/worker/src", "apps/dashboard/src/worker"]
      .flatMap((dir) =>
        (readdirSync(join(repo, dir), { recursive: true }) as string[]).map((f) => join(repo, dir, f)),
      )
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const docsPage of DOCS_PAGES.filter((p) => p.routes)) {
      const shipped = (docsPage.routes ?? []).every((route) => sources.includes(route));
      expect(docsPage.status === "planned", `${docsPage.href}: update its status in docs-nav.ts`).toBe(
        !shipped,
      );
    }
  });

  it("lists every docs page in the sitemap", () => {
    const sitemap = readFileSync(file("/sitemap.xml"), "utf8");
    for (const path of DOCS) expect(sitemap, path).toContain(`<loc>${SITE}${path}</loc>`);
  });
});

describe("share cards and icons", () => {
  /** PNG width and height from the IHDR chunk. */
  function pngSize(path: string): [number, number] {
    const png = readFileSync(file(path));
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  }

  it.each(["/og/home.png", "/og/pricing.png", "/og/docs.png", "/og/integrations.png"])(
    "%s is 1200 × 630",
    (path) => {
      expect(pngSize(path)).toEqual([1200, 630]);
    },
  );

  it.each([
    ["/", "/og/home.png"],
    ["/pricing/", "/og/pricing.png"],
    ["/integrations/", "/og/integrations.png"],
    ["/es/integrations/", "/og/integrations.png"],
    ["/docs/api/", "/og/docs.png"],
    ["/legal/privacy/", "/og/home.png"],
  ])("%s shares %s as a large card with alt text", (path, image) => {
    const doc = page(path);
    const meta = (selector: string) => doc.querySelector(selector)?.getAttribute("content");
    expect(meta('meta[property="og:image"]')).toBe(`${SITE}${image}`);
    expect(meta('meta[name="twitter:image"]')).toBe(`${SITE}${image}`);
    expect(meta('meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(meta('meta[property="og:image:alt"]')?.length).toBeGreaterThan(20);
  });

  it("lists icons in the manifest that exist, in the sizes they claim", () => {
    const manifest = JSON.parse(readFileSync(file("/site.webmanifest"), "utf8")) as {
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      expect(existsSync(file(icon.src)), icon.src).toBe(true);
      if (icon.src.endsWith(".png")) expect(pngSize(icon.src).join("x")).toBe(icon.sizes);
    }
    expect(pngSize("/apple-touch-icon.png")).toEqual([180, 180]);
  });

  it("links the favicon set and the manifest from every page", () => {
    const doc = page("/");
    for (const href of ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/site.webmanifest"]) {
      expect(doc.querySelector(`link[href="${href}"]`), href).not.toBeNull();
    }
  });
});

describe("footer", () => {
  it("has the product, developers, company and legal columns", () => {
    const titles = Array.from(page("/").querySelectorAll(".footer-column-title"), (el) => el.textContent);
    expect(titles).toEqual(["Product", "Developers", "Company", "Legal"]);
  });

  it("links only to pages and sections that exist", () => {
    const doc = page("/about/");
    const links = Array.from(
      doc.querySelectorAll("footer a[href^='/']"),
      (a) => a.getAttribute("href") ?? "",
    );
    expect(links.length).toBeGreaterThan(15);
    for (const href of links) {
      const [path = "/", hash] = href.split("#");
      expect(existsSync(file(path)), href).toBe(true);
      if (hash) expect(page(path).getElementById(hash), href).not.toBeNull();
    }
  });

  it("states the open-source core and the data attribution", () => {
    const text = page("/").querySelector("footer")?.textContent ?? "";
    expect(text).toContain("Open-source core");
    expect(text).toContain("MIT");
    expect(text).toContain("Emojibase");
    expect(text).toContain("Unicode CLDR");
  });
});

describe("legal pages", () => {
  it.each(LEGAL)("%s is marked as a draft that needs legal review", (path) => {
    const doc = page(path);
    const draft = doc.querySelector(".legal-draft");
    expect(draft?.textContent).toContain("legal review");
    expect(doc.querySelector("article")?.firstElementChild).toBe(draft);
  });

  it.each(LEGAL)("%s marks each open detail as a [placeholder] instead of inventing it", (path) => {
    const doc = page(path);
    const placeholders = Array.from(doc.querySelectorAll(".legal-placeholder"), (el) => el.textContent);
    expect(placeholders.every((text) => /^\[[^\]]+\]$/.test(text ?? ""))).toBe(true);
  });

  it("keeps the company details open and names the contact addresses", () => {
    const text = (path: string) => (page(path).body.textContent ?? "").replace(/\s+/g, " ");
    for (const path of ["/legal/terms/", "/legal/privacy/"]) {
      expect(text(path)).toContain("[Company legal name]");
      expect(text(path)).toContain("[Registered address]");
    }
    expect(text("/legal/privacy/")).toContain("privacy@emojisense.com");
    expect(text("/legal/terms/")).toContain("support@emojisense.com");
    expect(text("/legal/acceptable-use/")).toContain("security@emojisense.com");
    expect(text("/legal/acceptable-use/")).toContain("abuse@emojisense.com");
  });

  it("states the real facts: what is never stored, the subprocessors and the payment status", () => {
    const privacy = (page("/legal/privacy/").body.textContent ?? "").replace(/\s+/g, " ");
    expect(privacy).toContain("[Company legal name]");
    expect(privacy).toContain("never stored");
    expect(privacy).toContain("at least 5 times");
    // Retention periods and routes that the code implements (WAITLIST_KEEP_MONTHS, the query_daily
    // cron, DELETE /api/me, invocation_logs: false) and the Analytics Engine limit.
    expect(privacy).toContain(`${WAITLIST_KEEP_MONTHS} months after your first sign-up`);
    expect(privacy).toContain("keeps them for three months");
    const keep = (id: PlanId) => formatDays(analyticsKeepDays(PLANS[id]));
    expect(privacy).toContain(`${keep("pro")} on Pro, ${keep("scale")} on Scale`);
    expect(keep("free")).toBe(keep("solo"));
    expect(privacy).toContain(`On Free and Solo we keep them for ${keep("free")}`);
    expect(privacy).toContain("DELETE /api/me");
    expect(privacy).toContain("Workers invocation logs) are turned off");
    expect(privacy).toContain("Whop is our payment provider");
    expect(privacy).toContain("We never receive or store your card details");
    expect(privacy).not.toContain("[Usage retention period]");
    const terms = (page("/legal/terms/").body.textContent ?? "").replace(/\s+/g, " ");
    expect(terms).toContain("DELETE /api/me");
    expect(terms).toContain("Whop is our payment provider");
    expect(terms).toContain("Refund policy");
    const subprocessors = page("/legal/subprocessors/").body.textContent ?? "";
    for (const name of ["Cloudflare, Inc.", "Clerk, Inc.", "Whop"]) expect(subprocessors).toContain(name);
    expect(subprocessors).not.toContain("not on sale");
  });

  it("lists every legal page in the sitemap and on the legal index", () => {
    const sitemap = readFileSync(file("/sitemap.xml"), "utf8");
    const index = Array.from(page("/legal/").querySelectorAll("main a"), (a) => a.getAttribute("href"));
    for (const path of LEGAL) {
      expect(sitemap).toContain(`<loc>${SITE}${path}</loc>`);
      expect(index).toContain(path);
    }
  });
});

describe("404 page", () => {
  it("runs the emoji search for the missing address as an island, with links to go on", () => {
    const doc = page("/404.html");
    expect(doc.querySelector('astro-island[component-url*="NotFoundSearch"]')).not.toBeNull();
    const links = Array.from(doc.querySelectorAll('nav[aria-label="Places to go"] a'), (a) =>
      a.getAttribute("href"),
    );
    expect(links).toEqual(["/", "/docs/", "/playground/", "/pricing/"]);
  });
});

describe("security headers", () => {
  const rules = () => readFileSync(file("/_headers"), "utf8").split(/\n\s*\n/);
  const allPaths = () => rules().filter((rule) => rule.split("\n").some((line) => line.trim() === "/*"));
  const policy = () => /^\s*Content-Security-Policy: (.+)$/m.exec(allPaths()[0] ?? "")?.[1] ?? "";
  const directive = (name: string) =>
    policy()
      .split("; ")
      .find((d) => d.startsWith(`${name} `)) ?? "";
  const htmlPages = () =>
    readdirSync(outDir, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".html"))
      .map((path) => `/${path}`);
  const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

  it("sends HSTS and the Content-Security-Policy in one rule for every path", () => {
    expect(allPaths()).toHaveLength(1);
    expect(allPaths()[0]).toContain("Strict-Transport-Security: max-age=31536000; includeSubDomains");
    expect(policy()).toContain("default-src 'self'");
    // Cloudflare ignores longer header lines in _headers.
    expect(`Content-Security-Policy: ${policy()}`.length).toBeLessThanOrEqual(2000);
  });

  it("allows the API and the dashboard of this build, and no framing", () => {
    expect(directive("connect-src")).toBe(`connect-src 'self' ${API} ${DASHBOARD}`);
    expect(directive("form-action")).toBe(`form-action 'self' ${DASHBOARD}`);
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("allows every inline script and style of every page by its hash", () => {
    const scripts = directive("script-src").split(" ");
    const styles = directive("style-src").split(" ");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(styles).not.toContain("'unsafe-inline'");
    for (const path of htmlPages()) {
      const doc = page(path);
      for (const script of Array.from(doc.querySelectorAll("script:not([src])"))) {
        if (script.getAttribute("type") === "application/ld+json") continue;
        expect(scripts, `inline script on ${path}`).toContain(sha256(script.textContent ?? ""));
      }
      for (const style of Array.from(doc.querySelectorAll("style"))) {
        expect(styles, `inline style on ${path}`).toContain(sha256(style.textContent ?? ""));
      }
    }
  });

  it("has no inline event handlers, which the policy would block", () => {
    for (const path of htmlPages()) {
      for (const element of Array.from(page(path).querySelectorAll("*"))) {
        const handlers = element.getAttributeNames().filter((name) => name.startsWith("on"));
        expect(handlers, `<${element.localName}> on ${path}`).toEqual([]);
      }
    }
  });
});

describe("heading order", () => {
  it("never skips a heading level on any built page", () => {
    const pages = (readdirSync(outDir, { recursive: true }) as string[]).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(30);
    const skips: string[] = [];
    for (const path of pages) {
      let previous = 0;
      for (const heading of Array.from(page(`/${path}`).querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
        const level = Number(heading.tagName.slice(1));
        if (level > previous + 1)
          skips.push(`${path}: h${previous} → h${level} “${heading.textContent?.trim()}”`);
        previous = level;
      }
    }
    expect(skips).toEqual([]);
  });
});
