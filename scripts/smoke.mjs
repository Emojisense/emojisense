// Post-deploy smoke test: read-only HTTP checks of one deployed environment.
//   node scripts/smoke.mjs dev|production [--no-browser]
// Expected search answers: scripts/smoke.expected.json. The website's publishable key comes from
// PUBLIC_PUBLISHABLE_KEY or .deploy/<env>.env, like scripts/deploy.sh; it is never printed.
// The browser part runs only when Playwright can be required (it is not a dependency of this repo).
// Exit code 1 when any check fails.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ENVIRONMENTS = {
  dev: { domain: "emojisense.dev", indexable: false, fallbackKey: "pk_demo", aliases: [] },
  production: { domain: "emojisense.com", indexable: true, aliases: ["https://www.emojisense.com"] },
};
const PACK_CACHE = "public, max-age=31536000, immutable";
const CULTURE_CACHE = "public, max-age=3600";
const TIMEOUT_MS = 20_000;
const FOREIGN_ORIGIN = "https://smoke-test.invalid";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: { browser: { type: "boolean", default: true } },
});
const environment = positionals[0] ?? "";
const config = ENVIRONMENTS[environment];
if (!config) {
  console.error("Usage: node scripts/smoke.mjs dev|production [--no-browser]");
  process.exit(2);
}
const SITE = `https://${config.domain}`;
const API = `https://api.${config.domain}`;
const DASHBOARD = `https://app.${config.domain}`;
const expected = JSON.parse(readFileSync(join(ROOT, "scripts", "smoke.expected.json"), "utf8"));
const siteKey = readSiteKey();
const usesDevKey = siteKey !== undefined && siteKey === config.fallbackKey;
const keyLabel = !siteKey ? "none" : usesDevKey ? siteKey : "site key";
const HERO_RESULTS = '[aria-label="Emoji results"] [role="option"]';

// ── Key ──────────────────────────────────────────────────────────────────────────────────────

function readSiteKey() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: set by scripts/deploy.sh; not a turbo task.
  const fromEnv = process.env.PUBLIC_PUBLISHABLE_KEY;
  if (fromEnv) return fromEnv;
  for (const root of [ROOT, mainCheckoutRoot()]) {
    const file = root && join(root, ".deploy", `${environment}.env`);
    if (!file || !existsSync(file)) continue;
    const value = /^PUBLIC_PUBLISHABLE_KEY=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1];
    const key = value?.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (key) return key;
  }
  return config.fallbackKey;
}

