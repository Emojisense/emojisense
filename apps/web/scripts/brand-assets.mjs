/**
 * Renders the website's raster brand assets with headless Chrome and writes them to public/.
 * Run it after a change to the mark (public/favicon.svg), the plans or the share-card copy, then
 * commit the output. The site build does not run it.
 *
 *   EMOJI_FONT=/path/to/NotoColorEmoji.ttf node scripts/brand-assets.mjs
 *
 * Output: og/home.png, og/pricing.png, og/docs.png (1200 × 630), favicon.ico (16, 32, 48),
 * apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png.
 *
 * - Emoji are drawn with Noto Color Emoji (SIL OFL 1.1, https://fonts.google.com/noto/specimen/Noto+Color+Emoji),
 *   never with the system emoji font: Apple's emoji art may not be redistributed (docs/PRICING.md).
 * - Every search result in the cards comes from the real engine on the built packs
 *   (`pnpm data:build`), and every price from PLANS, at the time the script runs.
 * - Needs Google Chrome. Set CHROME to its binary when it is not in the default macOS place.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LISTED_PLAN_IDS, PLANS } from "@emojisense/platform";
import { createEngine } from "emojisense";
import { PLAN_COPY } from "../src/components/pricing/plan-copy.ts";
import { formatCount, formatUsd } from "../src/lib/format.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");
const PACK_VERSION = process.env.PUBLIC_PACK_VERSION ?? "0.1.0";
const PACK_DIR = join(ROOT, "../../packages/data/dist/packs", PACK_VERSION);
const LOCALES = ["en", "es", "zh", "hi", "ar", "fr", "bn", "pt", "ru", "id", "tr"];
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EMOJI_FONT = process.env.EMOJI_FONT;

const INK = "#0d0d12";
const INK_2 = "#4b4b57";
const INK_3 = "#85858f";
const LINE = "#e7e7ec";
const LINE_STRONG = "#d3d3db";
const BG_SOFT = "#f6f6f8";
const BG_SUNK = "#eeeef2";

function fail(message) {
  console.error(`brand-assets: ${message}`);
  process.exit(1);
}

if (!EMOJI_FONT || !existsSync(EMOJI_FONT)) {
  fail("set EMOJI_FONT to a Noto Color Emoji .ttf file (the system emoji font is not licensed for this).");
}
if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}. Set CHROME to its binary.`);
if (!existsSync(join(PACK_DIR, "pack.en.json")))
  fail(`no packs in ${PACK_DIR}. Run \`pnpm data:build\` first.`);

// ---------------------------------------------------------------------------------------------
// Real data
// ---------------------------------------------------------------------------------------------

const packs = LOCALES.flatMap((locale) => [`pack.${locale}.json`, `pack.${locale}.ext.json`])
  .map((name) => join(PACK_DIR, name))
  .filter((path) => existsSync(path))
  .map((path) => JSON.parse(readFileSync(path, "utf8")));
const engine = createEngine(packs);

function top(query, locale, limit = 3) {
  const results = engine.search(query, { locale, limit, prefix: false }).results.map((r) => r.emoji);
  if (results.length === 0) fail(`the engine found nothing for “${query}”; pick another example.`);
  return results;
}

// ---------------------------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------------------------

const escapeXml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const font = {
  display: "Bricolage Grotesque",
  body: "Hanken Grotesk",
  mono: "DM Mono",
  emoji: "Noto Color Emoji",
};

function text(
  x,
  y,
  content,
  { size, family = font.body, weight = 400, fill = INK, anchor = "start", tracking = 0 },
) {
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${tracking}">${escapeXml(content)}</text>`;
}

function emoji(cx, cy, glyph, size) {
  // Emoji glyphs sit slightly above the text baseline; 0.36 × size centers them optically.
  return `<text x="${cx}" y="${cy + size * 0.36}" font-family="${font.emoji}" font-size="${size}" text-anchor="middle">${glyph}</text>`;
}

function tile(x, y, glyph, { size = 56, glyphSize = 32, fill = BG_SOFT } = {}) {
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.27}" fill="${fill}"/>${emoji(x + size / 2, y + size / 2, glyph, glyphSize)}`;
}

/** The mark from public/favicon.svg (64 × 64 grid), always the light-scheme colors. */
function mark(x, y, size) {
  const k = size / 64;
  return `<g transform="translate(${x} ${y}) scale(${k})"><rect width="64" height="64" rx="16" fill="${INK}"/><g fill="#fff" stroke="#fff" stroke-linecap="round" stroke-width="5.5"><circle cx="22" cy="25.5" r="4.75" stroke="none"/><path fill="none" d="M36 26.75q5.25-5.75 10.5 0"/><path fill="none" d="M18.5 37q13.5 14 27 0"/></g></g>`;
}

