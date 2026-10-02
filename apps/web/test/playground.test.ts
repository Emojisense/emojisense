/**
 * Playground: its pure helpers (URL state, snippets, timing, highlighting) and a build check that
 * /playground/ is emitted with its island and a usable server-rendered shell.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as react from "@emojisense/react";
import * as sdk from "emojisense";
import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countNameMatches } from "../src/playground/lib/baseline";
import { parseServerTiming, serverTotal } from "../src/playground/lib/edge";
import { tokenize } from "../src/playground/lib/highlight";
import {
  DEFAULT_SETTINGS,
  LOCALES,
  readSettings,
  readTab,
  type SearchSettings,
  writeSettings,
} from "../src/playground/lib/settings";
import {
  type CodeSample,
  photoSnippets,
  reactionSnippets,
  searchSnippets,
  shellQuote,
} from "../src/playground/lib/snippets";

const ENDPOINTS = { api: "https://api.test", packVersion: "0.1.0" };

/** Names a snippet imports from a package, e.g. `import { a, b } from "emojisense"`. */
function importsFrom(code: string, pkg: string): string[] {
  const match = new RegExp(`import \\{([^}]+)\\} from "${pkg}"`).exec(code);
  return match?.[1]?.split(",").map((name) => name.trim()) ?? [];
}

describe("URL state", () => {
  it("keeps the defaults out of the URL", () => {
    expect(writeSettings(DEFAULT_SETTINGS)).toBe("");
    expect(readSettings("")).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips every setting", () => {
    const settings: SearchSettings = {
      query: "feliz cumpleaños & más",
      locale: "es",
      mode: "hybrid",
      limit: 12,
      alwaysEdge: true,
    };
    const search = writeSettings(settings);
    expect(search).toContain("q=feliz+cumplea%C3%B1os+%26+m%C3%A1s");
    expect(search).toContain("edge=always");
    expect(readSettings(search)).toEqual(settings);
  });

  it("falls back to the defaults for unknown or unsafe values", () => {
    const read = readSettings("?locale=xx&mode=turbo&limit=999");
    expect(read.locale).toBe("en");
    expect(read.mode).toBe("hybrid");
    expect(read.limit).toBe(50);
    expect(readSettings("?limit=abc").limit).toBe(24);
    expect(readSettings(`?q=${"a".repeat(200)}`).query).toHaveLength(64);
    expect(readSettings("?q=").query).toBe("");
  });

  it("writes edge=always only for hybrid", () => {
    expect(writeSettings({ ...DEFAULT_SETTINGS, mode: "alias", alwaysEdge: true })).toBe("?mode=alias");
  });

  it("offers all 11 languages and reads the tab from the hash", () => {
    expect(LOCALES).toHaveLength(11);
    expect(readTab("#photo")).toBe("photo");
    expect(readTab("#reactions")).toBe("reactions");
    expect(readTab("#nope")).toBe("search");
  });
});

