/**
 * Build smoke test: run `astro build` once into a temporary directory, then check the emitted
 * pages the way a crawler or a visitor without JavaScript would see them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN_IDS, PLANS } from "@emojisense/platform";
import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatCount } from "../src/lib/format";
import { featuresOf } from "../src/lib/pricing";

const root = fileURLToPath(new URL("..", import.meta.url));
const SITE = "https://site.test";
const DASHBOARD = "https://dashboard.test";
const API = "https://api.test";

const PAGES = [
  "/",
  "/pricing/",
  "/waitlist/",
  "/docs/",
  "/docs/api/",
  "/docs/pack-format/",
  "/docs/self-host/",
  "/docs/privacy/",
];

let outDir = "";
const window = new Window();

function file(path: string): string {
  const relative = path.endsWith("/") ? `${path}index.html` : path;
  return join(outDir, relative);
}

function page(path: string): Document {
  const parser = new window.DOMParser();
  return parser.parseFromString(readFileSync(file(path), "utf8"), "text/html") as unknown as Document;
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
  it.each([...PAGES, "/404.html", "/sitemap.xml", "/robots.txt", "/favicon.svg", "/_headers"])(
    "emits %s",
    (path) => {
      expect(existsSync(file(path))).toBe(true);
    },
  );

  it("lists every page in the sitemap", () => {
    const sitemap = readFileSync(file("/sitemap.xml"), "utf8");
    for (const path of PAGES) expect(sitemap).toContain(`<loc>${SITE}${path}</loc>`);
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
        doc.querySelectorAll("link[href]:not([rel=canonical])"),
        (el) => el.getAttribute("href") ?? "",
      ),
    ];
    for (const url of urls) expect(url).toMatch(/^\//);
  });
});

describe("landing page", () => {
  it("renders the live demo with the packs and API from the configuration", () => {
    const island = page("/").querySelector('astro-island[component-url*="HeroDemo"]');
    expect(island).not.toBeNull();
    expect(island?.getAttribute("props")).toContain(`${API}/v1/pack/0.1.0`);
  });

  it("has the edge, network effect, features, languages, developers, pricing and FAQ sections", () => {
    const doc = page("/");
    for (const id of ["edge", "network", "features", "languages", "developers", "pricing", "faq"]) {
      expect(doc.getElementById(id), id).not.toBeNull();
    }
    const text = doc.body.textContent ?? "";
    for (const name of ["React", "Frimousse", "Tiptap", "Lexical", "Swift", "Chrome", "Raycast", "MCP"]) {
      expect(text).toContain(name);
    }
    expect(doc.querySelectorAll("#faq details").length).toBeGreaterThanOrEqual(5);
  });

  it("states the edge facts and the over-limit switch", () => {
    const doc = page("/");
    expect(doc.getElementById("edge")?.textContent).toContain("300+");
    expect(doc.querySelectorAll("#edge .bubble").length).toBeGreaterThanOrEqual(8);
    expect(doc.querySelector('#network input[role="switch"]')).not.toBeNull();
    expect(doc.querySelectorAll("#network .rung")).toHaveLength(4);
  });
});

describe("pricing page", () => {
  const doc = () => page("/pricing/");

  it.each(PLAN_IDS)("shows the %s price from PLANS", (id) => {
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

  it.each(PLAN_IDS)("shows every %s limit from PLANS", (id) => {
    const card = doc().querySelector(`[data-plan="${id}"]`);
    for (const feature of featuresOf(PLANS[id])) {
      const row = card?.querySelector(`[data-feature="${feature.key}"]`);
      expect(row, feature.key).not.toBeNull();
      if (feature.raw !== undefined)
        expect(Number(row?.getAttribute("data-raw")), feature.key).toBe(feature.raw);
    }
    const calls = card?.querySelector('[data-feature="semantic_calls"] strong')?.textContent?.trim();
    expect(calls).toBe(formatCount(PLANS[id].limits.semantic_calls));
  });

  it("sends Pro to the waitlist", () => {
    const link = doc().querySelector('[data-plan="pro"] a.btn');
    expect(link?.getAttribute("href")).toBe("/waitlist/?plan=pro");
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
    expect(plans).toEqual(["solo", "pro", "scale"]);
    expect(form?.querySelector('button[type="submit"]')).not.toBeNull();
  });
});

describe("docs", () => {
  it("renders docs/API.md with internal links pointing at site pages", () => {
    const doc = page("/docs/api/");
    expect(doc.querySelector("h1")?.textContent).toBe("HTTP API");
    expect(doc.getElementById("get-v1search")?.textContent).toContain("GET /v1/search");
    expect(doc.querySelector('a[href="/docs/pack-format/"]')).not.toBeNull();
  });

  it("renders docs/PACK_FORMAT.md with its table of contents", () => {
    const doc = page("/docs/pack-format/");
    const toc = Array.from(doc.querySelectorAll('nav[aria-label="On this page"] a'), (a) =>
      a.getAttribute("href"),
    );
    expect(toc.length).toBeGreaterThan(4);
    for (const href of toc) expect(doc.getElementById(String(href).slice(1)), String(href)).not.toBeNull();
  });

  it("covers React and Frimousse, plain JavaScript and the web component in the quickstart", () => {
    const text = page("/docs/").body.textContent ?? "";
    expect(text).toContain("EmojisensePicker");
    expect(text).toContain("createEngine");
    expect(text).toContain("<emojisense-picker");
  });
});