/** .deploy/ is gitignored, so a git worktree finds it only in the main checkout. */
function mainCheckoutRoot() {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return dirname(gitDir.trim());
  } catch {
    return undefined;
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────────────────────

class Failure extends Error {}
class Warning extends Error {}
class Skip extends Error {}

const counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
const MARKS = { pass: "✔ PASS", fail: "✘ FAIL", warn: "! WARN", skip: "- SKIP" };
const redact = (text) => (siteKey ? String(text).replaceAll(siteKey, "<site key>") : String(text));

function report(status, name, detail) {
  counts[status]++;
  console.log(redact(`  ${MARKS[status]}  ${name}${detail ? ` — ${detail}` : ""}`));
}

function expect(condition, message) {
  if (!condition) throw new Failure(message);
}

/** Runs one check. It passes when `run` returns; its return value is printed as the detail. */
async function check(name, run) {
  try {
    report("pass", name, await run());
  } catch (error) {
    if (error instanceof Skip) report("skip", name, error.message);
    else if (error instanceof Warning) report("warn", name, error.message);
    else if (error instanceof Failure) report("fail", name, error.message);
    else report("fail", name, `${error?.name ?? "Error"}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}

const section = (title) => console.log(`\n${title}`);

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────

/** fetch without following redirects; a network error or timeout is retried once. */
async function request(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const header = (response, name) => response.headers.get(name) ?? "";

function expectStatus(response, status) {
  expect(response.status === status, `expected HTTP ${status}, got ${response.status}`);
}

function expectType(response, type) {
  expect(
    header(response, "content-type").startsWith(type),
    `content-type is "${header(response, "content-type")}"`,
  );
}

const hasNoindexHeader = (response) => /noindex/i.test(header(response, "x-robots-tag"));

function expectIndexing(response) {
  if (config.indexable) expect(!hasNoindexHeader(response), "X-Robots-Tag noindex on a public environment");
  else expect(hasNoindexHeader(response), "no X-Robots-Tag noindex on an internal environment");
}

async function getPage(path) {
  const response = await request(`${SITE}${path}`);
  expectStatus(response, 200);
  expectType(response, "text/html");
  return response;
}

function searchUrl(params, key) {
  const url = new URL("/v1/search", API);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  if (key) url.searchParams.set("key", key);
  return url;
}

const withoutVariationSelectors = (emoji) => emoji.replaceAll("️", "");

// ── Website ──────────────────────────────────────────────────────────────────────────────────

async function websiteChecks() {
  section(`Website ${SITE}`);
  await check("GET / → 200 HTML, canonical URL, API URL, robots meta", async () => {
    const response = await getPage("/");
    expectIndexing(response);
    const html = await response.text();
    const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(html)?.[1];
    expect(canonical === `${SITE}/`, `canonical is ${canonical ?? "missing"}`);
    expect(html.includes(API), `the page never mentions ${API}`);
    const noindexMeta = /<meta[^>]+name="robots"[^>]+content="[^"]*noindex/.test(html);
    expect(noindexMeta !== config.indexable, `robots meta noindex is ${noindexMeta ? "set" : "missing"}`);
  });
  for (const path of ["/docs/", "/pricing/", "/playground/"]) {
    await check(`GET ${path} → 200 HTML`, async () => {
      await getPage(path);
    });
  }
  await check("GET a missing page → 404", async () => {
    const response = await request(`${SITE}/smoke-test-missing-page/`);
    expectStatus(response, 404);
  });
  await check("robots.txt", async () => {
    const response = await request(`${SITE}/robots.txt`);
    expectStatus(response, 200);
    const robots = await response.text();
    if (config.indexable) {
      expect(/^Allow: \/\s*$/m.test(robots), "no `Allow: /`");
      expect(!/^Disallow: \/\s*$/m.test(robots), "`Disallow: /` on a public environment");
      expect(robots.includes(`Sitemap: ${SITE}/sitemap.xml`), "no Sitemap line");
      return "Allow: / + Sitemap";
    }
    expect(/^Disallow: \/\s*$/m.test(robots), "no `Disallow: /`");
    expectIndexing(response);
    return "Disallow: / + X-Robots-Tag noindex";
  });
  if (config.indexable) {
    await check("sitemap.xml lists the home page", async () => {
      const response = await request(`${SITE}/sitemap.xml`);
      expectStatus(response, 200);
      expect((await response.text()).includes(`<loc>${SITE}/</loc>`), `no <loc>${SITE}/</loc>`);
    });
  }
  for (const alias of config.aliases) {
    await check(`GET ${alias}/ → 200 or a redirect to ${SITE}`, async () => {
      const response = await request(`${alias}/`);
      if (response.status === 200) return "200";
      expect([301, 302, 307, 308].includes(response.status), `HTTP ${response.status}`);
      const location = header(response, "location");
      expect(location.startsWith(SITE), `redirects to ${location}`);
      return `${response.status} → ${location}`;
    });
  }
}

// ── API ──────────────────────────────────────────────────────────────────────────────────────

async function apiChecks() {
  section(`API ${API}`);
  let packVersion;
  await check("GET /v1/health → ok, semantic search on", async () => {
    const response = await request(`${API}/v1/health`);
    expectStatus(response, 200);
    const health = await response.json();
    expect(health.ok === true, "ok is not true");
    expect(typeof health.packVersion === "string", "no packVersion");
    packVersion = health.packVersion;
    expect(health.semantic === true, "semantic is false: the Worker has no Workers AI binding");
    return `pack ${health.packVersion}, ${health.model}`;
  });

  for (const { params, top, includes = [], excludes = [] } of expected.search) {
    const flags = [
      params.locale,
      params.culture && `culture=${params.culture}`,
      params.region && `region ${params.region}`,
    ];
    const name = `search "${params.q}" ${flags.filter(Boolean).join(", ")}`.trim();
    await check(name, async () => {
      expect(siteKey, `no site key: set PUBLIC_PUBLISHABLE_KEY or create .deploy/${environment}.env`);
      const response = await request(searchUrl(params, siteKey), { headers: { Origin: SITE } });
      expectStatus(response, 200);
      expect(header(response, "access-control-allow-origin") === "*", "no Access-Control-Allow-Origin: *");
      const body = await response.json();
      const emoji = body.results.map((r) => withoutVariationSelectors(r.emoji));
      const shown =
        body.results
          .slice(0, 5)
          .map((r) => r.emoji)
          .join(" ") || "no results";
      expect(
        top.map(withoutVariationSelectors).includes(emoji[0]),
        `expected ${top.join(" or ")} first, got ${shown}`,
      );
      for (const wanted of includes) {
        expect(emoji.includes(withoutVariationSelectors(wanted)), `${wanted} not in the results: ${shown}`);
      }
      for (const unwanted of excludes) {
        expect(!emoji.includes(withoutVariationSelectors(unwanted)), `${unwanted} in the results: ${shown}`);
      }
      // Culture is on by default: a case about culture names a region.
      if (params.region && params.culture !== "0") {
        expect(body.culture, "culture is null: no culture file was applied");
      }
      if (body.degraded) throw new Warning(`${shown} (degraded: alias-only, Workers AI unavailable)`);
      return shown;
    });
  }

  await check("search without q → 400", async () => {
    const response = await request(searchUrl({}, siteKey), { headers: { Origin: SITE } });
    expectStatus(response, 400);
  });
  await check(`a foreign Origin is refused with the ${keyLabel} (403)`, async () => {
    if (!siteKey) throw new Skip("no site key");
    if (usesDevKey) throw new Skip(`${siteKey} is a dev key and allows every origin`);
    const response = await request(searchUrl({ q: "pizza" }, siteKey), {
      headers: { Origin: FOREIGN_ORIGIN },
    });
    expectStatus(response, 403);
  });
  if (environment === "production") {
    await check("pk_demo is refused (401)", async () => {
      const response = await request(searchUrl({ q: "pizza" }, "pk_demo"), { headers: { Origin: SITE } });
      expectStatus(response, 401);
    });
  }
  await check("CORS preflight OPTIONS /v1/search → 204", async () => {
    const response = await request(`${API}/v1/search`, {
      method: "OPTIONS",
      headers: { Origin: SITE, "Access-Control-Request-Method": "GET" },
    });
    expectStatus(response, 204);
    expect(header(response, "access-control-allow-origin") === "*", "no Access-Control-Allow-Origin: *");
    const methods = header(response, "access-control-allow-methods");
    expect(/\bGET\b/.test(methods) && /\bPOST\b/.test(methods), `Allow-Methods is "${methods}"`);
  });
  return packVersion;
}

// ── Packs and culture files ──────────────────────────────────────────────────────────────────

/** A static asset: 200, JSON, the expected Cache-Control, readable from any origin, compressed. */
async function fetchStatic(path, cacheControl) {
  const response = await request(`${API}${path}`);
  expectStatus(response, 200);
  expectType(response, "application/json");
  const cache = header(response, "cache-control");
  expect(cache === cacheControl, `Cache-Control is "${cache}", expected "${cacheControl}"`);
  expect(header(response, "access-control-allow-origin") === "*", "no Access-Control-Allow-Origin: *");
  expect(/^(br|gzip|zstd)$/.test(header(response, "content-encoding")), "not compressed");
  return response;
}

async function staticFileChecks(packVersion) {
  section("Packs and culture files");
  if (!packVersion) {
    report("skip", "packs and culture files", "no pack version from /v1/health");
    return;
  }
  const base = `/v1/pack/${packVersion}`;
  let manifest;
  await check(`${base}/manifest.json`, async () => {
    manifest = await (await fetchStatic(`${base}/manifest.json`, PACK_CACHE)).json();
    expect(manifest.packVersion === packVersion, `manifest is pack ${manifest.packVersion}`);
    return `${Object.keys(manifest.files).length} files`;
  });
  if (!manifest) {
    report("skip", "core packs and culture files", "no manifest");
    return;
  }
  const corePacks = Object.keys(manifest.files).filter((name) => /^pack\.[a-z]+\.json$/.test(name));
  await check(`core packs: cache headers and sha256 match the manifest`, async () => {
    expect(corePacks.length > 0, "the manifest lists no core packs");
    const problems = await Promise.all(
      corePacks.map(async (name) => {
        try {
          const bytes = Buffer.from(await (await fetchStatic(`${base}/${name}`, PACK_CACHE)).arrayBuffer());
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          return sha256 === manifest.files[name].sha256 ? undefined : `${name}: sha256 differs`;
        } catch (error) {
          return `${name}: ${error.message}`;
        }
      }),
    );
    const failed = problems.filter(Boolean);
    expect(failed.length === 0, failed.join("; "));
    return `${corePacks.length} packs`;
  });
  await check(`culture files: cache headers, pack version, cover today`, async () => {
    const locales = corePacks.map((name) => name.split(".")[1]);
    const today = new Date().toISOString().slice(0, 10);
    const problems = await Promise.all(
      locales.map(async (locale) => {
        try {
          const file = `/v1/culture/${packVersion}/culture.${locale}.json`;
          const culture = await (await fetchStatic(file, CULTURE_CACHE)).json();
          if (culture.packVersion !== packVersion) return `${locale}: pack ${culture.packVersion}`;
          if (culture.locale !== locale) return `${locale}: holds locale ${culture.locale}`;
          if (!(culture.from <= today && today <= culture.until)) {
            return `${locale}: covers ${culture.from} → ${culture.until}, not ${today}`;
          }
          return undefined;
        } catch (error) {
          return `${locale}: ${error.message}`;
        }
      }),
    );
    const failed = problems.filter(Boolean);
    expect(failed.length === 0, failed.join("; "));
    return `${locales.length} locales`;
  });
}

// ── Dashboard ────────────────────────────────────────────────────────────────────────────────

async function dashboardChecks() {
  section(`Dashboard ${DASHBOARD}`);
  await check("GET / → 200 HTML", async () => {
    const response = await request(`${DASHBOARD}/`);
    expectStatus(response, 200);
    expectType(response, "text/html");
    if (!config.indexable) expectIndexing(response);
  });
  await check("GET /api/me signed out → 401 JSON", async () => {
    const response = await request(`${DASHBOARD}/api/me`);
    expectStatus(response, 401);
    expectType(response, "application/json");
  });
}

// ── Browser ──────────────────────────────────────────────────────────────────────────────────

/** Playwright's chromium, if installed here or on NODE_PATH; undefined otherwise. */
function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return require(name).chromium;
    } catch {}
  }
  return undefined;
}

/** Playwright's own Chromium; without that download, an installed Google Chrome. Always headless. */
async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ headless: true });
  } catch (bundled) {
    return chromium.launch({ headless: true, channel: "chrome" }).catch(() => {
      throw bundled;
    });
  }
}

async function browserChecks() {
  section(`Browser (headless Chromium) ${SITE}/`);
  const chromium = loadChromium();
  if (!chromium) {
    report("skip", "landing page in a browser", "Playwright is not installed (or set NODE_PATH to one)");
    return;
  }
  let browser;
  try {
    browser = await launchBrowser(chromium);
  } catch (error) {
    report("skip", "landing page in a browser", `Chromium did not start: ${error.message.split("\n")[0]}`);
    return;
  }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const hydrated = (island) =>
      page.waitForSelector(`astro-island[component-url*="${island}"]:not([ssr])`, {
        state: "attached",
        timeout: TIMEOUT_MS,
      });

    await check("GET / loads and the hero search hydrates", async () => {
      const response = await page.goto(`${SITE}/`, { waitUntil: "load", timeout: TIMEOUT_MS });
      expect(response?.status() === 200, `HTTP ${response?.status()}`);
      await hydrated("HeroSearch");
    });
    await check(`hero search "${expected.hero.q}"`, async () => {
      const input = page.getByRole("combobox", { name: "Search emoji" });
      await input.click();
      await input.fill(expected.hero.q);
      const wanted = expected.hero.top.map(withoutVariationSelectors);
      try {
        await page.waitForFunction(
          ([selector, answers]) => {
            const text = document.querySelector(selector)?.textContent?.replaceAll("️", "").trim();
            return answers.includes(text);
          },
          [HERO_RESULTS, wanted],
          { timeout: TIMEOUT_MS },
        );
      } catch {
        const got = (await page.locator(HERO_RESULTS).allTextContents()).slice(0, 5).join(" ");
        throw new Failure(`expected ${expected.hero.top.join(" or ")} first, got ${got || "no results"}`);
      }
      const tiles = await page.locator(HERO_RESULTS).allTextContents();
      return tiles.slice(0, 5).join(" ");
    });
    await check("each use-case tab renders its demo", async () => {
      const tabs = page.locator('[role="tablist"][aria-label="Use cases"] [role="tab"]');
      await tabs.first().scrollIntoViewIfNeeded();
      await hydrated("UseCases");
      const count = await tabs.count();
      expect(count > 0, "no tabs");
      const rendered = [];
      for (let i = 0; i < count; i++) {
        const tab = tabs.nth(i);
        const label = (await tab.textContent())?.trim() ?? `tab ${i + 1}`;
        await tab.click();
        try {
          await page.waitForFunction(
            () => {
              const stage = document.querySelector('[role="tabpanel"]:not([hidden]) .uc-stage');
              return (
                stage !== null &&
                stage.childElementCount > 0 &&
                stage.querySelector(".uc-loading, .uc-missing") === null &&
                stage.getBoundingClientRect().height > 0
              );
            },
            null,
            { timeout: TIMEOUT_MS },
          );
        } catch {
          throw new Failure(`${label}: the demo did not render`);
        }
        rendered.push(label);
      }
      return rendered.join(", ");
    });
    await check("no console errors", async () => {
      expect(errors.length === 0, `${errors.length}: ${errors.slice(0, 3).join(" | ")}`);
    });
  } finally {
    await browser.close();
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────

console.log(`Smoke test: ${environment} (${SITE}) · key: ${keyLabel}`);
await websiteChecks();
const packVersion = await apiChecks();
await staticFileChecks(packVersion);
await dashboardChecks();
if (options.browser) await browserChecks();

const { pass, fail, warn, skip } = counts;
console.log(
  `\n${fail ? "✘" : "✔"} ${environment}: ${pass} passed, ${fail} failed, ${warn} warnings, ${skip} skipped`,
);
process.exitCode = fail ? 1 : 0;