const CARD = { x: 632, y: 64, width: 504, height: 502 };

function frame({ headline, sub, footnote, card }) {
  const headlineSvg = headline
    .map((line, i) =>
      text(72, 252 + i * 80, line, { size: 80, family: font.display, weight: 700, tracking: -3.6 }),
    )
    .join("");
  const subTop = 252 + (headline.length - 1) * 80 + 64;
  const subSvg = sub.map((line, i) => text(72, subTop + i * 38, line, { size: 27, fill: INK_2 })).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="${LINE_STRONG}"/></pattern>
    <radialGradient id="fade" cx="0.78" cy="0.45" r="0.6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
    <mask id="dots-mask"><rect width="1200" height="630" fill="url(#fade)"/></mask>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="${INK}" flood-opacity="0.04"/>
      <feDropShadow dx="0" dy="24" stdDeviation="32" flood-color="${INK}" flood-opacity="0.10"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="#fff"/>
  <rect width="1200" height="630" fill="url(#dots)" mask="url(#dots-mask)" opacity="0.9"/>
  ${mark(72, 64, 44)}
  ${text(128, 98, "emojisense", { size: 31, family: font.display, weight: 700, tracking: -1.1 })}
  ${headlineSvg}
  ${subSvg}
  ${text(72, 566, footnote, { size: 18, family: font.mono, fill: INK_3 })}
  <g filter="url(#shadow)"><rect x="${CARD.x}" y="${CARD.y}" width="${CARD.width}" height="${CARD.height}" rx="28" fill="#fff" stroke="${LINE}" stroke-width="1.5"/></g>
  ${card}
</svg>`;
}

function cardHeader(left, right) {
  const y = CARD.y + 44;
  return [
    text(CARD.x + 32, y, left, { size: 17, family: font.mono, fill: INK_3 }),
    right
      ? text(CARD.x + CARD.width - 32, y, right, { size: 17, family: font.mono, fill: INK_3, anchor: "end" })
      : "",
    `<line x1="${CARD.x}" x2="${CARD.x + CARD.width}" y1="${CARD.y + 72}" y2="${CARD.y + 72}" stroke="${LINE}" stroke-width="1.5"/>`,
  ].join("");
}

// ---------------------------------------------------------------------------------------------
// The three share cards
// ---------------------------------------------------------------------------------------------

function homeCard() {
  const rows = [
    { query: "jurassic park", kind: "a film", locale: "en" },
    { query: "break a leg", kind: "an idiom", locale: "en" },
    { query: "heartbroken", kind: "a feeling", locale: "en" },
    { query: "feliz cumpleaños", kind: "Spanish", locale: "es" },
    { query: "kolay gelsin", kind: "Turkish", locale: "tr" },
  ];
  const rowHeight = 84;
  const body = rows
    .map((row, i) => {
      const y = CARD.y + 72 + i * rowHeight;
      const results = top(row.query, row.locale);
      const tiles = results
        .map((glyph, j) =>
          tile(CARD.x + CARD.width - 32 - (results.length - j) * 62 + 6, y + 14, glyph, {
            fill: j === 0 ? BG_SUNK : BG_SOFT,
          }),
        )
        .join("");
      const divider =
        i < rows.length - 1
          ? `<line x1="${CARD.x + 32}" x2="${CARD.x + CARD.width - 32}" y1="${y + rowHeight}" y2="${y + rowHeight}" stroke="${LINE}" stroke-width="1.5"/>`
          : "";
      return [
        text(CARD.x + 32, y + 40, row.query, { size: 25, weight: 500 }),
        text(CARD.x + 32, y + 66, row.kind, { size: 16, family: font.mono, fill: INK_3 }),
        tiles,
        divider,
      ].join("");
    })
    .join("");
  return frame({
    headline: ["Everything", "emoji, for", "every app."],
    sub: ["Search that understands slang, films,", "feelings and 11 languages."],
    footnote: "Search · Reactions · Hosted sets · Analytics",
    card: cardHeader("what people type", "top results") + body,
  });
}

function pricingCard() {
  // The rows share the card's height; each row's content is 107 px tall and sits in its middle.
  const rowHeight = 428 / LISTED_PLAN_IDS.length;
  const body = LISTED_PLAN_IDS.map((id, i) => {
    const plan = PLANS[id];
    const top = CARD.y + 72 + i * rowHeight;
    const y = top + (rowHeight - 107) / 2;
    const calls = `${formatCount(plan.limits.semantic_calls)} AI calls a month`;
    const price = formatUsd(plan.priceUsdMonthly);
    const priceX = CARD.x + CARD.width - 32 - 40;
    const divider =
      i < LISTED_PLAN_IDS.length - 1
        ? `<line x1="${CARD.x + 32}" x2="${CARD.x + CARD.width - 32}" y1="${top + rowHeight}" y2="${top + rowHeight}" stroke="${LINE}" stroke-width="1.5"/>`
        : "";
    return [
      tile(CARD.x + 32, y + 24, PLAN_COPY[id].emoji, { size: 60, glyphSize: 34 }),
      text(CARD.x + 112, y + 52, plan.name, { size: 28, family: font.display, weight: 650, tracking: -0.6 }),
      text(CARD.x + 112, y + 80, calls, { size: 18, fill: INK_2 }),
      text(priceX, y + 66, price, {
        size: 42,
        family: font.display,
        weight: 700,
        anchor: "end",
        tracking: -1.6,
      }),
      text(priceX + 6, y + 66, "/mo", { size: 18, fill: INK_3 }),
      divider,
    ].join("");
  }).join("");
  return frame({
    headline: ["Free to start.", "Fair when", "you grow."],
    sub: ["Search and reaction suggestions are", "free on every plan."],
    footnote: "Never a hard failure at a plan limit",
    card: cardHeader("plans", "per month") + body,
  });
}

function docsCard() {
  const query = "ship it";
  const results = top(query, "en");
  const x = CARD.x + 32;
  const line = (y, parts) =>
    `<text x="${x}" y="${y}" font-family="${font.mono}" font-size="17.5">${parts
      .map(([content, fill]) => `<tspan fill="${fill}">${escapeXml(content)}</tspan>`)
      .join("")}</text>`;
  const code = [
    line(CARD.y + 120, [
      ["$ ", INK_3],
      ["npm install emojisense", INK],
    ]),
    line(CARD.y + 180, [
      ["import ", INK_3],
      ["{ createEngine }", INK],
      [" from ", INK_3],
      ['"emojisense"', INK_2],
    ]),
    line(CARD.y + 214, [
      ["const ", INK_3],
      ["engine", INK],
      [" = ", INK_3],
      ["createEngine", INK],
      ["(packs);", INK_3],
    ]),
    line(CARD.y + 274, [
      ["engine", INK],
      [".", INK_3],
      ["search", INK],
      ["(", INK_3],
      [`"${query}"`, INK_2],
      [")", INK_3],
    ]),
  ].join("");
  const tilesY = CARD.y + 314;
  const tiles = results
    .map((glyph, j) =>
      tile(x + j * 92, tilesY, glyph, { size: 80, glyphSize: 46, fill: j === 0 ? BG_SUNK : BG_SOFT }),
    )
    .join("");
  const note = text(x, tilesY + 128, "on-device · no server needed", {
    size: 17,
    family: font.mono,
    fill: INK_3,
  });
  return frame({
    headline: ["Add emoji", "search in", "minutes."],
    sub: ["React, web component, Swift, editors,", "MCP and a plain HTTP API."],
    footnote: "Docs · Quickstart · HTTP API · Self-host",
    card: cardHeader("quickstart.ts", "") + code + tiles + note,
  });
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const fontFile = (pkg, file) =>
  pathToFileURL(join(dirname(require.resolve(`${pkg}/package.json`)), "files", file)).href;

const FONT_FACES = `
@font-face { font-family: "${font.display}"; font-weight: 200 800; src: url("${fontFile("@fontsource-variable/bricolage-grotesque", "bricolage-grotesque-latin-opsz-normal.woff2")}") format("woff2"); }
@font-face { font-family: "${font.body}"; font-weight: 100 900; src: url("${fontFile("@fontsource-variable/hanken-grotesk", "hanken-grotesk-latin-wght-normal.woff2")}") format("woff2"); }
@font-face { font-family: "${font.mono}"; font-weight: 400; src: url("${fontFile("@fontsource/dm-mono", "dm-mono-latin-400-normal.woff2")}") format("woff2"); }
@font-face { font-family: "${font.emoji}"; src: url("${pathToFileURL(EMOJI_FONT).href}"); }
`;

function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_FACES}
html, body { margin: 0; background: #fff; overflow: hidden; }
svg { display: block; }
</style></head><body>${body}</body></html>`;
}

