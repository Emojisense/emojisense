/**
 * The built plugin in real TinyMCE 8 and 7, in headless Chromium:
 *   pnpm --filter @emojisense/tinymce build && pnpm --filter @emojisense/tinymce test:browser
 * Uses the packs of packages/data/dist (pnpm data:build). Set CHROMIUM_PATH to pick a browser.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const packs = join(root, "../data/dist/packs/0.1.0");
const editors = [
  { name: "TinyMCE 8", dir: join(root, "node_modules/tinymce") },
  { name: "TinyMCE 7", dir: join(root, "node_modules/tinymce-7") },
];
const TYPES = {
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".html": "text/html",
};

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const own = chromium.executablePath();
    if (existsSync(own)) return own;
  } catch {
    // Not installed for this Playwright version.
  }
  for (const cache of [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
  ]) {
    if (!existsSync(cache)) continue;
    const shells = readdirSync(cache)
      .filter((name) => name.startsWith("chromium_headless_shell-"))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const shell of shells) {
      for (const sub of readdirSync(join(cache, shell))) {
        const binary = join(cache, shell, sub, "chrome-headless-shell");
        if (existsSync(binary)) return binary;
      }
    }
  }
  throw new Error("no Chromium: set CHROMIUM_PATH or run `npx playwright install chromium-headless-shell`");
}

const page = (tinymce) => `<!doctype html><meta charset="utf-8">
<script src="/${tinymce}/tinymce.min.js"></script>
<script src="/plugin.min.js"></script>
<textarea id="editor"></textarea>
<script>
  tinymce.init({
    selector: "#editor",
    license_key: "gpl",
    plugins: "emojisense emoticons",
    emojisense_pack_url: "/packs",
    emojisense_locales: "tr en",
    setup: (editor) => editor.on("init", () => { window.ready = true; }),
  });
</script>`;

function serve() {
  const files = (url) => {
    if (url === "/" || url.startsWith("/?"))
      return { type: ".html", body: page(new URL(url, "http://x").searchParams.get("t")) };
    if (url === "/plugin.min.js")
      return { type: ".js", body: readFileSync(join(root, "dist/plugin.min.js")) };
    const [, area, ...rest] = url.split("/");
    const base = area === "packs" ? packs : editors.find((e) => e.dir.endsWith(area))?.dir;
    if (!base) return undefined;
    const path = normalize(join(base, ...rest));
    return path.startsWith(base) && existsSync(path)
      ? { type: extname(path), body: readFileSync(path) }
      : undefined;
  };
  const server = createServer((request, response) => {
    const file = files(request.url ?? "/");
    if (!file) return response.writeHead(404).end();
    response
      .writeHead(200, { "content-type": TYPES[file.type] ?? "application/octet-stream" })
      .end(file.body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function typeAndPick(tab, text) {
  const frame = tab.frameLocator("iframe");
  await frame.locator("body").click();
  // TinyMCE looks up after 50 ms without input, and keeps a space in the query only while the
  // menu is open: type at a human pace, so ":sh" opens it before "ship it" has a space.
  await tab.keyboard.type(` ${text}`, { delay: 120 });
  const first = tab.locator(".tox-autocompleter .tox-collection__item").first();
  // Attached, not visible: headless Chromium may place the menu outside the small viewport.
  await first.waitFor({ timeout: 5000, state: "attached" });
  const labels = await tab.locator(".tox-autocompleter .tox-collection__item").allInnerTexts();
  // The emoticons plugin's menu is a grid; this one is a list.
  const grid = await tab.locator(".tox-autocompleter .tox-collection--grid").count();
  await tab.keyboard.press("Enter");
  return { labels, grid };
}

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
let failed = false;
try {
  for (const editor of editors) {
    const tab = await browser.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.goto(`${origin}/?t=${editor.dir.split("/").pop()}`);
    await tab.waitForFunction(() => window.ready === true, undefined, { timeout: 10000 });
    const checks = [];
    const pizza = await typeAndPick(tab, ":pizza");
    checks.push([":pizza lists 🍕 first", /pizza/i.test(pizza.labels[0] ?? "")]);
    checks.push(["the emoticons menu is replaced", pizza.grid === 0]);
    const ship = await typeAndPick(tab, ":ship it");
    checks.push([":ship it lists 🚀 first", /rocket/i.test(ship.labels[0] ?? "")]);
    const content = await tab.evaluate(() => tinymce.activeEditor.getContent());
    checks.push(["inserts 🍕 and 🚀", content.includes("🍕") && content.includes("🚀")]);
    const locales = await tab.evaluate(() => tinymce.activeEditor.options.get("emojisense_locales"));
    checks.push(['emojisense_locales "tr en" is ["tr", "en"]', JSON.stringify(locales) === '["tr","en"]']);
    checks.push(["no page errors", errors.length === 0]);
    for (const [name, ok] of checks) {
      failed ||= !ok;
      console.log(`${ok ? "✔" : "✘"} ${editor.name}: ${name}`);
    }
    if (errors.length) console.log(errors.join("\n"));
    await tab.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