describe("copy as code", () => {
  const settings = { query: "it's lit", locale: "tr", limit: 12, alwaysEdge: false };
  const code = (samples: CodeSample[], id: CodeSample["id"]) => samples.find((s) => s.id === id)?.code ?? "";

  it.each(["alias", "hybrid", "semantic"] as const)("imports only real SDK exports in %s mode", (mode) => {
    const samples = searchSnippets({ ...settings, mode }, ENDPOINTS);
    for (const sample of samples) {
      for (const name of importsFrom(sample.code, "emojisense")) expect(sdk, name).toHaveProperty(name);
      for (const name of importsFrom(sample.code, "@emojisense/react"))
        expect(react, name).toHaveProperty(name);
    }
  });

  it("matches the current settings", () => {
    const hybrid = searchSnippets({ ...settings, mode: "hybrid", alwaysEdge: true }, ENDPOINTS);
    expect(code(hybrid, "js")).toContain('locale: "tr"');
    expect(code(hybrid, "js")).toContain("limit: 12");
    expect(code(hybrid, "js")).toContain("shouldUseSemantic");
    expect(code(hybrid, "js")).toContain('session.update("it\'s lit")');
    expect(code(hybrid, "curl")).toContain("--data-urlencode 'q=it'\\''s lit'");
    expect(code(hybrid, "curl")).toContain("-d mode=hybrid");
    expect(code(searchSnippets({ ...settings, mode: "semantic" }, ENDPOINTS), "curl")).toContain(
      "-d mode=semantic",
    );
  });

  it("sends no request in on-device mode, and has no React hook for meaning only", () => {
    const alias = searchSnippets({ ...settings, mode: "alias" }, ENDPOINTS);
    expect(code(alias, "js")).not.toContain("createSemanticClient");
    expect(code(alias, "react")).not.toContain("endpoint");
    expect(code(alias, "curl")).toContain("https://api.test/v1/pack/0.1.0/pack.tr.json");
    const semantic = searchSnippets({ ...settings, mode: "semantic" }, ENDPOINTS);
    expect(semantic.map((s) => s.id)).toEqual(["js", "curl"]);
  });

  it("never prints a real key", () => {
    const all = [
      ...searchSnippets({ ...settings, mode: "hybrid" }, ENDPOINTS),
      ...reactionSnippets({ text: "ship it", locale: "en", limit: 8 }, ENDPOINTS),
      ...photoSnippets({ limit: 8 }, ENDPOINTS),
    ];
    for (const sample of all) expect(sample.code).not.toMatch(/pk_(?:demo|live_[a-z0-9])/);
  });

  it("posts reactions and photos to the documented endpoints", () => {
    const reactions = reactionSnippets({ text: "we shipped!", locale: "en", limit: 8 }, ENDPOINTS);
    expect(code(reactions, "curl")).toContain("https://api.test/v1/suggest-reactions");
    expect(code(reactions, "curl")).toContain(`'{"text":"we shipped!","locale":"en","limit":8}'`);
    expect(code(photoSnippets({ limit: 8 }, ENDPOINTS), "curl")).toContain("/v1/classify-image?limit=8");
  });

  it("quotes for POSIX shells", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

describe("helpers", () => {
  it("parses Server-Timing", () => {
    const entries = parseServerTiming("embed;dur=134, total;dur=141, cache;desc=hit");
    expect(entries).toEqual([
      { name: "embed", ms: 134 },
      { name: "total", ms: 141 },
    ]);
    expect(serverTotal(entries)).toBe(141);
    expect(parseServerTiming(null)).toEqual([]);
  });

  it("highlights without losing a character", () => {
    const source = searchSnippets({ ...DEFAULT_SETTINGS, mode: "hybrid" }, ENDPOINTS);
    for (const sample of source) {
      const tokens = tokenize(sample.code, sample.language);
      expect(tokens.map((t) => t.text).join("")).toBe(sample.code);
      expect(tokens.some((t) => t.kind === "string")).toBe(true);
    }
  });

  it("counts name-only matches like a plain picker", () => {
    const entries = [
      {
        emoji: "🦖",
        id: "1F996",
        group: "animals-nature",
        version: 5,
        hasSkinTones: false,
        labels: { en: "T-Rex" },
      },
      {
        emoji: "🎂",
        id: "1F382",
        group: "food-drink",
        version: 1,
        hasSkinTones: false,
        labels: { en: "birthday cake", es: "tarta de cumpleaños" },
      },
    ];
    expect(countNameMatches(entries, "jurassic park", "en")).toBe(0);
    expect(countNameMatches(entries, "cake", "en")).toBe(1);
    expect(countNameMatches(entries, "cumpleaños", "es")).toBe(1);
    expect(countNameMatches(entries, "  ", "en")).toBe(0);
  });
});

describe("/playground/ build", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const SITE = "https://site.test";
  let outDir = "";
  const window = new Window();

  beforeAll(() => {
    // Inside the project on purpose: with an outDir outside the working directory, Astro puts its
    // prerender chunks in the shared .astro/.prerender, where concurrent builds overwrite each other.
    const cache = join(root, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    outDir = mkdtempSync(join(cache, "playground-build-"));
    const astro = join(
      dirname(createRequire(import.meta.url).resolve("astro/package.json")),
      "bin/astro.mjs",
    );
    execFileSync(process.execPath, [astro, "build", "--outDir", outDir], {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, PUBLIC_SITE_URL: SITE, PUBLIC_API_URL: "https://api.test" },
    });
  });

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
    window.close();
  });

  const page = () =>
    new window.DOMParser().parseFromString(
      readFileSync(join(outDir, "playground/index.html"), "utf8"),
      "text/html",
    ) as unknown as Document;

  it("renders the page with its metadata", () => {
    const doc = page();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.title).toContain("Playground");
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`${SITE}/playground/`);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")?.length).toBeGreaterThan(
      30,
    );
  });

  it("hydrates the playground island on load", () => {
    const island = page().querySelector('astro-island[component-url*="Playground"]');
    expect(island).not.toBeNull();
    expect(island?.getAttribute("client")).toBe("load");
  });

  it("server-renders the tabs and the search box, so the page is never blank", () => {
    const doc = page();
    const tabs = Array.from(
      doc.querySelectorAll('[role="tablist"][aria-label="Capabilities"] [role="tab"]'),
      (t) => t.textContent?.trim(),
    );
    expect(tabs).toEqual(["🔎Search", "💬Reactions", "📷Photo"]);
    expect(doc.querySelector('input[role="combobox"]')?.getAttribute("value")).toBe("jurassic park");
    expect(doc.querySelectorAll(".pg-select option").length).toBeGreaterThanOrEqual(11);
  });

  it("is listed in the sitemap", () => {
    expect(readFileSync(join(outDir, "sitemap.xml"), "utf8")).toContain(`<loc>${SITE}/playground/</loc>`);
  });

  it("loads no third-party scripts", () => {
    const doc = page();
    for (const el of Array.from(doc.querySelectorAll("script[src]"))) {
      expect(el.getAttribute("src")).toMatch(/^\//);
    }
  });
});