async function waitForFile(path, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const size = await stat(path).then(
      (s) => s.size,
      () => 0,
    );
    if (size > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Chrome wrote no screenshot within ${timeoutMs} ms`);
}

/**
 * Opens `html` in a fresh headless Chrome. `done` resolves with the result once Chrome has
 * produced it; Chrome can linger afterwards, so it is stopped then.
 */
async function withChrome(html, args, done) {
  const dir = await mkdtemp(join(tmpdir(), "emojisense-brand-"));
  const pagePath = join(dir, "page.html");
  await writeFile(pagePath, html);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--user-data-dir=${join(dir, "profile")}`,
      "--disable-gpu",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      "--virtual-time-budget=4000",
      ...args(dir),
      pathToFileURL(pagePath).href,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  try {
    return await done({ dir, chrome, exited });
  } finally {
    chrome.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** Screenshots an HTML page with a `width × height` viewport. */
function screenshot(html, { width, height }) {
  return withChrome(
    html,
    (dir) => [`--window-size=${width},${height}`, `--screenshot=${join(dir, "shot.png")}`],
    async ({ dir }) => {
      const shotPath = join(dir, "shot.png");
      await waitForFile(shotPath, 30_000);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return readFile(shotPath);
    },
  );
}

/**
 * Draws an SVG into a `size × size` canvas and returns the PNG. Chrome will not make a window
 * smaller than 256 px, so small icons cannot be screenshots.
 */
function rasterize(svg, size) {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const html = `<!doctype html><meta charset="utf-8"><body><script>
const image = new Image();
image.onload = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ${size};
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, ${size}, ${size});
  document.body.textContent = canvas.toDataURL("image/png");
};
image.src = "${source}";
</script></body>`;
  return withChrome(
    html,
    () => ["--dump-dom"],
    ({ chrome }) =>
      new Promise((resolve, reject) => {
        let dom = "";
        const timer = setTimeout(() => reject(new Error(`Chrome drew no ${size} px icon`)), 30_000);
        chrome.stdout.on("data", (chunk) => {
          dom += chunk;
          if (!dom.includes("</html>")) return;
          clearTimeout(timer);
          const match = dom.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
          if (match?.[1]) resolve(Buffer.from(match[1], "base64"));
          else reject(new Error(`no PNG for the ${size} px icon`));
        });
      }),
  );
}

/** PNG width and height from the IHDR chunk. */
function pngSize(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** An ICO file that stores PNG images (supported by every browser that still asks for .ico). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const ICON_CANVAS = 512;

/**
 * The mark at `size` px. `fullBleed` fills the corners too: iOS shows transparent corners as
 * black, and maskable icons need a full background. The face stays inside the 80 % safe zone.
 */
async function icon(size, { fullBleed = false } = {}) {
  const background = fullBleed ? `<rect width="100%" height="100%" fill="${INK}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_CANVAS}" height="${ICON_CANVAS}" viewBox="0 0 ${ICON_CANVAS} ${ICON_CANVAS}">${background}${mark(0, 0, ICON_CANVAS)}</svg>`;
  const png = await rasterize(svg, size);
  const actual = pngSize(png);
  if (actual.width !== size || actual.height !== size) {
    throw new Error(`icon ${size}: Chrome produced ${actual.width} × ${actual.height}`);
  }
  return png;
}

async function main() {
  await mkdir(join(PUBLIC, "og"), { recursive: true });

  const cards = { home: homeCard(), pricing: pricingCard(), docs: docsCard() };
  for (const [name, svg] of Object.entries(cards)) {
    const png = await screenshot(page(svg), { width: 1200, height: 630 });
    await writeFile(join(PUBLIC, "og", `${name}.png`), png);
    console.log(`og/${name}.png`, pngSize(png));
  }

  const icons = [
    ["apple-touch-icon.png", 180, true],
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ];
  for (const [file, size, fullBleed] of icons) {
    await writeFile(join(PUBLIC, file), await icon(size, { fullBleed }));
    console.log(file);
  }

  const small = [];
  for (const size of [16, 32, 48]) small.push({ size, png: await icon(size) });
  await writeFile(join(PUBLIC, "favicon.ico"), ico(small));
  console.log("favicon.ico");
}

await main();
